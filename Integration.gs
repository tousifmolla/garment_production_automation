/** Canonical, production-required time-driven trigger definitions. */
function getRequiredProductionTriggers_() {
  return [
    { handler: 'monitorDeadlines', frequencyMinutes: 15 },
    { handler: 'processPendingNotifications', frequencyMinutes: 15 }
  ];
}

function isRequiredTriggerHandlerAvailable_(handler) {
  if (handler === 'monitorDeadlines') return typeof monitorDeadlines === 'function';
  if (handler === 'processPendingNotifications') return typeof processPendingNotifications === 'function';
  return false;
}

/** Install only missing triggers and remove only duplicate copies. Admin only. */
function setupTriggers() {
  return withScriptLock_(() => {
    requireAdmin_();
    const readiness = verifyTriggerReadiness();
    if (!readiness.readyToInstall) {
      throw new Error('Production trigger preflight failed. Run verifyTriggerReadiness() and correct all reported prerequisites before installation.');
    }
    const definitions = getRequiredProductionTriggers_();
    const existing = ScriptApp.getProjectTriggers();
    const created = [];
    const existingHandlers = [];
    const removedDuplicates = [];
    definitions.forEach(definition => {
      const matching = existing.filter(trigger => trigger.getHandlerFunction() === definition.handler);
      if (!matching.length) {
        ScriptApp.newTrigger(definition.handler).timeBased().everyMinutes(definition.frequencyMinutes).create();
        created.push(definition.handler);
      } else {
        existingHandlers.push(definition.handler);
        if (matching.length > 1) {
          matching.slice(1).forEach(trigger => ScriptApp.deleteTrigger(trigger));
          removedDuplicates.push(definition.handler);
        }
      }
    });
    return {
      success: true,
      handlers: definitions.map(definition => definition.handler),
      existing: existingHandlers,
      created: created,
      removedDuplicates: removedDuplicates,
      message: 'Production readiness passed; required deadline and notification triggers were verified.'
    };
  });
}

/** Canonical admin-only installer for this application's required triggers. */
function installProductionTriggers() {
  const result = setupTriggers();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/** Removes only this application's known production trigger handlers. Admin only. */
function removeProductionTriggers() {
  return withScriptLock_(() => {
    requireAdmin_();
    const handlers = getRequiredProductionTriggers_().map(definition => definition.handler);
    const removed = [];
    ScriptApp.getProjectTriggers().filter(trigger => handlers.includes(trigger.getHandlerFunction())).forEach(trigger => {
      removed.push(trigger.getHandlerFunction());
      ScriptApp.deleteTrigger(trigger);
    });
    const result = { success: true, removedHandlers: removed, message: 'Known production triggers were removed; unrelated triggers were preserved.' };
    console.log(JSON.stringify(result, null, 2));
    return result;
  });
}

function validateTriggers() {
  requireAdmin_();
  const handlers = ScriptApp.getProjectTriggers().map(trigger => trigger.getHandlerFunction());
  const required = getRequiredProductionTriggers_().map(definition => definition.handler);
  return { valid: required.every(handler => handlers.filter(value => value === handler).length === 1), handlers: handlers };
}

/**
 * Read-only authorization probe. It never creates, deletes, or executes a
 * trigger, and deliberately returns no authorization URL or account details.
 */
function checkScriptAuthorizationStatus() {
  const errors = [];
  let currentUserIsAdmin = false;

  try {
    requireAdmin_();
    currentUserIsAdmin = true;
  } catch (error) {
    errors.push('Active administrator authorization is required.');
  }

  const summarize = authorizationInfo => {
    const status = String(authorizationInfo.getAuthorizationStatus());
    let authorizationUrlAvailable = false;
    try {
      authorizationUrlAvailable = Boolean(authorizationInfo.getAuthorizationUrl());
    } catch (error) {
      // A URL is available only when Apps Script can present an authorization flow.
      authorizationUrlAvailable = false;
    }
    return {
      status: status,
      authorizationRequired: status === 'REQUIRED',
      authorizationUrlAvailable: authorizationUrlAvailable
    };
  };

  let full = { status: 'UNKNOWN', authorizationRequired: false, authorizationUrlAvailable: false };
  let scriptApp = { status: 'UNKNOWN', authorizationRequired: false, authorizationUrlAvailable: false };
  try {
    full = summarize(ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL));
  } catch (error) {
    errors.push('Full Apps Script authorization status could not be read.');
  }
  try {
    scriptApp = summarize(ScriptApp.getAuthorizationInfo(
      ScriptApp.AuthMode.FULL,
      ['https://www.googleapis.com/auth/script.scriptapp']));
  } catch (error) {
    errors.push('ScriptApp trigger authorization status could not be read.');
  }

  const result = {
    success: errors.length === 0,
    currentUserIsAdmin: currentUserIsAdmin,
    full: full,
    scriptApp: scriptApp,
    errors: errors
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Starts the standard Apps Script consent flow for this project's declared
 * scopes. It does not read or modify production business data or triggers.
 * This function must be run manually by the active Production administrator.
 */
function requestProductionAuthorization() {
  requireAdmin_();
  ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  const result = {
    success: true,
    message: 'All declared Apps Script scopes are authorized for the current account.'
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Read-only preflight for scheduled production operations. It does not install,
 * remove, or execute triggers; it also never reads notification recipient emails.
 */
function verifyTriggerReadiness() {
  const errors = [];
  const warnings = [];
  let installation = { valid: false, errors: ['Installation check did not run.'] };
  let users = [];
  let departments = [];
  let workflow = [];
  let notifications = [];
  let settings = [];
  let installedTriggers = [];
  const definitions = getRequiredProductionTriggers_();
  const requiredHandlers = definitions.map(definition => definition.handler);

  try { requireAdmin_(); } catch (error) { errors.push('Active administrator authorization is required for trigger verification.'); }
  try { installation = validateInstallation(); } catch (error) { errors.push('Production installation could not be verified.'); }
  try { users = getSheetData(APP_CONFIG.SHEETS.USERS); } catch (error) { errors.push('Users configuration could not be read.'); }
  try { departments = getSheetData(APP_CONFIG.SHEETS.DEPARTMENTS); } catch (error) { errors.push('Department configuration could not be read.'); }
  try { workflow = getActiveWorkflow_(); } catch (error) { errors.push('Active workflow configuration could not be read.'); }
  try { settings = getSheetData(APP_CONFIG.SHEETS.SETTINGS); } catch (error) { errors.push('Notification settings could not be read.'); }
  try { notifications = getSheetData(APP_CONFIG.SHEETS.NOTIFICATIONS); } catch (error) { errors.push('Notification queue could not be read.'); }
  try {
    installedTriggers = ScriptApp.getProjectTriggers().map(trigger => ({
      handler: trigger.getHandlerFunction(),
      eventType: typeof trigger.getEventType === 'function' ? String(trigger.getEventType()) : 'UNKNOWN'
    }));
  } catch (error) {
    errors.push('Installed trigger status could not be read.');
  }

  const activeAdminCount = users.filter(isActiveAdministrator_).length;
  const activeDepartmentCount = departments.filter(department => isTrue_(department['Active'])).length;
  const valuesByKey = settings.reduce((result, setting) => {
    result[String(setting['Setting Key'])] = String(setting['Setting Value']).toUpperCase();
    return result;
  }, {});
  const notificationSettingsValid = ['NOTIFICATIONS_ENABLED', 'EMAIL_NOTIFICATIONS_ENABLED']
    .every(key => valuesByKey[key] === 'TRUE' || valuesByKey[key] === 'FALSE');
  const dashboardNotificationsEnabled = valuesByKey.NOTIFICATIONS_ENABLED === 'TRUE';
  const emailNotificationsEnabled = valuesByKey.EMAIL_NOTIFICATIONS_ENABLED === 'TRUE';
  const pendingEmailNotifications = notifications.filter(notification =>
    notification['Channel'] === 'EMAIL' && notification['Status'] === 'PENDING').length;
  const availableHandlers = requiredHandlers.filter(isRequiredTriggerHandlerAvailable_);
  const handlerCounts = requiredHandlers.reduce((result, handler) => {
    result[handler] = installedTriggers.filter(trigger => trigger.handler === handler).length;
    return result;
  }, {});
  const missingTriggers = requiredHandlers.filter(handler => handlerCounts[handler] === 0);
  const duplicateTriggers = requiredHandlers.filter(handler => handlerCounts[handler] > 1);
  const triggersInstalledCorrectly = missingTriggers.length === 0 && duplicateTriggers.length === 0;
  const baseReady = installation.valid && activeAdminCount > 0 && activeDepartmentCount > 0 && workflow.length > 0 &&
    notificationSettingsValid && availableHandlers.length === requiredHandlers.length && errors.length === 0;

  if (!baseReady) warnings.push('Production prerequisites must be corrected before installing triggers.');
  if (missingTriggers.length) warnings.push('Required triggers are not installed yet: ' + missingTriggers.join(', ') + '.');
  if (duplicateTriggers.length) warnings.push('Duplicate required triggers are installed: ' + duplicateTriggers.join(', ') + '.');
  if (emailNotificationsEnabled && pendingEmailNotifications > 0) warnings.push('Pending email notifications exist and will be processed by the notification trigger.');
  const result = {
    success: errors.length === 0,
    readyToInstall: baseReady,
    triggersInstalledCorrectly: triggersInstalledCorrectly,
    expectedTriggers: definitions,
    triggerVisibility: 'Installed trigger status is limited to triggers owned by the currently authorized Apps Script account.',
    installedTriggers: installedTriggers,
    missingTriggers: missingTriggers,
    duplicateTriggers: duplicateTriggers,
    activeAdminCount: activeAdminCount,
    activeDepartmentCount: activeDepartmentCount,
    activeWorkflowStepCount: workflow.length,
    notificationSettings: {
      dashboardEnabled: dashboardNotificationsEnabled,
      emailEnabled: emailNotificationsEnabled,
      valid: notificationSettingsValid
    },
    pendingEmailNotifications: pendingEmailNotifications,
    emailCouldBeSentOnNextScheduledRun: emailNotificationsEnabled && pendingEmailNotifications > 0,
    errors: errors,
    warnings: warnings
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Read-only preflight for manual Web App deployment. It validates only the
 * currently loaded project contracts and Production readiness; it never
 * creates a deployment, changes trigger state, or modifies spreadsheet data.
 */
function verifyWebAppDeploymentReadiness() {
  const errors = [];
  const warnings = [];
  let system = { success: false };
  let triggers = { success: false, triggersInstalledCorrectly: false };
  let adminReady = false;
  let identityReady = false;

  try { system = verifySystemSetup(); } catch (error) { errors.push('System setup verification could not be completed.'); }
  try { requireAdmin_(); adminReady = true; } catch (error) { errors.push('Active administrator authorization is required.'); }
  try { getAuthenticatedEmail_(); identityReady = true; } catch (error) { errors.push('Signed-in identity is unavailable for this execution context.'); }
  try { triggers = verifyTriggerReadiness(); } catch (error) { errors.push('Trigger readiness verification could not be completed.'); }

  const requiredTemplates = ['Index', 'CSS', 'AdminDashboard', 'DepartmentDashboard', 'JS'];
  const templatesReady = requiredTemplates.every(name => {
    try { HtmlService.createHtmlOutputFromFile(name); return true; } catch (error) { errors.push('Required HTML template is unavailable: ' + name + '.'); return false; }
  });
  const serverFunctions = {
    doGet: typeof doGet === 'function', getMyProfile: typeof getMyProfile === 'function', getWebAppProfile: typeof getWebAppProfile === 'function',
    getAdminDashboard: typeof getAdminDashboard === 'function', getDepartmentDashboard: typeof getDepartmentDashboard === 'function',
    getUserNotifications: typeof getUserNotifications === 'function', listAlerts: typeof listAlerts === 'function',
    listMyAlerts: typeof listMyAlerts === 'function', acknowledgeAlert: typeof acknowledgeAlert === 'function',
    createProductionOrder: typeof createProductionOrder === 'function', startTask: typeof startTask === 'function',
    updateTaskProgress: typeof updateTaskProgress === 'function', putTaskOnHold: typeof putTaskOnHold === 'function',
    resumeTask: typeof resumeTask === 'function', reportTaskBlocked: typeof reportTaskBlocked === 'function',
    completeTask: typeof completeTask === 'function'
  };
  const missingServerFunctions = Object.keys(serverFunctions).filter(name => !serverFunctions[name]);
  const clientServerContractsReady = missingServerFunctions.length === 0;
  if (!clientServerContractsReady) errors.push('Required server functions are unavailable: ' + missingServerFunctions.join(', ') + '.');

  const routingReady = typeof doGet === 'function' && templatesReady;
  const authorizationReady = adminReady && identityReady;
  const result = {
    success: errors.length === 0,
    readyToDeploy: system.success && adminReady && triggers.success && triggers.triggersInstalledCorrectly && routingReady && authorizationReady && clientServerContractsReady && errors.length === 0,
    systemHealthy: system.success,
    adminReady: adminReady,
    triggersReady: triggers.success && triggers.triggersInstalledCorrectly,
    routingReady: routingReady,
    authorizationReady: authorizationReady,
    clientServerContractsReady: clientServerContractsReady,
    missingServerFunctions: missingServerFunctions,
    identityModel: 'Server-side identity uses Session email when available, otherwise a verified external Google OAuth session.',
    recommendedExecuteAs: 'USER_DEPLOYING',
    recommendedAccess: 'ANYONE',
    errors: errors,
    warnings: warnings
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/** Read-only preflight for live Web App acceptance and department-user onboarding. */
function verifyLiveWebAppAcceptanceReadiness() {
  const errors = [];
  let webApp = { readyToDeploy: false };
  let triggerReadiness = { success: false, triggersInstalledCorrectly: false };
  let activeAdmin = false;
  let onboardingEndpointsReady = false;
  let noProductionOrders = false;

  try { requireAdmin_(); activeAdmin = true; } catch (error) { errors.push('Active administrator authorization is required.'); }
  try { webApp = verifyWebAppDeploymentReadiness(); } catch (error) { errors.push('Web App deployment readiness could not be verified.'); }
  try { triggerReadiness = verifyTriggerReadiness(); } catch (error) { errors.push('Trigger readiness could not be verified.'); }
  onboardingEndpointsReady = typeof listUsers === 'function' && typeof createUser === 'function' && typeof listDepartments === 'function';
  if (!onboardingEndpointsReady) errors.push('Department-user onboarding endpoints are unavailable.');
  try { noProductionOrders = getSheetData(APP_CONFIG.SHEETS.PRODUCTION_ORDERS).length === 0; } catch (error) { errors.push('Production order state could not be verified.'); }

  const result = {
    success: errors.length === 0,
    readyForUserOnboarding: activeAdmin && webApp.readyToDeploy && triggerReadiness.success && triggerReadiness.triggersInstalledCorrectly && onboardingEndpointsReady && errors.length === 0,
    activeAdmin: activeAdmin,
    systemHealthy: webApp.systemHealthy === true,
    triggersHealthy: triggerReadiness.success && triggerReadiness.triggersInstalledCorrectly,
    onboardingEndpointsReady: onboardingEndpointsReady,
    noProductionOrders: noProductionOrders,
    errors: errors,
    warnings: noProductionOrders ? [] : ['Production orders already exist; continue onboarding only under the approved operational process.']
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Read-only first-order preflight after a department user has been onboarded.
 * It deliberately returns counts and booleans only: no emails, IDs, or values
 * from production records are exposed.
 */
function verifyDepartmentUserAcceptanceReadiness() {
  const errors = [];
  const warnings = [];
  let system = { success: false };
  let triggers = { success: false, triggersInstalledCorrectly: false };
  let users = [];
  let departments = [];
  let workflow = [];
  let products = [];
  let customers = [];

  try { requireAdmin_(); } catch (error) { errors.push('Active administrator authorization is required.'); }
  try { system = verifySystemSetup(); } catch (error) { errors.push('Production system health could not be verified.'); }
  try { triggers = verifyTriggerReadiness(); } catch (error) { errors.push('Trigger readiness could not be verified.'); }
  try {
    users = getSheetData(APP_CONFIG.SHEETS.USERS);
    departments = getSheetData(APP_CONFIG.SHEETS.DEPARTMENTS);
    workflow = getActiveWorkflow_();
    products = getSheetData(APP_CONFIG.SHEETS.PRODUCTS);
    customers = getSheetData(APP_CONFIG.SHEETS.CUSTOMERS);
  } catch (error) {
    errors.push('Production readiness records could not be read.');
  }

  const activeAdmins = users.filter(isActiveAdministrator_);
  const activeDepartmentUsers = users.filter(user => user['Role'] === APP_CONFIG.ROLES.DEPARTMENT_USER && isTrue_(user['Active']));
  const purchaseDepartment = departments.find(department => isTrue_(department['Active']) && String(department['Department Name']).trim().toUpperCase() === 'PURCHASE');
  const purchaseDepartmentUserReady = !!purchaseDepartment && activeDepartmentUsers.some(user => String(user['Department ID']) === String(purchaseDepartment['Department ID']));
  const activeProductCount = products.filter(product => isTrue_(product['Active'])).length;
  const activeCustomerCount = customers.filter(customer => isTrue_(customer['Active'])).length;
  const workflowReady = workflow.length > 0 && purchaseDepartment && String(workflow[0]['Department ID']) === String(purchaseDepartment['Department ID']);
  if (!purchaseDepartmentUserReady) warnings.push('No active Purchase department user is available for the first workflow stage.');
  if (!activeProductCount || !activeCustomerCount) warnings.push('No active Product or Customer master records are available for a master-data-backed order.');

  const result = {
    success: errors.length === 0,
    readyForFirstOrder: activeAdmins.length > 0 && purchaseDepartmentUserReady && workflowReady && activeProductCount > 0 && activeCustomerCount > 0 && system.success && triggers.success && triggers.triggersInstalledCorrectly && errors.length === 0,
    activeAdminCount: activeAdmins.length,
    activeDepartmentUserCount: activeDepartmentUsers.length,
    purchaseDepartmentUserReady: purchaseDepartmentUserReady,
    workflowReady: !!workflowReady,
    systemHealthy: system.success === true,
    triggersHealthy: triggers.success === true && triggers.triggersInstalledCorrectly === true,
    activeProductCount: activeProductCount,
    activeCustomerCount: activeCustomerCount,
    masterDataAvailable: activeProductCount > 0 && activeCustomerCount > 0,
    errors: errors,
    warnings: warnings
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/** Backward-compatible, read-only name for the first-order preflight. */
function verifyFirstProductionOrderReadiness() {
  return verifyDepartmentUserAcceptanceReadiness();
}

/**
 * Read-only diagnostic for a failed trigger preflight. It returns only counts
 * and booleans, never spreadsheet IDs, emails, properties, or trigger IDs.
 */
function diagnoseTriggerReadinessContext() {
  const errors = [];
  let spreadsheetAccessible = false;
  let productionSpreadsheetMatch = false;
  let usersSheetExists = false;
  let users = [];
  let executingIdentityAvailable = false;
  let executingIdentityIsSystemUser = false;
  let executingIdentityIsAdmin = false;
  let triggerListReadable = false;
  let installedTriggerCount = 0;
  let triggerListErrorCategory = '';

  try {
    const spreadsheet = getSpreadsheet_();
    spreadsheetAccessible = !!spreadsheet;
    const active = SpreadsheetApp.getActiveSpreadsheet();
    productionSpreadsheetMatch = !!active && String(active.getId()) === String(spreadsheet.getId());
    usersSheetExists = !!spreadsheet.getSheetByName(APP_CONFIG.SHEETS.USERS);
  } catch (error) {
    errors.push('Production spreadsheet could not be read or did not match the bound project.');
  }
  try {
    users = getSheetData(APP_CONFIG.SHEETS.USERS);
  } catch (error) {
    errors.push('Users sheet could not be read.');
  }
  try {
    getAuthenticatedEmail_();
    executingIdentityAvailable = true;
  } catch (error) {
    errors.push('Executing Google identity is unavailable.');
  }
  try {
    getCurrentUser_();
    executingIdentityIsSystemUser = true;
  } catch (error) {
    errors.push('Executing identity is not an active system user.');
  }
  try {
    requireAdmin_();
    executingIdentityIsAdmin = true;
  } catch (error) {
    errors.push('Executing identity is not an active administrator.');
  }
  try {
    installedTriggerCount = ScriptApp.getProjectTriggers().length;
    triggerListReadable = true;
  } catch (error) {
    const message = String(error && error.message || error).toUpperCase();
    triggerListErrorCategory = /AUTH|PERMISSION|SCOPE|AUTHORIZE/.test(message) ? 'AUTHORIZATION_OR_SCOPE' : 'TRIGGER_SERVICE_ERROR';
    errors.push('Installed trigger list is not readable: ' + triggerListErrorCategory + '.');
  }
  const result = {
    spreadsheetAccessible: spreadsheetAccessible,
    productionSpreadsheetMatch: productionSpreadsheetMatch,
    usersSheetExists: usersSheetExists,
    totalUserCount: users.length,
    activeAdminCount: users.filter(isActiveAdministrator_).length,
    usersWithAdminRoleCount: users.filter(user => user['Role'] === APP_CONFIG.ROLES.ADMIN).length,
    activeUserCount: users.filter(user => isTrue_(user['Active'])).length,
    executingIdentityAvailable: executingIdentityAvailable,
    executingIdentityIsSystemUser: executingIdentityIsSystemUser,
    executingIdentityIsAdmin: executingIdentityIsAdmin,
    triggerListReadable: triggerListReadable,
    installedTriggerCount: installedTriggerCount,
    triggerListErrorCategory: triggerListErrorCategory,
    errors: errors
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/** Non-destructive preflight. Permissions are confirmed when this is run in Apps Script. */
function productionReadinessCheck() {
  requireAdmin_();
  const installation = validateInstallation();
  const users = getSheetData(APP_CONFIG.SHEETS.USERS);
  const workflow = getActiveWorkflow_();
  const duplicateIds = Object.keys(getSheetSchemas_()).reduce((errors, sheetName) => {
    const headers = getSheetSchemas_()[sheetName]; const records = getSheetData(sheetName); const ids = records.map(row => String(row[headers[0]] || '')).filter(Boolean);
    if (new Set(ids).size !== ids.length && sheetName !== APP_CONFIG.SHEETS.WORKFLOW_CONFIG) errors.push('Duplicate IDs in ' + sheetName);
    return errors;
  }, []);
  return { ready: installation.valid && users.some(isActiveAdministrator_) && workflow.length > 0 && duplicateIds.length === 0, installation, activeAdmins: users.filter(isActiveAdministrator_).length, workflowSteps: workflow.length, duplicateIdErrors: duplicateIds };
}

/** Read-only preflight for the controlled backup and recovery-test process. */
function verifyBackupRecoveryReadiness() {
  requireAdmin_();
  const errors = [];
  const remediation = [];
  const config = getBackupRecoveryConfiguration_();
  let folderAccessible = false;
  let recoveryTargetAccessible = false;
  let recoveryTargetSafe = false;
  let knownBackupCount = 0;
  if (!config.backupFolderConfigured) { errors.push('Backup folder property is missing.'); remediation.push('Set GARMENT_BACKUP_FOLDER_ID to the ID of a dedicated Drive folder.'); }
  else if (!config.backupFolderFormatValid) { errors.push('Backup folder property is malformed.'); remediation.push('Replace GARMENT_BACKUP_FOLDER_ID with the folder ID from its Google Drive URL.'); }
  else {
    try { DriveApp.getFolderById(config.backupFolderId); folderAccessible = true; } catch (error) { errors.push('Configured backup folder is inaccessible.'); remediation.push('Grant the executing Apps Script account access to the configured backup folder.'); }
  }
  if (!config.retentionConfigured) { errors.push('Backup retention property is missing.'); remediation.push('Set GARMENT_BACKUP_RETENTION_COUNT to a positive whole number.'); }
  else if (!config.retentionValid) { errors.push('Backup retention value is invalid.'); remediation.push('Set GARMENT_BACKUP_RETENTION_COUNT to a positive whole number such as 10.'); }
  if (!config.recoveryTestConfigured) { errors.push('Recovery-test spreadsheet property is missing.'); remediation.push('Set GARMENT_RECOVERY_TEST_SPREADSHEET_ID to a separate recovery-test spreadsheet ID.'); }
  else if (!config.recoveryTestFormatValid) { errors.push('Recovery-test spreadsheet property is malformed.'); remediation.push('Replace GARMENT_RECOVERY_TEST_SPREADSHEET_ID with the spreadsheet ID from its URL.'); }
  else {
    try {
      const production = getSpreadsheet_();
      const recovery = SpreadsheetApp.openById(config.recoveryTestSpreadsheetId);
      recoveryTargetAccessible = !!recovery;
      recoveryTargetSafe = String(production.getId()) !== String(recovery.getId());
      if (!recoveryTargetSafe) { errors.push('Recovery-test spreadsheet is the Production spreadsheet.'); remediation.push('Use a separate, non-Production spreadsheet for GARMENT_RECOVERY_TEST_SPREADSHEET_ID.'); }
    } catch (error) { errors.push('Configured recovery-test spreadsheet is inaccessible.'); remediation.push('Grant the executing Apps Script account access to the recovery-test spreadsheet.'); }
  }
  if (folderAccessible) knownBackupCount = getKnownBackupFiles_(DriveApp.getFolderById(config.backupFolderId), getSpreadsheet_().getId()).length;
  const result = {
    success: errors.length === 0,
    backupFolderConfigured: Boolean(config.backupFolderId),
    backupFolderFormatValid: config.backupFolderFormatValid,
    backupFolderAccessible: folderAccessible,
    retentionPropertyConfigured: config.retentionConfigured,
    retentionConfigured: config.retentionValid,
    recoveryTestConfigured: Boolean(config.recoveryTestSpreadsheetId),
    recoveryTestFormatValid: config.recoveryTestFormatValid,
    recoveryTargetAccessible: recoveryTargetAccessible,
    recoveryTargetSafe: recoveryTargetSafe,
    knownBackupCount: knownBackupCount,
    errors: errors,
    remediation: remediation
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/** Creates and verifies a tagged backup copy; only known tagged backups are retained. */
function backupSystemData() {
  return withScriptLock_(() => {
    requireAdmin_();
    const actor = getCurrentUser_();
    try {
      const production = getSpreadsheet_();
      const config = getBackupRecoveryConfiguration_();
      if (!config.backupFolderConfigured || !config.backupFolderFormatValid || !config.retentionValid) throw new Error('BACKUP_CONFIGURATION_INVALID');
      const folder = DriveApp.getFolderById(config.backupFolderId);
      const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Kolkata', 'yyyyMMdd-HHmmss');
      const copy = DriveApp.getFileById(production.getId()).makeCopy(APP_CONFIG.BACKUP_FILE_PREFIX + timestamp, folder);
      copy.setDescription(APP_CONFIG.BACKUP_FILE_TAG_PREFIX + production.getId());
      const verified = DriveApp.getFileById(copy.getId());
      if (!verified || String(verified.getDescription() || '') !== APP_CONFIG.BACKUP_FILE_TAG_PREFIX + production.getId()) throw new Error('BACKUP_VERIFICATION_FAILED');
      const retention = enforceBackupRetention_(folder, production.getId(), config.retentionCount);
      const result = { success: true, backupCreated: true, backupVerified: true, retainedBackupCount: retention.retained, archivedBackupCount: retention.archived, errorCode: '' };
      recordBackupRecoveryAudit_(actor, 'BACKUP_CREATED', result);
      console.log(JSON.stringify(result, null, 2));
      return result;
    } catch (error) {
      const result = { success: false, backupCreated: false, backupVerified: false, retainedBackupCount: 0, archivedBackupCount: 0, errorCode: backupRecoveryErrorCode_(error) };
      recordBackupRecoveryAudit_(actor, 'BACKUP_FAILED', result);
      console.log(JSON.stringify(result, null, 2));
      return result;
    }
  });
}

/** Restores only into the configured non-Production test spreadsheet, then validates the copy. */
function runRecoveryTest() {
  return withScriptLock_(() => {
    requireAdmin_();
    const actor = getCurrentUser_();
    try {
      const production = getSpreadsheet_();
      const config = getBackupRecoveryConfiguration_();
      if (!config.backupFolderConfigured || !config.backupFolderFormatValid || !config.retentionValid || !config.recoveryTestConfigured || !config.recoveryTestFormatValid) throw new Error('RECOVERY_CONFIGURATION_INVALID');
      const recovery = SpreadsheetApp.openById(config.recoveryTestSpreadsheetId);
      if (String(recovery.getId()) === String(production.getId())) throw new Error('RECOVERY_TARGET_IS_PRODUCTION');
      const backups = getKnownBackupFiles_(DriveApp.getFolderById(config.backupFolderId), production.getId());
      if (!backups.length) throw new Error('NO_VALID_BACKUP');
      const backup = backups[0];
      const source = SpreadsheetApp.openById(backup.getId());
      if (String(recovery.getId()) === String(source.getId())) throw new Error('RECOVERY_TARGET_IS_BACKUP');
      const timeZoneAudit = restoreBackupIntoRecoveryTest_(source, recovery);
      const validation = validateRecoveryIntegrity_(source, recovery);
      const result = { success: validation.success, backupFound: true, restoredSheetCount: Object.keys(getSheetSchemas_()).length, timeZoneAudit: timeZoneAudit, validation: validation, errorCode: validation.success ? '' : 'RECOVERY_VALIDATION_FAILED' };
      recordBackupRecoveryAudit_(actor, validation.success ? 'RECOVERY_TEST_PASSED' : 'RECOVERY_TEST_FAILED', { success: result.success, restoredSheetCount: result.restoredSheetCount, errorCode: result.errorCode });
      console.log(JSON.stringify(result, null, 2));
      return result;
    } catch (error) {
      const result = { success: false, backupFound: false, restoredSheetCount: 0, validation: { success: false, checks: [], errors: [] }, errorCode: backupRecoveryErrorCode_(error) };
      recordBackupRecoveryAudit_(actor, 'RECOVERY_TEST_FAILED', { success: false, errorCode: result.errorCode });
      console.log(JSON.stringify(result, null, 2));
      return result;
    }
  });
}

function getBackupRecoveryConfiguration_() {
  const properties = PropertiesService.getScriptProperties();
  const backupFolderId = String(properties.getProperty(APP_CONFIG.BACKUP_FOLDER_ID_PROPERTY) || '').trim();
  const recoveryTestSpreadsheetId = String(properties.getProperty(APP_CONFIG.RECOVERY_TEST_SPREADSHEET_ID_PROPERTY) || '').trim();
  const retentionRaw = String(properties.getProperty(APP_CONFIG.BACKUP_RETENTION_COUNT_PROPERTY) || '').trim();
  const retentionCount = Number(retentionRaw);
  return {
    backupFolderId: backupFolderId,
    backupFolderConfigured: Boolean(backupFolderId),
    backupFolderFormatValid: isGoogleResourceIdFormat_(backupFolderId),
    retentionCount: retentionCount,
    retentionConfigured: Boolean(retentionRaw),
    retentionValid: Boolean(retentionRaw) && Number.isInteger(retentionCount) && retentionCount > 0,
    recoveryTestSpreadsheetId: recoveryTestSpreadsheetId,
    recoveryTestConfigured: Boolean(recoveryTestSpreadsheetId),
    recoveryTestFormatValid: isGoogleResourceIdFormat_(recoveryTestSpreadsheetId)
  };
}

function isGoogleResourceIdFormat_(value) {
  return /^[A-Za-z0-9_-]{20,}$/.test(String(value || ''));
}

function getKnownBackupFiles_(folder, productionSpreadsheetId) {
  const tag = APP_CONFIG.BACKUP_FILE_TAG_PREFIX + productionSpreadsheetId;
  const files = [];
  const iterator = folder.getFiles();
  while (iterator.hasNext()) {
    const file = iterator.next();
    if (String(file.getName() || '').indexOf(APP_CONFIG.BACKUP_FILE_PREFIX) === 0 && String(file.getDescription() || '') === tag) files.push(file);
  }
  return files.sort((left, right) => right.getDateCreated().getTime() - left.getDateCreated().getTime());
}

function enforceBackupRetention_(folder, productionSpreadsheetId, retentionCount) {
  const backups = getKnownBackupFiles_(folder, productionSpreadsheetId);
  backups.slice(retentionCount).forEach(file => file.setTrashed(true));
  return { retained: Math.min(backups.length, retentionCount), archived: Math.max(0, backups.length - retentionCount) };
}

function restoreBackupIntoRecoveryTest_(source, recovery) {
  const timeZoneAudit = alignRecoverySpreadsheetTimeZone_(source, recovery);
  const stagedCopies = Object.keys(getSheetSchemas_()).map((sheetName, index) => {
    const sourceSheet = source.getSheetByName(sheetName);
    if (!sourceSheet) throw new Error('RECOVERY_SCHEMA_MISSING');
    const stagedSheet = sourceSheet.copyTo(recovery);
    stagedSheet.setName('__GARMENT_RECOVERY_STAGE_' + index);
    return { sheetName: sheetName, stagedSheet: stagedSheet };
  });
  stagedCopies.forEach(item => {
    const existing = recovery.getSheetByName(item.sheetName);
    if (existing) recovery.deleteSheet(existing);
    item.stagedSheet.setName(item.sheetName);
  });
  SpreadsheetApp.flush();
  return timeZoneAudit;
}

function alignRecoverySpreadsheetTimeZone_(source, recovery) {
  const sourceTimeZone = source.getSpreadsheetTimeZone();
  const recoveryTimeZoneBefore = recovery.getSpreadsheetTimeZone();
  if (sourceTimeZone && sourceTimeZone !== recoveryTimeZoneBefore) recovery.setSpreadsheetTimeZone(sourceTimeZone);
  return {
    productionTimeZone: getSpreadsheet_().getSpreadsheetTimeZone(),
    backupTimeZone: sourceTimeZone,
    recoveryTimeZoneBefore: recoveryTimeZoneBefore,
    recoveryTimeZoneAfter: recovery.getSpreadsheetTimeZone(),
    aligned: recovery.getSpreadsheetTimeZone() === sourceTimeZone
  };
}

function validateRecoveryIntegrity_(source, recovery) {
  const checks = [];
  const errors = [];
  const check = (name, passed, message) => { checks.push({ name, passed: Boolean(passed), message }); if (!passed) errors.push(message); };
  const schemas = getSheetSchemas_();
  const sourceRecords = {};
  const recoveryRecords = {};
  const transactionalSheets = new Set(getRecoveryTransactionalSheets_());
  Object.keys(schemas).forEach(sheetName => {
    const sourceSheet = source.getSheetByName(sheetName);
    const recoverySheet = recovery.getSheetByName(sheetName);
    const sourceValues = sourceSheet ? sourceSheet.getDataRange().getValues() : [];
    const recoveryValues = recoverySheet ? recoverySheet.getDataRange().getValues() : [];
    const schemaMatches = sourceValues.length && recoveryValues.length && sourceValues[0].join('|') === schemas[sheetName].join('|') && recoveryValues[0].join('|') === schemas[sheetName].join('|');
    check('schema_' + sheetName, schemaMatches, 'Schema mismatch: ' + sheetName + '.');
    check('row_count_' + sheetName, sourceValues.length === recoveryValues.length, 'Row-count mismatch: ' + sheetName + '.');
    if (transactionalSheets.has(sheetName)) {
      const idComparison = compareRecoveryPrimaryIds_(sheetName, schemas[sheetName], sourceValues, recoveryValues);
      check('ids_' + sheetName, idComparison.matches, 'ID mismatch: ' + sheetName + '.');
      const fingerprintComparison = compareRecoveryRowFingerprints_(sheetName, schemas[sheetName], sourceValues, recoveryValues);
      const formulaComparison = compareRecoveryFormulas_(schemas[sheetName], sourceSheet, recoverySheet, sheetName);
      const combinedComparison = combineRecoveryComparisons_(fingerprintComparison, formulaComparison, sheetName);
      check('values_' + sheetName, combinedComparison.matches, 'Normalized record/formula-value mismatch: ' + sheetName + '.');
      if (!combinedComparison.matches) checks.push({ name: 'value_summary_' + sheetName, passed: false, message: 'Value mismatch summary: ' + JSON.stringify(combinedComparison.summary) });
      if (fingerprintComparison.diagnostics && fingerprintComparison.diagnostics.length) checks.push({ name: 'fingerprint_diagnostics_' + sheetName, passed: false, message: 'Fingerprint diagnostics: ' + JSON.stringify(fingerprintComparison.diagnostics) });
      if (formulaComparison.diagnostics && formulaComparison.diagnostics.length) checks.push({ name: 'formula_diagnostics_' + sheetName, passed: false, message: 'Formula diagnostics: ' + JSON.stringify(formulaComparison.diagnostics) });
    } else {
      checks.push({ name: 'derived_' + sheetName, passed: true, message: 'Derived sheet validated structurally; contents are rebuildable.' });
    }
    sourceRecords[sheetName] = sourceValues.slice(1).filter(row => row.some(value => value !== '')).map(row => toPlainObject_(schemas[sheetName], row));
    recoveryRecords[sheetName] = recoveryValues.slice(1).filter(row => row.some(value => value !== '')).map(row => toPlainObject_(schemas[sheetName], row));
  });
  const orderIds = new Set(recoveryRecords[APP_CONFIG.SHEETS.PRODUCTION_ORDERS].map(row => String(row['Order ID'])));
  const taskIds = new Set(recoveryRecords[APP_CONFIG.SHEETS.TASKS].map(row => String(row['Task ID'])));
  const departmentIds = new Set(recoveryRecords[APP_CONFIG.SHEETS.DEPARTMENTS].map(row => String(row['Department ID'])));
  check('task_order_relationships', recoveryRecords[APP_CONFIG.SHEETS.TASKS].every(row => orderIds.has(String(row['Order ID']))), 'Task-to-order relationship mismatch.');
  check('task_department_relationships', recoveryRecords[APP_CONFIG.SHEETS.TASKS].every(row => departmentIds.has(String(row['Department ID']))), 'Task-to-department relationship mismatch.');
  check('history_relationships', recoveryRecords[APP_CONFIG.SHEETS.TASK_HISTORY].every(row => taskIds.has(String(row['Task ID'])) && orderIds.has(String(row['Order ID']))), 'Task-history relationship mismatch.');
  check('task_quantity_integrity', recoveryRecords[APP_CONFIG.SHEETS.TASKS].every(isRecoveryTaskQuantityValid_), 'Task quantity integrity mismatch.');
  check('order_quantity_integrity', recoveryRecords[APP_CONFIG.SHEETS.PRODUCTION_ORDERS].every(isRecoveryOrderQuantityValid_), 'Order quantity integrity mismatch.');
  check('task_status_integrity', recoveryRecords[APP_CONFIG.SHEETS.TASKS].every(row => Object.keys(APP_CONFIG.STATUS).map(key => APP_CONFIG.STATUS[key]).includes(String(row.Status))), 'Task status integrity mismatch.');
  check('order_status_integrity', recoveryRecords[APP_CONFIG.SHEETS.PRODUCTION_ORDERS].every(row => Object.keys(APP_CONFIG.STATUS).map(key => APP_CONFIG.STATUS[key]).includes(String(row['Overall Status']))), 'Order status integrity mismatch.');
  const timestampDeltaSummary = getRecoveryTimestampDeltaSummary_(source, recovery, schemas);
  const mismatchSummary = checks.filter(checkItem => checkItem.name.indexOf('value_summary_') === 0).map(checkItem => JSON.parse(checkItem.message.replace('Value mismatch summary: ', '')));
  const fingerprintDiagnostics = checks.filter(checkItem => checkItem.name.indexOf('fingerprint_diagnostics_') === 0).map(checkItem => JSON.parse(checkItem.message.replace('Fingerprint diagnostics: ', '')));
  const formulaDiagnostics = checks.filter(checkItem => checkItem.name.indexOf('formula_diagnostics_') === 0).map(checkItem => JSON.parse(checkItem.message.replace('Formula diagnostics: ', '')));
  return { success: errors.length === 0, checks: checks, errors: errors, mismatchSummary: mismatchSummary, fingerprintDiagnostics: fingerprintDiagnostics, formulaDiagnostics: formulaDiagnostics, timestampDeltaSummary: timestampDeltaSummary };
}

function getRecoveryTimestampDeltaSummary_(source, recovery, schemas) {
  const result = { zeroDeltaCount: 0, underOneSecondCount: 0, exactlyOneSecondCount: 0, kolkataOffsetCount: 0, otherDeltaCount: 0, uniqueDeltaBuckets: [] };
  const buckets = {};
  Object.keys(schemas).forEach(sheetName => {
    const sourceSheet = source.getSheetByName(sheetName);
    const recoverySheet = recovery.getSheetByName(sheetName);
    if (!sourceSheet || !recoverySheet) return;
    const sourceValues = sourceSheet.getDataRange().getValues();
    const recoveryValues = recoverySheet.getDataRange().getValues();
    schemas[sheetName].forEach((header, columnIndex) => {
      if (!isRecoveryTemporalHeader_(header)) return;
      const rowCount = Math.min(sourceValues.length, recoveryValues.length);
      for (let rowIndex = 1; rowIndex < rowCount; rowIndex += 1) {
        const sourceEpoch = recoveryEpochMilliseconds_(sourceValues[rowIndex] && sourceValues[rowIndex][columnIndex], source.getSpreadsheetTimeZone());
        const recoveryEpoch = recoveryEpochMilliseconds_(recoveryValues[rowIndex] && recoveryValues[rowIndex][columnIndex], recovery.getSpreadsheetTimeZone());
        if (sourceEpoch === null || recoveryEpoch === null) continue;
        const delta = recoveryEpoch - sourceEpoch;
        const bucket = String(delta);
        buckets[bucket] = (buckets[bucket] || 0) + 1;
        if (delta === 0) result.zeroDeltaCount += 1;
        else if (Math.abs(delta) < 1000) result.underOneSecondCount += 1;
        else if (Math.abs(delta) === 1000) result.exactlyOneSecondCount += 1;
        else if (Math.abs(delta) === 19800000) result.kolkataOffsetCount += 1;
        else result.otherDeltaCount += 1;
      }
    });
  });
  result.uniqueDeltaBuckets = Object.keys(buckets).sort((left, right) => Number(left) - Number(right)).slice(0, 10).map(deltaMs => ({ deltaMs: Number(deltaMs), count: buckets[deltaMs] }));
  return result;
}

function getRecoveryTransactionalSheets_() {
  return [
    APP_CONFIG.SHEETS.USERS, APP_CONFIG.SHEETS.DEPARTMENTS, APP_CONFIG.SHEETS.PRODUCTS,
    APP_CONFIG.SHEETS.CUSTOMERS, APP_CONFIG.SHEETS.PRODUCTION_ORDERS, APP_CONFIG.SHEETS.TASKS,
    APP_CONFIG.SHEETS.TASK_HISTORY, APP_CONFIG.SHEETS.WORKFLOW_CONFIG, APP_CONFIG.SHEETS.NOTIFICATIONS,
    APP_CONFIG.SHEETS.ALERTS, APP_CONFIG.SHEETS.AUDIT_LOG, APP_CONFIG.SHEETS.SETTINGS
  ];
}

function compareRecoveryPrimaryIds_(sheetName, headers, sourceValues, recoveryValues) {
  const getIds = values => values.slice(1).filter(row => row.some(value => value !== '' && value !== null && value !== undefined)).map((row, index) => getRecoveryPrimaryKey_(sheetName, headers, row, index)).filter(Boolean);
  const sourceIds = getIds(sourceValues);
  const recoveryIds = getIds(recoveryValues);
  return { matches: sourceIds.length === recoveryIds.length && sourceIds.every((id, index) => id === recoveryIds[index]) };
}

function compareRecoveryRowFingerprints_(sheetName, headers, sourceValues, recoveryValues) {
  const source = getRecoveryRowFingerprintMap_(sheetName, headers, sourceValues);
  const recovery = getRecoveryRowFingerprintMap_(sheetName, headers, recoveryValues);
  const mismatchTypes = {};
  const columns = {};
  let mismatchCount = 0;
  const keys = Array.from(new Set(Object.keys(source.rows).concat(Object.keys(recovery.rows))));
  keys.forEach(key => {
    if (source.duplicates[key] || recovery.duplicates[key]) {
      mismatchCount += 1;
    } else if (source.rows[key] !== recovery.rows[key]) {
      mismatchCount += 1;
    }
  });
  const diagnostics = getRecoveryFingerprintDiagnostics_(sheetName, headers, source, recovery);
  diagnostics.forEach(diagnostic => {
    diagnostic.mismatches.forEach(mismatch => {
      mismatch.categories.forEach(category => { mismatchTypes[category] = (mismatchTypes[category] || 0) + 1; });
      mismatch.columnNames.forEach(column => { columns[column] = true; });
    });
  });
  return { matches: mismatchCount === 0, summary: { sheet: '', mismatchCount: mismatchCount, mismatchTypes: mismatchTypes, firstFewColumnNames: Object.keys(columns).slice(0, 5) }, diagnostics: diagnostics };
}

function getRecoveryRowFingerprintMap_(sheetName, headers, values) {
  const rows = {};
  const normalizedRows = {};
  const duplicates = {};
  values.slice(1).filter(row => row.some(value => value !== '' && value !== null && value !== undefined)).forEach((row, index) => {
    const key = getRecoveryPrimaryKey_(sheetName, headers, row, index);
    if (Object.prototype.hasOwnProperty.call(rows, key)) duplicates[key] = true;
    normalizedRows[key] = headers.map((header, columnIndex) => normalizeRecoveryCellValue_(row[columnIndex], header));
    rows[key] = JSON.stringify(normalizedRows[key]);
  });
  return { rows: rows, normalizedRows: normalizedRows, duplicates: duplicates };
}

function getRecoveryFingerprintDiagnostics_(sheetName, headers, source, recovery) {
  const keys = Array.from(new Set(Object.keys(source.normalizedRows).concat(Object.keys(recovery.normalizedRows))));
  const diagnostics = [];
  keys.forEach(key => {
    if (source.rows[key] === recovery.rows[key] && !source.duplicates[key] && !recovery.duplicates[key]) return;
    const sourceRow = source.normalizedRows[key];
    const recoveryRow = recovery.normalizedRows[key];
    const mismatches = [];
    if (source.duplicates[key] || recovery.duplicates[key]) {
      mismatches.push({ columnNames: [headers[0]], categories: ['DUPLICATE_PRIMARY_ID'], sourceNormalizedTypes: ['row'], restoredNormalizedTypes: ['row'] });
    } else if (!sourceRow || !recoveryRow) {
      mismatches.push({ columnNames: [headers[0]], categories: ['ROW_MISSING'], sourceNormalizedTypes: [sourceRow ? 'row' : 'missing'], restoredNormalizedTypes: [recoveryRow ? 'row' : 'missing'] });
    } else {
      headers.forEach((header, columnIndex) => {
        const sourceValue = sourceRow[columnIndex];
        const recoveryValue = recoveryRow[columnIndex];
        if (sourceValue.kind === recoveryValue.kind && sourceValue.value === recoveryValue.value) return;
        mismatches.push({
          columnNames: [header],
          categories: [getRecoveryMismatchCategory_(sourceValue, recoveryValue)],
          sourceNormalizedTypes: [sourceValue.kind],
          restoredNormalizedTypes: [recoveryValue.kind]
        });
      });
    }
    if (mismatches.length) diagnostics.push({ sheet: sheetName, rowKeyType: getRecoveryPrimaryKeyType_(sheetName, headers), mismatches: mismatches.slice(0, 10) });
  });
  return diagnostics.slice(0, 10);
}

function getRecoveryPrimaryKeyType_(sheetName, headers) {
  return sheetName === APP_CONFIG.SHEETS.WORKFLOW_CONFIG ? 'Workflow ID + Step Number' : headers[0];
}

function getRecoveryMismatchCategory_(source, recovery) {
  if (source.kind === 'temporal' || recovery.kind === 'temporal') return 'DATE_NORMALIZATION';
  if ((source.kind === 'number' && recovery.kind === 'text') || (source.kind === 'text' && recovery.kind === 'number')) return 'NUMBER_VS_STRING';
  if ((source.kind === 'boolean' && recovery.kind === 'text') || (source.kind === 'text' && recovery.kind === 'boolean')) return 'BOOLEAN_VS_STRING';
  if (source.kind === 'blank' || recovery.kind === 'blank') return 'BLANK_VS_NULL';
  if (source.kind === 'text' && recovery.kind === 'text' && String(source.value).trim() === String(recovery.value).trim()) return 'WHITESPACE';
  return 'TRUE_VALUE_MISMATCH';
}

function getRecoveryPrimaryKey_(sheetName, headers, row, index) {
  if (sheetName === APP_CONFIG.SHEETS.WORKFLOW_CONFIG) {
    const workflowIdIndex = headers.indexOf('Workflow ID');
    const stepNumberIndex = headers.indexOf('Step Number');
    return String(row[workflowIdIndex] || '') + '|' + String(row[stepNumberIndex] || '');
  }
  return String(row[0] || '__ROW_' + (index + 2));
}

function isRecoveryTaskQuantityValid_(task) {
  const planned = Number(task['Quantity Planned']);
  const completed = Number(task['Quantity Completed']);
  const remaining = Number(task['Quantity Remaining']);
  return Number.isFinite(planned) && Number.isFinite(completed) && Number.isFinite(remaining) && planned >= 0 && completed >= 0 && completed <= planned && remaining === planned - completed;
}

function isRecoveryOrderQuantityValid_(order) {
  const quantity = Number(order.Quantity);
  const completed = Number(order['Completed Quantity']);
  return Number.isFinite(quantity) && Number.isFinite(completed) && quantity >= 0 && completed >= 0 && completed <= quantity;
}

function copyRecoveryFormulas_(sourceSheet, targetSheet, rowCount, columnCount) {
  if (!rowCount || !columnCount || typeof sourceSheet.getDataRange().getFormulas !== 'function') return;
  const formulas = sourceSheet.getDataRange().getFormulas();
  formulas.forEach((row, rowIndex) => row.forEach((formula, columnIndex) => {
    if (formula) targetSheet.getRange(rowIndex + 1, columnIndex + 1).setFormula(formula);
  }));
}

function compareRecoverySheetValues_(headers, sourceValues, recoveryValues) {
  const mismatchTypes = {};
  const columns = {};
  let mismatchCount = 0;
  const rowCount = Math.max(sourceValues.length, recoveryValues.length);
  const columnCount = Math.max(headers.length, sourceValues[0] ? sourceValues[0].length : 0, recoveryValues[0] ? recoveryValues[0].length : 0);
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const header = headers[columnIndex] || ('Column ' + (columnIndex + 1));
      const difference = compareRecoveryCellValues_(sourceValues[rowIndex] ? sourceValues[rowIndex][columnIndex] : undefined, recoveryValues[rowIndex] ? recoveryValues[rowIndex][columnIndex] : undefined, header);
      if (!difference.matches) {
        mismatchCount += 1;
        mismatchTypes[difference.type] = (mismatchTypes[difference.type] || 0) + 1;
        columns[header] = true;
      }
    }
  }
  return { matches: mismatchCount === 0, summary: { sheet: '', mismatchCount: mismatchCount, mismatchTypes: mismatchTypes, firstFewColumnNames: Object.keys(columns).slice(0, 5) } };
}

function compareRecoveryFormulas_(headers, sourceSheet, recoverySheet, sheetName) {
  if (!sourceSheet || !recoverySheet || typeof sourceSheet.getDataRange().getFormulas !== 'function' || typeof recoverySheet.getDataRange().getFormulas !== 'function') return { matches: true, summary: { sheet: '', mismatchCount: 0, mismatchTypes: {}, firstFewColumnNames: [] }, diagnostics: [] };
  const sourceFormulas = sourceSheet.getDataRange().getFormulas();
  const recoveryFormulas = recoverySheet.getDataRange().getFormulas();
  const mismatchTypes = {};
  const columns = {};
  const diagnostics = [];
  let mismatchCount = 0;
  const rowCount = Math.max(sourceFormulas.length, recoveryFormulas.length);
  const columnCount = Math.max(headers.length, sourceFormulas[0] ? sourceFormulas[0].length : 0, recoveryFormulas[0] ? recoveryFormulas[0].length : 0);
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const sourceFormula = String(sourceFormulas[rowIndex] ? sourceFormulas[rowIndex][columnIndex] || '' : '');
      const recoveryFormula = String(recoveryFormulas[rowIndex] ? recoveryFormulas[rowIndex][columnIndex] || '' : '');
      if (sourceFormula !== recoveryFormula) {
        const type = sourceFormula && !recoveryFormula ? 'FORMULA_VS_CALCULATED_VALUE' : 'FORMULA_MISMATCH';
        mismatchCount += 1; mismatchTypes[type] = (mismatchTypes[type] || 0) + 1; columns[headers[columnIndex] || ('Column ' + (columnIndex + 1))] = true;
        if (diagnostics.length < 10) diagnostics.push({ sheet: sheetName || '', rowKeyType: headers[0], mismatches: [{ columnNames: [headers[columnIndex] || ('Column ' + (columnIndex + 1))], categories: [type], sourceNormalizedTypes: [sourceFormula ? 'formula' : 'calculated_value'], restoredNormalizedTypes: [recoveryFormula ? 'formula' : 'calculated_value'] }] });
      }
    }
  }
  return { matches: mismatchCount === 0, summary: { sheet: '', mismatchCount: mismatchCount, mismatchTypes: mismatchTypes, firstFewColumnNames: Object.keys(columns).slice(0, 5) }, diagnostics: diagnostics };
}

function combineRecoveryComparisons_(values, formulas, sheetName) {
  const mismatchTypes = {};
  const columns = [];
  [values.summary, formulas.summary].forEach(summary => {
    Object.keys(summary.mismatchTypes).forEach(type => { mismatchTypes[type] = (mismatchTypes[type] || 0) + summary.mismatchTypes[type]; });
    summary.firstFewColumnNames.forEach(column => { if (!columns.includes(column)) columns.push(column); });
  });
  return { matches: values.matches && formulas.matches, summary: { sheet: sheetName, mismatchCount: values.summary.mismatchCount + formulas.summary.mismatchCount, mismatchTypes: mismatchTypes, firstFewColumnNames: columns.slice(0, 5) } };
}

function compareRecoveryCellValues_(sourceValue, recoveryValue, header) {
  const source = normalizeRecoveryCellValue_(sourceValue, header);
  const recovery = normalizeRecoveryCellValue_(recoveryValue, header);
  if (source.kind === 'blank' && recovery.kind === 'blank') return { matches: true, type: '' };
  if (source.kind === 'temporal' && recovery.kind === 'temporal') return { matches: source.value === recovery.value, type: source.value === recovery.value ? '' : 'TIMEZONE_OR_SECOND_DIFFERENCE' };
  if (source.kind !== recovery.kind) {
    if ((source.kind === 'number' && recovery.kind === 'text') || (source.kind === 'text' && recovery.kind === 'number')) return { matches: false, type: 'NUMBER_VS_NUMERIC_STRING' };
    if ((source.kind === 'boolean' && recovery.kind === 'text') || (source.kind === 'text' && recovery.kind === 'boolean')) return { matches: false, type: 'BOOLEAN_VS_STRING' };
    if ((source.kind === 'temporal' && recovery.kind === 'text') || (source.kind === 'text' && recovery.kind === 'temporal')) return { matches: false, type: 'DATE_VS_FORMATTED_STRING' };
    return { matches: false, type: 'TYPE_MISMATCH' };
  }
  if (source.value === recovery.value) return { matches: true, type: '' };
  return { matches: false, type: source.kind === 'text' && String(source.value).trim() === String(recovery.value).trim() ? 'WHITESPACE_DIFFERENCE' : 'VALUE_MISMATCH' };
}

function normalizeRecoveryCellValue_(value, header) {
  if (value === null || value === undefined || value === '') return { kind: 'blank', value: '' };
  if (isRecoveryTemporalHeader_(header)) {
    const timestamp = recoveryTimestamp_(value);
    if (timestamp !== null) return { kind: 'temporal', value: timestamp };
  }
  if (Object.prototype.toString.call(value) === '[object Date]') return { kind: 'date', value: value.getTime() };
  if (typeof value === 'number') return { kind: 'number', value: value };
  if (typeof value === 'boolean') return { kind: 'boolean', value: value };
  return { kind: 'text', value: String(value) };
}

function isRecoveryTemporalHeader_(header) {
  return /(Date|Deadline|Timestamp|Read At|Acknowledged At|Resolved At)$/i.test(String(header || ''));
}

function recoveryTimestamp_(value) {
  return recoveryEpochMilliseconds_(value, Session.getScriptTimeZone() || 'Asia/Kolkata');
}

function recoveryEpochMilliseconds_(value, timeZone) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    const epoch = value.getTime();
    return Number.isNaN(epoch) ? null : Math.floor(epoch / 1000) * 1000;
  }
  const text = String(value === null || value === undefined ? '' : value).trim();
  if (!text) return null;
  try {
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
      const parsed = Utilities.parseDate(text, timeZone, APP_CONFIG.DATE_FORMAT);
      return Math.floor(parsed.getTime() / 1000) * 1000;
    }
    if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
      const parsed = new Date(text);
      return Number.isNaN(parsed.getTime()) ? null : Math.floor(parsed.getTime() / 1000) * 1000;
    }
  } catch (error) { return null; }
  return null;
}

function recordBackupRecoveryAudit_(actor, action, result) {
  try { writeWorkflowAuditUnderLock_(actor, action, 'SYSTEM', 'BACKUP_RECOVERY', null, result, 'Backup/recovery control outcome.'); } catch (error) { console.error('Backup/recovery audit recording failed.'); }
}

function backupRecoveryErrorCode_(error) {
  const message = String(error && error.message || error || '').toUpperCase();
  if (/TARGET_IS_PRODUCTION/.test(message)) return 'RECOVERY_TARGET_IS_PRODUCTION';
  if (/TARGET_IS_BACKUP/.test(message)) return 'RECOVERY_TARGET_IS_BACKUP';
  if (/NO_VALID_BACKUP/.test(message)) return 'NO_VALID_BACKUP';
  if (/RECOVERY_SCHEMA/.test(message)) return 'RECOVERY_SCHEMA_INVALID';
  if (/CONFIGURATION/.test(message)) return 'CONFIGURATION_INVALID';
  if (/VERIFICATION/.test(message)) return 'BACKUP_VERIFICATION_FAILED';
  return 'BACKUP_RECOVERY_FAILED';
}
