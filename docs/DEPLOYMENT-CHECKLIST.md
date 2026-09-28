# Deployment checklist

1. Copy the target Google Sheet as a backup; retain a timestamped read-only copy before integration tests.
2. Bind this Apps Script project to the new Sheet and add all `.gs`/HTML files plus `appsscript.json`.
3. Run `initializeSystem()`, then run the read-only `verifySystemSetup()`. In Apps Script **Project Settings → Script properties**, set `GARMENT_INITIAL_ADMIN_EMAIL` to the intended administrator’s Workspace email. Run read-only `checkInitialAdminConfig()`; it must report `configured: true`, `validFormat: true`, and `bootstrapAllowed: true`. Then run `bootstrapInitialAdmin()` while signed in as that exact account.
4. Create active department users with `createUser`; verify each email is a real Workspace identity.
5. Run read-only `verifyTriggerReadiness()` first. Confirm `readyToInstall: true`; review `pendingEmailNotifications` because any pending email record can be sent on the next scheduled notification run. Only then run `installProductionTriggers()` once as the sole active admin and confirm two 15-minute triggers in Apps Script **Triggers**. Trigger status is visible only to the account that owns those triggers.
6. Deploy **Web app**: execute as the deploying user; restrict access to the required signed-in Workspace audience. Do not use public access for production.
7. Authorize spreadsheet, email, trigger, and identity scopes. Test with admin, department, unknown, and inactive accounts.
8. Create a test order, verify workflow/alerts/notifications, then run `rebuildReportingData()`.
9. For Power BI, use an authenticated connector/API or governed export. Do not make the Sheet public merely to refresh it.
10. Monitor execution history and trigger failures. Roll back by redeploying a prior Apps Script version and restoring the backup copy; do not overwrite production history blindly.
