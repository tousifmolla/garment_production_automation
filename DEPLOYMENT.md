# Web App Deployment Acceptance

## Pre-deploy

1. Run `verifySystemSetup()` and confirm success with no errors.
2. Run `verifyTriggerReadiness()` and confirm the two required triggers are installed without duplicates.
3. Run `verifyWebAppDeploymentReadiness()` and confirm `readyToDeploy: true`.

## Manual deployment

1. In the bound Apps Script project, select **Deploy → New deployment → Web app**.
2. Select **Execute as: User accessing the web app**.
3. Select **Who has access: Anyone in the domain**.
4. Authorize the deployment if Google prompts, then record the Production Web App URL in the approved operations record.

## Post-deploy acceptance

1. Test the active administrator login and dashboard.
2. Test an active department user and confirm only that user's department data is visible.
3. Test an unauthorized domain account and confirm access is denied.
4. Test an invalid query parameter and direct page URL; the single app shell must not reveal data without an authorized server call.
5. Test a department-user attempt to request an admin dashboard or another department's task; server authorization must deny it.
6. Test account switching and confirm the active signed-in identity is re-evaluated.

Do not include spreadsheet IDs, Script IDs, email addresses, authorization URLs, or other secrets in deployment records.
