function getDefaultDepartments_() {
  return [
    ['DEPT-001', 'Purchase', 1], ['DEPT-002', 'Cutting', 2],
    ['DEPT-003', 'Stitching / Making', 3], ['DEPT-004', 'Finishing', 4],
    ['DEPT-005', 'Packaging', 5], ['DEPT-006', 'Selling', 6]
  ];
}

function getDefaultSettings_() {
  return [
    ['OVERDUE_WARNING_HOURS', '24', 'NUMBER', 'Hours remaining before a task becomes yellow.', formatNow_(), getCurrentEmail_()],
    ['DEFAULT_TASK_PRIORITY', 'NORMAL', 'STRING', 'Default priority for generated tasks.', formatNow_(), getCurrentEmail_()],
    ['DEFAULT_WORKFLOW', 'STANDARD_GARMENT_PIPELINE', 'STRING', 'Workflow used for new orders.', formatNow_(), getCurrentEmail_()],
    ['NOTIFICATIONS_ENABLED', 'TRUE', 'BOOLEAN', 'Enable dashboard notifications.', formatNow_(), getCurrentEmail_()],
    ['EMAIL_NOTIFICATIONS_ENABLED', 'TRUE', 'BOOLEAN', 'Enable email notifications.', formatNow_(), getCurrentEmail_()],
    ['PARTIAL_COMPLETION_ALLOWED', 'FALSE', 'BOOLEAN', 'Whether partial output can activate the next step.', formatNow_(), getCurrentEmail_()],
    ['WORKING_HOURS', '09:00-18:00', 'STRING', 'Standard working hours.', formatNow_(), getCurrentEmail_()],
    ['BUSINESS_DAYS', 'MON,TUE,WED,THU,FRI,SAT', 'STRING', 'Operational business days.', formatNow_(), getCurrentEmail_()],
    ['DEFAULT_COMPLETION_PERCENT', '100', 'NUMBER', 'Default required completion percentage.', formatNow_(), getCurrentEmail_()],
    ['DEFAULT_TASK_DURATION_HOURS', '8', 'NUMBER', 'Default planned duration for a workflow stage.', formatNow_(), getCurrentEmail_()],
    ['DELIVERY_RISK_THRESHOLD_HOURS', '24', 'NUMBER', 'Hours before final delivery used for risk alerts.', formatNow_(), getCurrentEmail_()],
    ['TIMEZONE', 'Asia/Kolkata', 'STRING', 'Organization operating timezone.', formatNow_(), getCurrentEmail_()],
    ['ORGANIZATION_NAME', 'Garment Production', 'STRING', 'Organization display name.', formatNow_(), getCurrentEmail_()]
  ];
}

/**
 * Creates all database tabs and seeds only master configuration. Safe to rerun:
 * existing rows are preserved and schemas are validated before any changes.
 */
function initializeSystem() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = getSpreadsheet_();
    const schemas = getSheetSchemas_();
    Object.keys(schemas).forEach(name => ensureSheet_(spreadsheet, name, schemas[name]));
    seedDefaults_(spreadsheet);
    SpreadsheetApp.flush();
    return { success: true, message: 'Phase 1 database initialized.', spreadsheetId: spreadsheet.getId(), sheets: Object.keys(schemas) };
  } finally {
    lock.releaseLock();
  }
}

function seedDefaults_(spreadsheet) {
  const now = formatNow_();
  const departmentSheet = spreadsheet.getSheetByName(APP_CONFIG.SHEETS.DEPARTMENTS);
  if (departmentSheet.getLastRow() === 1) {
    departmentSheet.getRange(2, 1, 6, 9).setValues(getDefaultDepartments_().map(row => [row[0], row[1], row[2], true, '', 'Default garment pipeline department', now, now, 8]));
  }
  const workflowSheet = spreadsheet.getSheetByName(APP_CONFIG.SHEETS.WORKFLOW_CONFIG);
  if (workflowSheet.getLastRow() === 1) {
    workflowSheet.getRange(2, 1, 6, 12).setValues(getDefaultDepartments_().map(row => ['STANDARD_GARMENT_PIPELINE', 'Standard Garment Pipeline', row[2], row[0], row[1], '{Department Name} - {Product Name}', 100, true, now, now, true, 8]));
  }
  const settingsSheet = spreadsheet.getSheetByName(APP_CONFIG.SHEETS.SETTINGS);
  const existingSettings = getSheetData(APP_CONFIG.SHEETS.SETTINGS).map(setting => setting['Setting Key']);
  const missingSettings = getDefaultSettings_().filter(setting => !existingSettings.includes(setting[0]));
  if (missingSettings.length) settingsSheet.getRange(settingsSheet.getLastRow() + 1, 1, missingSettings.length, 6).setValues(missingSettings);
}

/** Read-only structural validation for deployment checks. */
function validateInstallation() {
  const spreadsheet = getSpreadsheet_();
  const schemas = getSheetSchemas_();
  const errors = Object.keys(schemas).reduce((result, name) => {
    const sheet = spreadsheet.getSheetByName(name);
    if (!sheet) result.push('Missing sheet: ' + name);
    else if (sheet.getRange(1, 1, 1, schemas[name].length).getValues()[0].join('|') !== schemas[name].join('|')) result.push('Header mismatch: ' + name);
    return result;
  }, []);
  return { valid: errors.length === 0, errors: errors, phase: 'Phase 1' };
}

/**
 * Read-only production setup verification. It never creates, repairs, or
 * changes records; it is safe to run before the first administrator exists.
 */
function verifySystemSetup() {
  const checks = [];
  const errors = [];
  const warnings = [];
  const addCheck = (name, passed, message) => {
    checks.push({ name: name, passed: passed, message: message });
    if (!passed) errors.push(message);
  };
  try {
    const spreadsheet = getSpreadsheet_();
    addCheck('spreadsheet_access', !!spreadsheet, spreadsheet ? 'Bound production spreadsheet is accessible.' : 'Bound production spreadsheet is not accessible.');
    const schemas = getSheetSchemas_();
    const headerValid = {};
    Object.keys(schemas).forEach(name => {
      const sheet = spreadsheet.getSheetByName(name);
      const valid = !!sheet && sheet.getRange(1, 1, 1, schemas[name].length).getValues()[0].join('|') === schemas[name].join('|');
      headerValid[name] = valid;
      addCheck('schema_' + name, valid, valid ? 'Schema is valid: ' + name : 'Missing or invalid schema: ' + name);
    });
    if (Object.keys(schemas).every(name => headerValid[name])) {
      const settings = getSheetData(APP_CONFIG.SHEETS.SETTINGS);
      const requiredSettings = getDefaultSettings_().map(setting => setting[0]);
      const settingKeys = settings.map(setting => String(setting['Setting Key']));
      const missingSettings = requiredSettings.filter(key => !settingKeys.includes(key));
      addCheck('settings', missingSettings.length === 0, missingSettings.length ? 'Missing required settings.' : 'Required settings are configured.');

      const departments = getSheetData(APP_CONFIG.SHEETS.DEPARTMENTS);
      const activeDepartments = departments.filter(department => isTrue_(department['Active']));
      addCheck('departments', activeDepartments.length > 0, activeDepartments.length ? 'Active departments are configured.' : 'No active departments are configured.');

      const workflow = getSheetData(APP_CONFIG.SHEETS.WORKFLOW_CONFIG);
      const activeWorkflow = workflow.filter(step => isTrue_(step['Active']));
      const uniqueSteps = new Set(activeWorkflow.map(step => String(step['Workflow ID']) + '|' + String(step['Step Number'])));
      addCheck('workflow', activeWorkflow.length > 0 && uniqueSteps.size === activeWorkflow.length, activeWorkflow.length > 0 && uniqueSteps.size === activeWorkflow.length ? 'Active workflow configuration is valid.' : 'Active workflow configuration is missing or has duplicate steps.');

      const properties = PropertiesService.getScriptProperties();
      addCheck('id_allocation', !!properties, properties ? 'Script properties are available for ID allocation.' : 'Script properties are unavailable for ID allocation.');
      if (properties && typeof properties.getProperties === 'function') {
        const invalidCounters = Object.keys(properties.getProperties()).filter(key => key.indexOf('SEQ_') === 0)
          .filter(key => !/^\d+$/.test(String(properties.getProperty(key))));
        addCheck('id_counters', invalidCounters.length === 0, invalidCounters.length ? 'One or more ID counters are invalid.' : 'Existing ID counters are valid.');
      } else {
        warnings.push('ID counter values could not be enumerated in this runtime; ID allocation service is available.');
      }
      const activeAdmins = getSheetData(APP_CONFIG.SHEETS.USERS).filter(isActiveAdministrator_).length;
      if (!activeAdmins) warnings.push('No active administrator exists yet; configure the initial administrator and run bootstrapInitialAdmin().');
    }
  } catch (error) {
    errors.push('Verification could not complete: ' + String(error && error.message || error));
  }
  const failed = checks.filter(check => !check.passed).length;
  const result = { success: errors.length === 0, passed: checks.length - failed, failed: failed, warnings: warnings.length, checks: checks, errors: errors, warningMessages: warnings };
  console.log(JSON.stringify(result, null, 2));
  return result;
}
