/** Phase 1 smoke test; run after initializeSystem. */
function testPhase1Installation() {
  const result = validateInstallation();
  if (!result.valid) throw new Error(result.errors.join('; '));
  const departments = getSheetData(APP_CONFIG.SHEETS.DEPARTMENTS);
  const workflow = getSheetData(APP_CONFIG.SHEETS.WORKFLOW_CONFIG);
  if (departments.length !== 6 || workflow.length !== 6) throw new Error('Default department/workflow seed failed.');
  return { success: true, departments: departments.length, workflowSteps: workflow.length };
}
