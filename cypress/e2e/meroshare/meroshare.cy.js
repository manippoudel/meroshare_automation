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

    let eligibleIPOs = [];
    let applicationResults = {
      member: member.name,
      totalIPOs: 0,
      eligibleIPOs: 0,
      appliedIPOs: [],
      status: 'pending'
    };

    before(() => {
      // Stagger members to avoid rate limiting from MeroShare server
      if (index > 0) {
        cy.wait(index * 5000);
      }

      cy.intercept("POST", "https://webbackend.cdsc.com.np/api/meroShare/companyShare/applicableIssue/").as("applicableshare");
      cy.intercept("POST", "https://webbackend.cdsc.com.np/api/meroShare/applicantForm/share/apply").as('apply_share');

      cy.visit('/');
      cy.login(result.password, result.username, result.dp);

      // login() already waits for nav to be visible - now click My ASBA
      cy.get('li.nav-item').contains("My ASBA", { matchCase: false }).click();

      cy.wait("@applicableshare").then((resp) => {
        const response = resp.response.body.object;
        applicationResults.totalIPOs = response.length;

        const filtered = response.filter((data) => {
          const eligible = !data.action &&
            data.shareTypeName === "IPO" &&
            data.shareGroupName === "Ordinary Shares" &&
            data.subGroup === "For General Public";

          if (eligible) {
            cy.log(`${member.name} - ELIGIBLE: ${data.companyName}`);
          } else {
            const reasons = [];
            if (data.action) reasons.push('Already applied');
            if (data.shareTypeName !== "IPO") reasons.push(`Type=${data.shareTypeName}`);
            if (data.shareGroupName !== "Ordinary Shares") reasons.push(`Group=${data.shareGroupName}`);
            if (data.subGroup !== "For General Public") reasons.push(`SubGroup=${data.subGroup}`);
            cy.log(`${member.name} - FILTERED: ${data.companyName} [${reasons.join(', ')}]`);
          }
          return eligible;
        });

        applicationResults.eligibleIPOs = filtered.length;
        eligibleIPOs.push(...filtered);
      });
    });

    it('Apply for Share', () => {
      if (eligibleIPOs.length === 0) {
        cy.log(`${member.name}: No eligible IPOs to apply`);
        applicationResults.status = applicationResults.totalIPOs > 0 ? 'not_eligible' : 'no_ipos';
        cy.writeFile(`cypress/results/${member.name}-result.json`, applicationResults);
        return;
      }

      eligibleIPOs.forEach((data) => {
        // Re-intercept for this navigation
        cy.intercept("POST", "https://webbackend.cdsc.com.np/api/meroShare/companyShare/applicableIssue/").as("applicableshare2");

        cy.visit('/');
        cy.get('li.nav-item').contains("My ASBA", { matchCase: false }).click();

        // Wait for the company list to fully load before interacting
        cy.wait("@applicableshare2");

        // Normalize whitespace - API sometimes returns double spaces in company names
        const companyName = data.companyName.replace(/\s+/g, ' ').trim();

        cy.get(".company-list .company-name span[tooltip='Company Name']")
          .contains(companyName)
          .should('be.visible');

        cy.get(".company-list").contains(companyName).parents('.company-list').within(() => {
          cy.get(".action-buttons button").click();
        });

        cy.log(`${member.name}: Applying for ${companyName}`);

        // Wait for bank dropdown to populate
        cy.get('#selectBank option').should('have.length.gt', 1);

        // Select bank
        if (!result.bankName || result.bankName.trim() === '') {
          cy.get("#selectBank").select(1);
        } else {
          cy.get('#selectBank option').then($options => {
            const banks = [...$options]
              .map(opt => ({ value: opt.value, text: opt.text.trim() }))
              .filter(opt => opt.text && opt.text !== 'Please choose one');

            const match = banks.find(b =>
              b.text.toUpperCase().includes(result.bankName.toUpperCase()) ||
              result.bankName.toUpperCase().includes(b.text.toUpperCase())
            );

            if (match) {
              cy.log(`${member.name}: Selecting bank: ${match.text}`);
              cy.get("#selectBank").select(match.value);
            } else {
              cy.log(`${member.name}: Bank not found, using first available`);
              cy.get("#selectBank").select(banks[0].value);
            }
          });
        }

        cy.get('#selectBank').should('not.have.value', '');

        // Select account number
        cy.get('#accountNumber').should('be.visible')
          .find('option').should('have.length.gt', 1)
          .eq(1).then($opt => {
            cy.get('#accountNumber').select($opt.val());
          });

        // Fill form
        cy.get('#appliedKitta').clear().type(result.kitta).should("have.value", `${result.kitta}`);
        cy.get("#crnNumber").clear().type(result.crn, { log: false });
        cy.get('#disclaimer').check().should("be.checked");
        cy.get('button').contains("proceed", { matchCase: false }).click();
        cy.get("#transactionPIN").type(result.transactionPin, { log: false });
        cy.get("button").contains("Apply").click();

        cy.wait('@apply_share', { timeout: 30000 }).then((resp) => {
          const statusCode = resp.response.statusCode;
          const body = resp.response.body;

          if (statusCode === 201) {
            cy.log(`${member.name}: ✅ Applied for ${companyName}`);
            applicationResults.appliedIPOs.push({ company: companyName, scrip: data.scrip, status: 'success', message: body.message });
            applicationResults.status = 'applied';
          } else if (statusCode === 409) {
            cy.log(`${member.name}: ⚠️ Already applied to ${companyName}`);
            applicationResults.appliedIPOs.push({ company: companyName, scrip: data.scrip, status: 'already_applied', message: body.message });
            applicationResults.status = 'already_applied';
          } else {
            cy.log(`${member.name}: ❌ Failed for ${companyName}: ${body.message}`);
            applicationResults.appliedIPOs.push({ company: companyName, scrip: data.scrip, status: 'failed', message: body.message });
            applicationResults.status = 'failed';
          }

          cy.writeFile(`cypress/results/${member.name}-result.json`, applicationResults);
          expect([201, 409]).to.include(statusCode);
        });
      });
    });
  });
});
