// Parse MEMBERS_INFO from environment variable
const membersInfo = JSON.parse(Cypress.env('MEMBERS_INFO') || '[]');

// Shared configuration
const sharedConfig = {
  maximum_share_price: Cypress.env('MAX_IPO_PRICE'),
  kitta: Cypress.env('KITTA')
};

// Run tests for each member
membersInfo.forEach((member, index) => {
  describe(`Meroshare Automation - ${member.name}`, () => {
    const result = {
      username: member.USER_NAME,
      password: member.PASSWORD,
      dp: member.DP,
      maximum_share_price: sharedConfig.maximum_share_price,
      kitta: sharedConfig.kitta,
      crn: member.CRN,
      transactionPin: member.TRANSACTION_PIN,
      bankName: member.BANK_NAME
    }

    let resppp = [];

    before(() => {
      // Add delay between members to avoid rate limiting
      if (index > 0) {
        cy.wait(3000);
      }

      cy.intercept("POST", "https://webbackend.cdsc.com.np/api/meroShare/companyShare/applicableIssue/").as("applicableshare");
      cy.intercept({
        url: "https://webbackend.cdsc.com.np/api/meroShare/active/**"
      }).as("active");
      cy.intercept("POST", "https://webbackend.cdsc.com.np/api/meroShare/applicantForm/share/apply").as('apply_share');

      cy.visit('/');
      cy.login(result.password, result.username, result.dp);

      cy.get('li.nav-item').contains("My ASBA", {
        matchCase: false
      }).click();

      cy.wait("@applicableshare").then((resp) => {
        const response = resp.response.body.object;
        console.log(`${member.name} - Total IPOs:`, response);

        // Filter for eligible IPOs
        let filtered_response = response.filter((data) => {
          const isEligible = !data.action &&
                           data.shareTypeName === "IPO" &&
                           data.shareGroupName === "Ordinary Shares" &&
                           data.subGroup === "For General Public";

          // Log why each IPO is filtered or eligible
          if (!isEligible) {
            const reasons = [];
            if (data.action) reasons.push('Already applied');
            if (data.shareTypeName !== "IPO") reasons.push(`Wrong type: ${data.shareTypeName}`);
            if (data.shareGroupName !== "Ordinary Shares") reasons.push(`Wrong group: ${data.shareGroupName}`);
            if (data.subGroup !== "For General Public") reasons.push(`Wrong subgroup: ${data.subGroup}`);
            console.log(`${member.name} - FILTERED: ${data.companyName} - ${reasons.join(', ')}`);
          } else {
            console.log(`${member.name} - ELIGIBLE: ${data.companyName}`);
          }

          return isEligible;
        });

        console.log(`${member.name} - Eligible IPOs:`, filtered_response.length);
        resppp.push(filtered_response);
      });
    });

    it('Apply for Share', () => {
      if (!resppp[0] || resppp[0].length === 0) {
        cy.log(`${member.name}: No eligible IPOs available to apply`);
        return;
      }

      resppp.map((dat) => {
        dat.map((data) => {
          cy.visit('/');
          cy.get('li.nav-item').contains("My ASBA", { matchCase: false }).click();

          cy.get(".company-list .company-name span[tooltip='Company Name']").contains(data.companyName).should('be.visible');
          cy.get(".company-list").contains(data.companyName).parents('.company-list').within(() => {
            cy.get(".action-buttons button").click()
          });

          cy.log(`${member.name}: Applying for ${data.companyName}`);

          // Wait for form to load
          cy.wait(2000);

          // Select bank - use simpler approach from reference code
          if (result.bankName == "" || !result.bankName) {
            cy.get("#selectBank").select(1);
          } else {
            // Try to select by partial text match
            cy.get('#selectBank option').then($options => {
              const availableBanks = [...$options]
                .map((opt, idx) => ({ value: opt.value, text: opt.text.trim(), index: idx }))
                .filter(opt => opt.text && opt.text !== 'Please choose one');

              console.log(`${member.name} - Available banks:`, availableBanks.map(b => b.text));
              console.log(`${member.name} - Looking for:`, result.bankName);

              const matchingBank = availableBanks.find(bank => {
                const bankUpper = bank.text.toUpperCase();
                const requestedUpper = result.bankName.toUpperCase();
                return bankUpper.includes(requestedUpper) || requestedUpper.includes(bankUpper);
              });

              if (matchingBank) {
                cy.log(`${member.name}: Found matching bank: ${matchingBank.text}`);
                cy.get("#selectBank").select(matchingBank.value);
              } else {
                cy.log(`${member.name}: Bank not found, selecting first available`);
                cy.get("#selectBank").select(availableBanks[0].value);
              }
            });
          }

          // Verify bank is selected
          cy.get('#selectBank').should('not.have.value', '');

          // Select account number - wait for it to populate
          cy.get('#accountNumber').should('be.visible')
            .find('option').should('have.length.gt', 1)
            .eq(1).then($option => {
              cy.get('#accountNumber').select($option.val());
            });

          // Enter kitta
          cy.get('#appliedKitta').clear().type(result.kitta).should("have.value", result.kitta);

          // Enter CRN
          cy.get("#crnNumber").clear().type(result.crn, { log: false });

          // Accept terms
          cy.get('#disclaimer').check().should("be.checked");

          // Proceed
          cy.get('button').contains("proceed", { matchCase: false }).click();

          // Enter transaction PIN and submit
          cy.get("#transactionPIN").type(result.transactionPin, { log: false });
          cy.get("button").contains("Apply").click();

          // Wait for response
          cy.wait('@apply_share', { timeout: 30000 }).then((resp) => {
            const statusCode = resp.response.statusCode;
            const responseBody = resp.response.body;

            if (statusCode === 201) {
              cy.log(`${member.name}: ✅ Successfully applied for ${data.companyName}`);
            } else if (statusCode === 409) {
              cy.log(`${member.name}: ⚠️ Already applied to ${data.companyName}`);
            } else if (statusCode === 400) {
              cy.log(`${member.name}: ❌ Application failed for ${data.companyName}: ${responseBody.message}`);
            }

            expect([201, 400, 409]).to.include(statusCode);
          })
        })
      })
    });
  });
});
