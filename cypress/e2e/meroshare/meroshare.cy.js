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
    let applicationResults = {
      member: member.name,
      totalIPOs: 0,
      eligibleIPOs: 0,
      appliedIPOs: [],
      status: 'pending'
    };

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
        
        applicationResults.totalIPOs = response.length;
        
        // Filter for eligible IPOs
        let filtered_response = response.filter((data) => {
          return !data.action && 
                 data.shareTypeName === "IPO" && 
                 data.shareGroupName === "Ordinary Shares" && 
                 data.subGroup === "For General Public";
        });
        
        applicationResults.eligibleIPOs = filtered_response.length;
        
        cy.log(`${member.name}: Found ${response.length} IPOs, ${filtered_response.length} eligible`);
        resppp.push(filtered_response);
      });
    });


    it('Apply for Share', function() {
      if (!resppp[0] || resppp[0].length === 0) {
        cy.log('No eligible IPOs available');
        
        // Set status based on whether IPOs exist but don't meet criteria
        if (applicationResults.totalIPOs > 0) {
          applicationResults.status = 'not_eligible';
        } else {
          applicationResults.status = 'no_ipos';
        }
        
        // Write result to file
        cy.writeFile(`cypress/results/${member.name}-result.json`, applicationResults);
        
        this.skip();
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

          cy.log(`Applying for ${data.companyName}`);

          // Wait for bank dropdown to load
          cy.wait(2000);
          
          // Select bank
          if (result.bankName == "" || !result.bankName) {
            cy.get("#selectBank").select(1);
          } else {
            cy.get('#selectBank option').should('have.length.gt', 1);
            
            cy.get('#selectBank option').then($options => {
              const availableBanks = [...$options]
                .map(opt => ({ value: opt.value, text: opt.text.trim() }))
                .filter(opt => opt.text && opt.text !== 'Please choose one');
              
              const matchingBank = availableBanks.find(bank => {
                const bankUpper = bank.text.toUpperCase();
                const requestedUpper = result.bankName.toUpperCase();
                return bankUpper.includes(requestedUpper) || requestedUpper.includes(bankUpper);
              });
              
              if (matchingBank) {
                cy.get("#selectBank").select(matchingBank.value);
              } else {
                cy.get("#selectBank").select(availableBanks[0].value);
              }
            });
          }

          cy.get('#selectBank').should('not.have.value', '');

          // Select account number
          cy.get('#accountNumber').should('be.visible')
            .find('option').eq(1)
            .then($option => {
              cy.get('#accountNumber').select($option.val());
            });

          // Enter kitta
          cy.get('#appliedKitta').type(result.kitta).should("have.value", result.kitta);

          // Enter CRN
          cy.get("#crnNumber").type(result.crn, { log: false });

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
              cy.log(`✅ Successfully applied for ${data.companyName}`);
              applicationResults.appliedIPOs.push({
                company: data.companyName,
                scrip: data.scrip,
                status: 'success',
                message: responseBody.message
              });
              applicationResults.status = 'applied';
            } else if (statusCode === 409) {
              cy.log(`⚠️ ${responseBody.message || 'Already applied'}`);
              applicationResults.appliedIPOs.push({
                company: data.companyName,
                scrip: data.scrip,
                status: 'already_applied',
                message: responseBody.message
              });
              applicationResults.status = 'already_applied';
            } else if (statusCode === 400) {
              cy.log(`❌ ${responseBody.message || 'Invalid data'}`);
              applicationResults.appliedIPOs.push({
                company: data.companyName,
                scrip: data.scrip,
                status: 'failed',
                message: responseBody.message
              });
              applicationResults.status = 'failed';
            }
            
            // Write result to file
            cy.writeFile(`cypress/results/${member.name}-result.json`, applicationResults);
            
            expect([201, 400, 409]).to.include(statusCode);
          })
        })
      })
    });
  });
});