/*
 * Local dry-run harness for Phase 1. It emulates only the Apps Script APIs
 * exercised by setup and database code; it never calls Google services.
 * Run: node tests/phase1-dry-run.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Range {
  constructor(sheet, row, column, rows, columns) {
    this.sheet = sheet; this.row = row; this.column = column;
    this.rows = rows; this.columns = columns;
  }
  getValues() {
    return Array.from({ length: this.rows }, (_, rowOffset) => Array.from({ length: this.columns }, (_, columnOffset) =>
      (this.sheet.rows[this.row - 1 + rowOffset] || [])[this.column - 1 + columnOffset] ?? ''));
  }
  getFormulas() {
    return Array.from({ length: this.rows }, (_, rowOffset) => Array.from({ length: this.columns }, (_, columnOffset) =>
      ((this.sheet.formulas[this.row - 1 + rowOffset] || [])[this.column - 1 + columnOffset] || '')));
  }
  setValues(values) {
    values.forEach((sourceRow, rowOffset) => sourceRow.forEach((value, columnOffset) => {
      const row = this.row - 1 + rowOffset;
      const column = this.column - 1 + columnOffset;
      this.sheet.rows[row] ||= [];
      this.sheet.rows[row][column] = value;
    }));
    return this;
  }
  clearContent() {
    for (let rowOffset = 0; rowOffset < this.rows; rowOffset += 1) {
      for (let columnOffset = 0; columnOffset < this.columns; columnOffset += 1) {
        const row = this.row - 1 + rowOffset;
        const column = this.column - 1 + columnOffset;
        if (this.sheet.rows[row]) this.sheet.rows[row][column] = '';
      }
    }
    return this;
  }
  setFormula(formula) {
    const row = this.row - 1; const column = this.column - 1;
    this.sheet.formulas[row] ||= [];
    this.sheet.formulas[row][column] = String(formula);
    return this;
  }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
}

class Sheet {
  constructor(name, spreadsheet = null) { this.name = name; this.spreadsheet = spreadsheet; this.rows = [[]]; this.formulas = []; this.frozenRows = 0; }
  getLastColumn() { return this.rows.reduce((largest, row) => Math.max(largest, row.length), 0); }
  getLastRow() { return this.rows.length; }
  getRange(row, column, rows = 1, columns = 1) { return new Range(this, row, column, rows, columns); }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  appendRow(row) { this.rows.push([...row]); }
  deleteRow(row) { this.rows.splice(row - 1, 1); }
  clearContents() { this.rows = [[]]; this.formulas = []; return this; }
  setFrozenRows(rows) { this.frozenRows = rows; }
  setName(name) {
    if (this.spreadsheet) {
      this.spreadsheet.sheets.delete(this.name);
      this.spreadsheet.sheets.set(name, this);
    }
    this.name = name;
    return this;
  }
  copyTo(targetSpreadsheet) {
    const copy = targetSpreadsheet.insertSheet('Copy of ' + this.name);
    copy.rows = this.rows.map(row => row.map(value => Object.prototype.toString.call(value) === '[object Date]' ? new Date(value.getTime()) : value));
    copy.formulas = this.formulas.map(row => [...row]);
    return copy;
  }
  autoResizeColumns() {}
}

class Spreadsheet {
  constructor(id = 'sheet-' + (++spreadsheetSequence)) { this.id = id; this.sheets = new Map(); this.timeZone = 'Asia/Kolkata'; }
  getId() { return this.id; }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) { const sheet = new Sheet(name, this); this.sheets.set(name, sheet); return sheet; }
  deleteSheet(sheet) { this.sheets.delete(sheet.name); }
  getSpreadsheetTimeZone() { return this.timeZone; }
  setSpreadsheetTimeZone(timeZone) { this.timeZone = timeZone; return this; }
  clone(id) {
    const copy = new Spreadsheet(id);
    copy.timeZone = this.timeZone;
    this.sheets.forEach((sheet, name) => {
      const cloned = new Sheet(name, copy);
      cloned.rows = sheet.rows.map(row => row.map(value => Object.prototype.toString.call(value) === '[object Date]' ? new Date(value.getTime()) : value));
      cloned.formulas = sheet.formulas.map(row => [...row]);
      copy.sheets.set(name, cloned);
    });
    return copy;
  }
}

let spreadsheetSequence = 0;
const spreadsheet = new Spreadsheet('dry-run-production-sheet-123456789');
const spreadsheets = new Map([[spreadsheet.getId(), spreadsheet]]);
let activeSpreadsheet = spreadsheet;
let driveCopySequence = 0;
let driveCreatedSequence = 0;
class DriveFolder {
  constructor(id) { this.id = id; this.files = []; }
  getFiles() {
    const files = this.files.filter(file => !file.trashed); let index = 0;
    return { hasNext: () => index < files.length, next: () => files[index++] };
  }
}
class DriveFile {
  constructor(id, name, boundSpreadsheet = null) { this.id = id; this.name = name; this.boundSpreadsheet = boundSpreadsheet; this.description = ''; this.trashed = false; this.created = new Date(Date.now() + (++driveCreatedSequence)); }
  getId() { return this.id; }
  getName() { return this.name; }
  getDescription() { return this.description; }
  setDescription(value) { this.description = String(value); return this; }
  getDateCreated() { return this.created; }
  setTrashed(value) { this.trashed = Boolean(value); return this; }
  makeCopy(name, folder) {
    const copySpreadsheet = this.boundSpreadsheet.clone('backup-sheet-' + (++driveCopySequence));
    spreadsheets.set(copySpreadsheet.getId(), copySpreadsheet);
    const copy = new DriveFile(copySpreadsheet.getId(), name, copySpreadsheet);
    driveFiles.set(copy.getId(), copy); folder.files.push(copy); return copy;
  }
}
const driveFolders = new Map();
const driveFiles = new Map([[spreadsheet.getId(), new DriveFile(spreadsheet.getId(), 'Production', spreadsheet)]]);
const properties = new Map();
const userProperties = new Map();
const triggers = [];
const sentEmails = [];
let currentEmail = 'admin@example.com';
let googleTokenClaims = null;
const context = vm.createContext({
  console,
  SpreadsheetApp: { getActiveSpreadsheet: () => activeSpreadsheet, openById: id => { const target = spreadsheets.get(String(id)); if (!target) throw new Error('Spreadsheet not found'); return target; }, flush: () => {} },
  DriveApp: { getFileById: id => { const file = driveFiles.get(String(id)); if (!file) throw new Error('Drive file not found'); return file; }, getFolderById: id => { const folder = driveFolders.get(String(id)); if (!folder) throw new Error('Drive folder not found'); return folder; } },
  HtmlService: { createHtmlOutputFromFile: () => ({ getContent: () => '' }), createHtmlOutput: content => ({ getContent: () => content }) },
  PropertiesService: {
    getScriptProperties: () => ({ getProperty: key => properties.get(key) || null, setProperty: (key, value) => properties.set(key, value), setProperties: values => Object.keys(values).forEach(key => properties.set(key, values[key])), deleteProperty: key => properties.delete(key) }),
    getUserProperties: () => ({ getProperty: key => userProperties.get(key) || null, setProperty: (key, value) => userProperties.set(key, value), setProperties: values => Object.keys(values).forEach(key => userProperties.set(key, values[key])), deleteProperty: key => userProperties.delete(key) })
  },
  ScriptApp: {
    AuthMode: { FULL: 'FULL' },
    getAuthorizationInfo: () => ({
      getAuthorizationStatus: () => 'NOT_REQUIRED',
      getAuthorizationUrl: () => null
    }),
    getProjectTriggers: () => triggers,
    deleteTrigger: trigger => { const index = triggers.indexOf(trigger); if (index >= 0) triggers.splice(index, 1); },
    newTrigger: handler => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => { const trigger = { getHandlerFunction: () => handler, getEventType: () => 'CLOCK' }; triggers.push(trigger); return trigger; } }) }) })
  },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  Session: { getActiveUser: () => ({ getEmail: () => currentEmail }), getTemporaryActiveUserKey: () => 'dry-run-external-user-key', getScriptTimeZone: () => 'Asia/Kolkata' },
  UrlFetchApp: { fetch: () => ({ getResponseCode: () => googleTokenClaims ? 200 : 400, getContentText: () => JSON.stringify(googleTokenClaims || {}) }) },
  MailApp: { sendEmail: message => sentEmails.push(message) },
  Utilities: { formatDate: (date, _timeZone, format) => { if (format === 'yyyy-MM-dd') return '2026-08-30'; const local = new Date(date.getTime() + 330 * 60 * 1000); const pad = value => String(value).padStart(2, '0'); return local.getUTCFullYear() + '-' + pad(local.getUTCMonth() + 1) + '-' + pad(local.getUTCDate()) + ' ' + pad(local.getUTCHours()) + ':' + pad(local.getUTCMinutes()) + ':' + pad(local.getUTCSeconds()); }, parseDate: value => { const parts = String(value).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/); return parts ? new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), Number(parts[4]) - 5, Number(parts[5]) - 30, Number(parts[6]))) : new Date(value); }, getUuid: () => '12345678-1234-1234-1234-123456789012', DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' }, computeDigest: (_algorithm, value) => { const source = String(value); let sum = 0; for (let index = 0; index < source.length; index += 1) sum = (sum * 33 + source.charCodeAt(index)) >>> 0; return Array.from({ length: 32 }, (_, index) => (sum >>> ((index % 4) * 8)) & 255); } },
  Date,
  Error,
  Object,
  String,
  Number,
  Array
});

['Config.gs', 'Utils.gs', 'Database.gs', 'Setup.gs', 'OtpAuth.gs', 'Auth.gs', 'ExternalIdentity.gs', 'Users.gs', 'AdminManagement.gs', 'Dashboard.gs', 'DepartmentDashboardServer.gs', 'Workflow.gs', 'Tasks.gs', 'Orders.gs', 'Alerts.gs', 'Notifications.gs', 'Reporting.gs', 'Code.gs', 'Integration.gs', 'Tests.gs'].forEach(file =>
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file }));

const initialized = context.initializeSystem();
assert.equal(initialized.success, true);
assert.equal(initialized.sheets.length, Object.keys(context.getSheetSchemas_()).length);
assert.equal([...initialized.sheets].sort().join('|'), Object.keys(context.getSheetSchemas_()).sort().join('|'));
const smokeTest = context.testPhase1Installation();
assert.equal(smokeTest.success, true);
assert.equal(smokeTest.departments, 6);
assert.equal(smokeTest.workflowSteps, 6);
assert.equal(context.verifySystemSetup().success, true);
context.insertRecord('Customers', { 'Customer ID': 'CUST-FORMULA-TEST', 'Customer Name': '=HYPERLINK("https://example.invalid")' });
assert.equal(spreadsheet.getSheetByName('Customers').rows.at(-1)[1], "'=HYPERLINK(\"https://example.invalid\")", 'formula-like user text is stored as literal text');

// Phase 2: secure bootstrap, role enforcement, and department isolation.
assert.equal(context.verifyAdminBootstrapReadiness().ready, false, 'bootstrap requires an explicitly configured initial administrator');
let initialAdminConfig = context.checkInitialAdminConfig();
assert.equal(initialAdminConfig.configured, false, 'missing initial-admin property is reported without creating a user');
assert.equal(initialAdminConfig.bootstrapAllowed, false, 'missing initial-admin property blocks bootstrap');
assert.equal(JSON.stringify(initialAdminConfig).includes(currentEmail), false, 'initial-admin diagnostic never exposes the configured email');
properties.set('GARMENT_INITIAL_ADMIN_EMAIL', '   ');
initialAdminConfig = context.checkInitialAdminConfig();
assert.equal(initialAdminConfig.configured, false, 'blank initial-admin property is rejected');
assert.equal(initialAdminConfig.validFormat, false, 'blank initial-admin property has no valid email format');
properties.set('GARMENT_INITIAL_ADMIN_EMAIL', 'not-an-email');
initialAdminConfig = context.checkInitialAdminConfig();
assert.equal(initialAdminConfig.configured, true, 'a nonblank malformed property is detected');
assert.equal(initialAdminConfig.validFormat, false, 'malformed initial-admin property is rejected');
assert.equal(initialAdminConfig.bootstrapAllowed, false, 'malformed initial-admin property blocks bootstrap');
properties.set('GARMENT_INITIAL_ADMIN_EMAIL', currentEmail);
assert.equal(context.verifyAdminBootstrapReadiness().ready, true, 'configured active identity can perform the one-time bootstrap');
initialAdminConfig = context.checkInitialAdminConfig();
assert.equal(initialAdminConfig.bootstrapAllowed, true, 'valid configured property permits the one-time bootstrap');
assert.equal(JSON.stringify(initialAdminConfig).includes(currentEmail), false, 'valid initial-admin property remains redacted from diagnostic output');
const administrator = context.bootstrapInitialAdmin();
assert.equal(administrator.role, 'ADMIN');
assert.throws(() => context.bootstrapInitialAdmin(), /Initial administrator already exists/);
const triggerContext = context.diagnoseTriggerReadinessContext();
const authorizationStatus = context.checkScriptAuthorizationStatus();
const webAppReadiness = context.verifyWebAppDeploymentReadiness();
const liveAcceptanceReadiness = context.verifyLiveWebAppAcceptanceReadiness();
assert.equal(webAppReadiness.readyToDeploy, false, 'web deployment readiness correctly waits for required triggers');
assert.equal(liveAcceptanceReadiness.readyForUserOnboarding, false, 'live acceptance readiness correctly waits for required triggers');
assert.equal(authorizationStatus.success, true, 'authorization probe succeeds without writing production data');
assert.equal(authorizationStatus.full.authorizationRequired, false, 'full authorization state is reported');
assert.equal(authorizationStatus.scriptApp.authorizationRequired, false, 'ScriptApp authorization state is reported');
assert.equal(triggerContext.productionSpreadsheetMatch, true, 'trigger diagnostic confirms the bound spreadsheet target');
assert.equal(triggerContext.totalUserCount, 1, 'trigger diagnostic reads the bootstrapped user row');
assert.equal(triggerContext.activeAdminCount, 1, 'trigger diagnostic uses the canonical active-admin predicate');
assert.equal(triggerContext.executingIdentityIsAdmin, true, 'trigger diagnostic verifies active administrator identity');
assert.equal(triggerContext.triggerListReadable, true, 'trigger diagnostic reads the trigger list without modification');
let triggerReadiness = context.verifyTriggerReadiness();
assert.equal(triggerReadiness.readyToInstall, true, 'post-bootstrap production is ready to install required triggers');
assert.equal(triggerReadiness.triggersInstalledCorrectly, false, 'readiness reports missing required triggers without creating them');
assert.match(triggerReadiness.triggerVisibility, /currently authorized Apps Script account/, 'trigger visibility limitation is disclosed');
assert.equal(triggerReadiness.pendingEmailNotifications, 0, 'empty notification queue cannot send email on a scheduled run');
context.insertRecord('Notifications', { 'Notification ID': 'NOTIF-RISK-00001', Channel: 'EMAIL', Status: 'PENDING' });
triggerReadiness = context.verifyTriggerReadiness();
assert.equal(triggerReadiness.pendingEmailNotifications, 1, 'readiness counts pending email notifications');
assert.equal(triggerReadiness.emailCouldBeSentOnNextScheduledRun, true, 'readiness flags pending-email delivery risk');
context.updateRecord('Notifications', 'NOTIF-RISK-00001', { Status: 'SKIPPED' });
const firstInstall = context.installProductionTriggers();
const repeatedInstall = context.installProductionTriggers();
assert.equal(firstInstall.created.length, 2, 'canonical installer creates both missing handlers');
assert.equal(firstInstall.existing.length, 0, 'first installation has no pre-existing required handlers');
assert.equal(repeatedInstall.created.length, 0, 'canonical installer is idempotent after successful installation');
assert.equal(repeatedInstall.existing.length, 2, 'repeated installation reports both existing required handlers');
assert.equal(triggers.length, 2, 'repeated trigger setup does not create duplicates');
triggerReadiness = context.verifyTriggerReadiness();
assert.equal(triggerReadiness.triggersInstalledCorrectly, true, 'readiness recognizes exactly one trigger per required handler');
assert.equal(context.verifyWebAppDeploymentReadiness().readyToDeploy, true, 'web deployment readiness confirms system, authorization, templates, contracts, and triggers');
assert.equal(context.verifyLiveWebAppAcceptanceReadiness().readyForUserOnboarding, true, 'live acceptance readiness confirms safe user onboarding prerequisites');
const departmentAcceptance = context.verifyDepartmentUserAcceptanceReadiness();
assert.equal(departmentAcceptance.success, true, 'department-user acceptance preflight remains read-only and healthy before user onboarding');
assert.equal(departmentAcceptance.purchaseDepartmentUserReady, false, 'preflight correctly reports that a Purchase user has not yet been created');
assert.equal(departmentAcceptance.activeProductCount, 0, 'preflight reports absent optional master records without creating them');
const unrelatedTrigger = { getHandlerFunction: () => 'unrelatedScheduledJob', getEventType: () => 'CLOCK' };
triggers.push(unrelatedTrigger);
const removal = context.removeProductionTriggers();
assert.equal(removal.removedHandlers.length, 2, 'remover deletes only required production handlers');
assert.deepEqual(triggers, [unrelatedTrigger], 'remover preserves unrelated triggers');
context.updateRecord('Settings', 'EMAIL_NOTIFICATIONS_ENABLED', { 'Setting Value': 'INVALID' });
assert.throws(() => context.installProductionTriggers(), /Production trigger preflight failed/, 'installer rejects an invalid production readiness state before creating triggers');
assert.equal(triggers.length, 1, 'failed trigger preflight leaves unrelated triggers unchanged and creates no required trigger');
context.updateRecord('Settings', 'EMAIL_NOTIFICATIONS_ENABLED', { 'Setting Value': 'TRUE' });
initialAdminConfig = context.checkInitialAdminConfig();
assert.equal(initialAdminConfig.existingAdminCount, 1, 'existing active administrator is detected');
assert.equal(initialAdminConfig.conflict, true, 'existing user record blocks bootstrap');
assert.equal(initialAdminConfig.conflictingUserRecord, true, 'matching existing user record is identified without exposing email');
assert.equal(initialAdminConfig.bootstrapAllowed, false, 'existing administrator blocks repeat bootstrap');
const cuttingUser = context.createUser({
  email: 'cutting@example.com', displayName: 'Cutting Lead', role: 'DEPARTMENT_USER', departmentId: 'DEPT-002'
});
assert.equal(cuttingUser.departmentName, 'Cutting');
currentEmail = 'cutting@example.com';
assert.equal(context.getMyProfile().departmentId, 'DEPT-002');
const departmentIdentity = context.diagnoseCurrentWebAppIdentity();
assert.deepEqual(JSON.parse(JSON.stringify(departmentIdentity)), {
  identityAvailable: true, authorizationRequired: false, userRecordFound: true, active: true,
  role: 'DEPARTMENT_USER', departmentAssigned: true, authorizationResult: 'AUTHORIZED'
}, 'sanitized web-app identity diagnostic authorizes an active assigned department user');
const otpRequest = context.requestEmailOtp('CUTTING@example.com');
assert.equal(otpRequest.success, true, 'OTP request returns a generic success response for an active registered user');
assert.equal(sentEmails.length, 1, 'OTP is sent only to the registered active user');
const otpProperty = context.getOtpRecordProperty_('cutting@example.com');
assert.doesNotMatch(properties.get(otpProperty), /\b\d{6}\b/, 'OTP record stores no plaintext code');
assert.throws(() => context.verifyEmailOtp('cutting@example.com', '000000'), /invalid or expired/, 'invalid OTP is rejected');
const otpResult = context.verifyEmailOtp('cutting@example.com', context.generateOtpCode_());
assert.equal(otpResult.profile.departmentId, 'DEPT-002', 'verified OTP resolves the stored department assignment');
assert.equal(context.getOtpWebAppProfile(otpResult.sessionToken).departmentId, 'DEPT-002', 'OTP session gates the Web App profile');
assert.throws(() => context.getOtpWebAppProfile('not-a-token'), /Session expired/, 'invalid session tokens are rejected');
context.logoutOtpSession(otpResult.sessionToken);
assert.throws(() => context.getOtpWebAppProfile(otpResult.sessionToken), /Session expired/, 'logout invalidates the server-side session');
currentEmail = 'cutting@example.com';
assert.doesNotThrow(() => context.requireDepartmentAccess_('DEPT-002'));
assert.throws(() => context.requireDepartmentAccess_('DEPT-003'), /own department/);
assert.throws(() => context.createUser({ email: 'blocked@example.com', displayName: 'Blocked', role: 'ADMIN' }), /Administrator role required/);
assert.throws(() => context.installProductionTriggers(), /Administrator role required/, 'non-admin users cannot install production triggers');
currentEmail = 'admin@example.com';
assert.throws(() => context.deactivateUser(administrator.userId), /At least one active administrator/);
assert.equal(context.listUsers().length, 2);
context.updateRecord('Users', administrator.userId, { 'Updated Date': new Date('2026-08-30T10:00:00Z') });
assert.equal(typeof context.listUsers().find(user => user.userId === administrator.userId).updatedDate, 'string', 'user responses normalize spreadsheet Date values for Html Service');
context.updateRecord('Departments', 'DEPT-001', { 'Updated Date': new Date('2026-08-30T10:00:00Z') });
assert.equal(typeof context.listDepartments().find(department => department['Department ID'] === 'DEPT-001')['Updated Date'], 'string', 'department responses normalize spreadsheet Date values for Html Service');
assert.throws(() => context.createUser({
  email: 'CUTTING@example.com', displayName: 'Duplicate', role: 'DEPARTMENT_USER', departmentId: 'DEPT-002'
}), /already exists/);
assert.throws(() => context.createUser({
  email: 'no-dept@example.com', displayName: 'No Department', role: 'DEPARTMENT_USER'
}), /must be assigned/);
const secondAdmin = context.createUser({ email: 'owner2@example.com', displayName: 'Second Admin', role: 'ADMIN' });
assert.equal(secondAdmin.role, 'ADMIN');
assert.equal(context.deactivateUser(administrator.userId).active, false);
assert.throws(() => context.getMyProfile(), /not an active system user/);
currentEmail = 'owner2@example.com';
assert.doesNotThrow(() => context.deactivateUser(administrator.userId));
assert.throws(() => context.updateUser(secondAdmin.userId, { role: 'DEPARTMENT_USER', departmentId: 'DEPT-002' }), /At least one active administrator/);
assert.equal(context.getMyProfile().role, 'ADMIN');
const emptyDashboard = context.getAdminDashboard();
assert.equal(emptyDashboard.kpis.totalOrders, 0);
assert.equal(emptyDashboard.departments.length, 6);
currentEmail = 'cutting@example.com';
assert.throws(() => context.getAdminDashboard(), /Administrator role required/);
currentEmail = 'owner2@example.com';
context.insertRecord('ProductionOrders', { 'Order ID': 'ORD-2026-00001', 'Customer Name': 'Northwind', 'Product Name': "Men's Shirt", Quantity: 10, 'Completed Quantity': 10, 'Overall Status': 'IN_PROGRESS', 'Created Date': '2026-08-30 10:00:00' });
context.insertRecord('ProductionOrders', { 'Order ID': 'ORD-2026-00002', 'Customer Name': 'Northwind', 'Product Name': "Men's Shirt", Quantity: 10, 'Completed Quantity': 10, 'Overall Status': 'COMPLETED', 'Created Date': '2026-08-30 10:01:00', 'Updated Date': '2026-08-30 10:02:00' });
context.insertRecord('Tasks', { 'Task ID': 'TASK-2026-00001', 'Order ID': 'ORD-2026-00001', 'Workflow Step': 1, 'Department ID': 'DEPT-001', Status: 'COMPLETED', 'Quantity Completed': 10, 'Completed Date': '2026-08-30 10:00:00' });
context.insertRecord('Tasks', { 'Task ID': 'TASK-2026-00002', 'Order ID': 'ORD-2026-00001', 'Department ID': 'DEPT-002', Status: 'OVERDUE' });
context.insertRecord('Tasks', { 'Task ID': 'TASK-2026-00003', 'Order ID': 'ORD-2026-00002', 'Workflow Step': 6, 'Department ID': 'DEPT-006', Status: 'COMPLETED', 'Quantity Completed': 10, 'Completed Date': '2026-08-30 10:02:00' });
context.insertRecord('Alerts', { 'Alert ID': 'ALERT-2026-00001', 'Alert Level': 'RED', 'Alert Type': 'TASK_OVERDUE', 'Order ID': 'ORD-2026-00001', Message: 'Cutting is overdue', Status: 'OPEN', 'Raised Date': '2026-08-30 10:00:00' });
const populatedDashboard = context.getAdminDashboard();
assert.equal(populatedDashboard.kpis.totalOrders, 2);
assert.equal(populatedDashboard.kpis.activeOrders, 1);
assert.equal(populatedDashboard.kpis.completedOrders, 1);
assert.equal(populatedDashboard.kpis.overdueTasks, 1);
assert.equal(populatedDashboard.kpis.totalProductionQuantity, 20);
assert.equal(populatedDashboard.kpis.completedQuantity, 10, 'intermediate task output on an active order does not count as completed production');
assert.equal(populatedDashboard.kpis.activeWipQuantity, 10);
assert.equal(populatedDashboard.kpis.completedToday, 1, 'only the final completed order is counted for today');
assert.equal(populatedDashboard.alerts.length, 1);
assert.equal(populatedDashboard.recentOrders.find(order => order.orderId === 'ORD-2026-00001').taskProgress, 50);

// Reporting regression: one completed six-stage order plus one active order must
// remain distinct at both the order and department grains.
const resetSheetForReporting = name => { spreadsheet.getSheetByName(name).rows = [Array.from(context.getSheetSchemas_()[name])]; };
['ProductionOrders', 'Tasks', 'Products', 'Customers', 'ReportProduction', 'ReportTasks', 'ReportDepartmentPerformance', 'ReportOrderCycleTime', 'ReportDelivery', 'ReportDailyProduction'].forEach(resetSheetForReporting);
context.insertRecord('Products', { 'Product ID': 'PROD-001', 'Product Name': 'Certified Shirt', Active: true });
context.insertRecord('Customers', { 'Customer ID': 'CUST-001', 'Customer Name': 'Certified Customer', Active: true });
context.insertRecord('ProductionOrders', {
  'Order ID': 'ORD-2026-00001', 'Product ID': 'PROD-001', 'Customer ID': 'CUST-001', Quantity: 10,
  'Completed Quantity': 10, 'Overall Status': 'IN_PROGRESS', Priority: 'NORMAL', 'Order Date': '2026-08-30 09:00:00',
  'Required Delivery Date': '2026-09-01 09:00:00'
});
context.insertRecord('ProductionOrders', {
  'Order ID': 'ORD-2026-00002', 'Product ID': 'PROD-001', 'Customer ID': 'CUST-001', Quantity: 10,
  'Completed Quantity': 10, 'Overall Status': 'COMPLETED', Priority: 'NORMAL', 'Order Date': '2026-08-30 09:00:00',
  'Required Delivery Date': '2026-09-01 09:00:00'
});
const reportingDepartmentIds = ['DEPT-001', 'DEPT-002', 'DEPT-003', 'DEPT-004', 'DEPT-005', 'DEPT-006'];
reportingDepartmentIds.forEach((departmentId, index) => {
  context.insertRecord('Tasks', {
    'Task ID': 'TASK-C-' + (index + 1), 'Order ID': 'ORD-2026-00002', 'Workflow Step': index + 1,
    'Department ID': departmentId, 'Quantity Planned': 10, 'Quantity Completed': 10, 'Quantity Remaining': 0,
    Status: 'COMPLETED', 'Start Date': '2026-08-30 09:00:00', 'Completed Date': '2026-08-30 10:00:00',
    'Task Duration Hours': 1, 'Delay Duration Hours': 0
  });
  context.insertRecord('Tasks', {
    'Task ID': 'TASK-A-' + (index + 1), 'Order ID': 'ORD-2026-00001', 'Workflow Step': index + 1,
    'Department ID': departmentId, 'Quantity Planned': 10, 'Quantity Completed': index === 0 ? 10 : 0,
    'Quantity Remaining': index === 0 ? 0 : 10, Status: index === 0 ? 'COMPLETED' : 'PENDING',
    'Start Date': index === 0 ? '2026-08-30 09:00:00' : '', 'Completed Date': index === 0 ? '2026-08-30 10:00:00' : '',
    'Assigned Date': '2026-08-30 09:00:00', 'Task Duration Hours': index === 0 ? 1 : 0, 'Delay Duration Hours': 0
  });
});
const reportingSourcesBeforeRebuild = JSON.stringify({ orders: context.getSheetData('ProductionOrders'), tasks: context.getSheetData('Tasks') });
const reporting = context.getOperationalReports({});
assert.equal(reporting.production.length, 2, 'production reporting has one row per order');
const completedProduction = reporting.production.find(row => row.orderId === 'ORD-2026-00002');
assert.deepEqual(JSON.parse(JSON.stringify({ status: completedProduction.status, quantity: completedProduction.orderQuantity, completed: completedProduction.completedQuantity, remaining: completedProduction.remainingQuantity })), { status: 'COMPLETED', quantity: 10, completed: 10, remaining: 0 });
assert.equal(completedProduction.productName, 'Certified Shirt', 'ReportProduction joins the active Product name without changing its Product ID');
assert.equal(completedProduction.customerName, 'Certified Customer', 'ReportProduction joins the active Customer name without changing its Customer ID');
assert.equal(context.getActiveReportingMasterNames_([{ 'Product ID': 'PROD-INACTIVE', 'Product Name': 'Inactive', Active: false }], 'Product ID', 'Product Name')['PROD-INACTIVE'] || '', '', 'missing or inactive master records safely produce a blank reporting display name');
assert.equal(reporting.tasks.filter(row => row.orderId === 'ORD-2026-00002').length, 6, 'completed order has exactly six report-task rows');
assert.equal(new Set(reporting.tasks.filter(row => row.orderId === 'ORD-2026-00002').map(row => row.taskId)).size, 6, 'report-task rows have stable unique task keys');
assert.ok(reporting.tasks.filter(row => row.orderId === 'ORD-2026-00002').every(row => row.status === 'COMPLETED'));
const purchasePerformance = reporting.departmentPerformance.find(row => row.departmentId === 'DEPT-001');
const cuttingPerformance = reporting.departmentPerformance.find(row => row.departmentId === 'DEPT-002');
assert.deepEqual(JSON.parse(JSON.stringify({ completed: purchasePerformance.completedTasks, planned: purchasePerformance.plannedQuantity, quantity: purchasePerformance.completedQuantity })), { completed: 2, planned: 20, quantity: 20 });
assert.deepEqual(JSON.parse(JSON.stringify({ completed: cuttingPerformance.completedTasks, pending: cuttingPerformance.pendingTasks, planned: cuttingPerformance.plannedQuantity, quantity: cuttingPerformance.completedQuantity })), { completed: 1, pending: 1, planned: 20, quantity: 10 });
assert.equal(reporting.orderCycleTime.filter(row => row.orderId === 'ORD-2026-00002').length, 6, 'completed order has six cycle-time stages');
assert.ok(reporting.orderCycleTime.every(row => Number.isFinite(row.stageDurationHours) && row.stageDurationHours >= 0 && Number.isFinite(row.totalCycleHours) && row.totalCycleHours >= 0), 'cycle durations are numeric and non-negative');
const deliveryMetrics = Object.fromEntries(reporting.deliveryRows.map(row => [row.metric, row.metricValue]));
assert.equal(deliveryMetrics['Total Orders'], 2);
assert.equal(deliveryMetrics['Active Orders'], 1);
assert.equal(deliveryMetrics['Completed Orders'], 1);
assert.equal(deliveryMetrics['Completed Production Quantity'], 10, 'delivery reporting uses final completed orders only');
assert.equal(reporting.dailyProduction.filter(row => row.date === '2026-08-30' && row.departmentId === 'DEPT-001').length, 1, 'daily data is aggregated once per date and department');
assert.equal(reporting.dailyProduction.find(row => row.date === '2026-08-30' && row.departmentId === 'DEPT-001').quantityCompleted, 20);
const rebuilt = context.rebuildReportingData();
assert.equal(rebuilt.success, true);
assert.equal(JSON.stringify({ orders: context.getSheetData('ProductionOrders'), tasks: context.getSheetData('Tasks') }), reportingSourcesBeforeRebuild, 'report rebuild does not modify transactional order/task data');
assert.equal(context.getSheetData('ReportProduction').length, 2);
assert.equal(context.getSheetData('ReportProduction').find(row => row['Order ID'] === 'ORD-2026-00002')['Product Name'], 'Certified Shirt', 'derived ReportProduction persists the joined Product Name');
assert.equal(context.getSheetData('ReportProduction').find(row => row['Order ID'] === 'ORD-2026-00002')['Customer Name'], 'Certified Customer', 'derived ReportProduction persists the joined Customer Name');
assert.equal(context.getSheetData('ReportTasks').filter(row => row['Order ID'] === 'ORD-2026-00002').length, 6);
assert.equal(context.getSheetData('ReportOrderCycleTime').filter(row => row['Order ID'] === 'ORD-2026-00002').length, 6);
const rebuiltDailyRows = context.getSheetData('ReportDailyProduction').filter(row => row.Date === '2026-08-30');
assert.equal(rebuiltDailyRows.length, 6, 'daily reporting emits one row for each date/department pair');
assert.ok(rebuiltDailyRows.every(row => String(row['Department ID'] || '').trim()), 'daily reporting writes the stable Department ID column');
assert.equal(new Set(rebuiltDailyRows.map(row => row.Date + '|' + row['Department ID'])).size, 6, 'daily reporting has unique date/department keys');
const rebuiltPurchaseDaily = rebuiltDailyRows.find(row => row['Department ID'] === 'DEPT-001');
assert.deepEqual(JSON.parse(JSON.stringify({ completedTasks: rebuiltPurchaseDaily['Tasks Completed'], completedQuantity: rebuiltPurchaseDaily['Quantity Completed'] })), { completedTasks: 2, completedQuantity: 20 });
assert.ok(rebuiltDailyRows.filter(row => row['Department ID'] !== 'DEPT-001').every(row => row['Tasks Completed'] === 1 && row['Quantity Completed'] === 10), 'downstream daily department metrics remain stage-scoped and are not final-production totals');
assert.equal(context.validateReportingCertification().success, true, 'read-only reporting certification accepts the controlled two-order acceptance dataset');

// Backup/recovery regression: recovery is allowed only into an explicit test copy.
spreadsheet.getSheetByName('TaskHistory').rows = [Array.from(context.getSheetSchemas_().TaskHistory)];
const backupFolder = new DriveFolder('backup-folder-1234567890');
driveFolders.set('backup-folder-1234567890', backupFolder);
const recoveryTestSpreadsheet = new Spreadsheet('recovery-test-spreadsheet-123456789');
spreadsheets.set(recoveryTestSpreadsheet.getId(), recoveryTestSpreadsheet);
properties.delete('GARMENT_BACKUP_FOLDER_ID'); properties.delete('GARMENT_BACKUP_RETENTION_COUNT'); properties.delete('GARMENT_RECOVERY_TEST_SPREADSHEET_ID');
let missingBackupReadiness = context.verifyBackupRecoveryReadiness();
assert.equal(missingBackupReadiness.success, false, 'missing backup/recovery properties fail closed');
assert.ok(missingBackupReadiness.errors.some(error => /folder property is missing/i.test(error)));
assert.ok(missingBackupReadiness.errors.some(error => /retention property is missing/i.test(error)));
assert.ok(missingBackupReadiness.errors.some(error => /recovery-test spreadsheet property is missing/i.test(error)));
properties.set('GARMENT_BACKUP_FOLDER_ID', 'malformed');
properties.set('GARMENT_BACKUP_RETENTION_COUNT', '0');
properties.set('GARMENT_RECOVERY_TEST_SPREADSHEET_ID', 'malformed');
const malformedBackupReadiness = context.verifyBackupRecoveryReadiness();
assert.equal(malformedBackupReadiness.backupFolderFormatValid, false, 'malformed backup-folder ID is reported');
assert.equal(malformedBackupReadiness.retentionConfigured, false, 'non-positive retention is rejected');
assert.equal(malformedBackupReadiness.recoveryTestFormatValid, false, 'malformed recovery spreadsheet ID is reported');
properties.set('GARMENT_BACKUP_FOLDER_ID', 'backup-folder-1234567890');
properties.set('GARMENT_BACKUP_RETENTION_COUNT', '1');
properties.set('GARMENT_RECOVERY_TEST_SPREADSHEET_ID', 'inaccessible-recovery-sheet-123456789');
const inaccessibleRecoveryReadiness = context.verifyBackupRecoveryReadiness();
assert.equal(inaccessibleRecoveryReadiness.recoveryTargetAccessible, false, 'inaccessible recovery spreadsheet is reported');
assert.ok(inaccessibleRecoveryReadiness.errors.some(error => /inaccessible/i.test(error)));
properties.set('GARMENT_RECOVERY_TEST_SPREADSHEET_ID', spreadsheet.getId());
const productionOrdersBeforeBackup = JSON.stringify(context.getSheetData('ProductionOrders'));
const productionTasksBeforeBackup = JSON.stringify(context.getSheetData('Tasks'));
const unsafeRecovery = context.runRecoveryTest();
assert.equal(unsafeRecovery.success, false, 'recovery rejects the Production spreadsheet as its target');
assert.equal(unsafeRecovery.errorCode, 'RECOVERY_TARGET_IS_PRODUCTION');
properties.set('GARMENT_RECOVERY_TEST_SPREADSHEET_ID', recoveryTestSpreadsheet.getId());
properties.set('GARMENT_BACKUP_FOLDER_ID', 'missing-folder-1234567890');
assert.equal(context.backupSystemData().success, false, 'invalid backup-folder configuration is rejected');
properties.set('GARMENT_BACKUP_FOLDER_ID', 'backup-folder-1234567890');
const firstBackup = context.backupSystemData();
assert.equal(firstBackup.success, true, 'tagged backup is created and verified');
assert.equal(Object.prototype.hasOwnProperty.call(firstBackup, 'backupId'), false, 'backup result does not expose Drive file IDs');
const unrelatedDriveFile = new DriveFile('unrelated-file', 'unrelated spreadsheet');
backupFolder.files.push(unrelatedDriveFile); driveFiles.set(unrelatedDriveFile.getId(), unrelatedDriveFile);
const secondBackup = context.backupSystemData();
assert.equal(secondBackup.success, true);
assert.equal(secondBackup.archivedBackupCount, 1, 'retention archives only the older known backup');
assert.equal(unrelatedDriveFile.trashed, false, 'retention preserves unrelated Drive files');
assert.equal(JSON.stringify(context.getSheetData('ProductionOrders')), productionOrdersBeforeBackup, 'backup controls never modify production orders');
assert.equal(JSON.stringify(context.getSheetData('Tasks')), productionTasksBeforeBackup, 'backup controls never modify production tasks');
const backupReadiness = context.verifyBackupRecoveryReadiness();
assert.equal(backupReadiness.success, true, 'backup/recovery readiness recognizes a safe configured test target');
recoveryTestSpreadsheet.setSpreadsheetTimeZone('Etc/UTC');
const recoveryResult = context.runRecoveryTest();
assert.equal(recoveryResult.success, true, 'recovery test restores and validates the isolated test spreadsheet');
assert.equal(recoveryResult.validation.errors.length, 0);
assert.equal(recoveryResult.timeZoneAudit.recoveryTimeZoneBefore, 'Etc/UTC', 'recovery test records the prior non-source timezone');
assert.equal(recoveryResult.timeZoneAudit.recoveryTimeZoneAfter, 'Asia/Kolkata', 'recovery target timezone is aligned to the backup before restore');
assert.equal(recoveryResult.validation.timestampDeltaSummary.kolkataOffsetCount, 0, 'native sheet restore introduces no Kolkata-offset timestamp shift');
assert.equal(context.getSheetData('ProductionOrders').length, 2, 'recovery never alters the production source spreadsheet');
const nativeCopySource = new Spreadsheet('native-copy-source');
const nativeCopySheet = nativeCopySource.insertSheet('NativeData');
nativeCopySheet.rows = [['Timestamp', 'Amount'], [new Date('2026-08-30T04:30:00.000Z'), 10]];
nativeCopySheet.formulas = [['', ''], ['', '=5+5']];
const nativeCopyTarget = new Spreadsheet('native-copy-target');
const nativeCopiedSheet = nativeCopySheet.copyTo(nativeCopyTarget);
assert.notEqual(nativeCopiedSheet.rows[1][0], nativeCopySheet.rows[1][0], 'native sheet copy preserves dates as a separate Date instance');
assert.equal(nativeCopiedSheet.rows[1][0].getTime(), nativeCopySheet.rows[1][0].getTime(), 'native sheet copy preserves date epoch values');
assert.equal(nativeCopiedSheet.formulas[1][1], '=5+5', 'native sheet copy preserves formulas');
assert.equal(context.compareRecoverySheetValues_(['Created Date'], [[new Date('2026-08-30T04:30:00.000Z')]], [[new Date('2026-08-30T04:30:00.000Z')]]).matches, true, 'separate Date objects with the same instant compare equal');
assert.equal(context.compareRecoverySheetValues_(['Created Date'], [[new Date('2026-08-30T04:30:00.000Z')]], [['2026-08-30 10:00:00']]).matches, true, 'project-timezone formatted timestamps compare semantically');
assert.equal(context.compareRecoverySheetValues_(['Created Date'], [[new Date('2026-08-30T04:30:00.789Z')]], [[new Date('2026-08-30T04:30:00.000Z')]]).matches, true, 'Google Sheets millisecond truncation is ignored at persisted-second precision');
assert.equal(context.compareRecoverySheetValues_(['Created Date'], [[new Date('2026-08-30T04:30:00.000Z')]], [[new Date('2026-08-30T04:31:00.000Z')]]).matches, false, 'a genuine one-minute timestamp change remains a failure');
const recoveryFingerprintHeaders = ['Task ID', 'Created Date', 'Quantity Planned', 'Status', 'Remarks'];
const recoveryFingerprintSource = [['Task ID', 'Created Date', 'Quantity Planned', 'Status', 'Remarks'], ['TASK-001', new Date('2026-08-30T04:30:00.500Z'), 10, 'COMPLETED', 'Verified']];
const recoveryFingerprintEquivalent = [['Task ID', 'Created Date', 'Quantity Planned', 'Status', 'Remarks'], ['TASK-001', '2026-08-30 10:00:00', 10, 'COMPLETED', 'Verified']];
assert.equal(context.compareRecoveryRowFingerprints_('Tasks', recoveryFingerprintHeaders, recoveryFingerprintSource, recoveryFingerprintEquivalent).matches, true, 'normalized row fingerprints accept equivalent persisted timestamps from separate value instances');
const recoveryFingerprintChangedQuantity = [['Task ID', 'Created Date', 'Quantity Planned', 'Status', 'Remarks'], ['TASK-001', '2026-08-30 10:00:00', 11, 'COMPLETED', 'Verified']];
assert.equal(context.compareRecoveryRowFingerprints_('Tasks', recoveryFingerprintHeaders, recoveryFingerprintSource, recoveryFingerprintChangedQuantity).matches, false, 'normalized row fingerprints reject changed quantities');
const recoveryFingerprintChangedStatus = [['Task ID', 'Created Date', 'Quantity Planned', 'Status', 'Remarks'], ['TASK-001', '2026-08-30 10:00:00', 10, 'IN_PROGRESS', 'Changed']];
assert.equal(context.compareRecoveryRowFingerprints_('Tasks', recoveryFingerprintHeaders, recoveryFingerprintSource, recoveryFingerprintChangedStatus).matches, false, 'normalized row fingerprints reject changed status and text');
const recoveryFingerprintChangedId = [['Task ID', 'Created Date', 'Quantity Planned', 'Status', 'Remarks'], ['TASK-CHANGED', '2026-08-30 10:00:00', 10, 'COMPLETED', 'Verified']];
assert.equal(context.compareRecoveryRowFingerprints_('Tasks', recoveryFingerprintHeaders, recoveryFingerprintSource, recoveryFingerprintChangedId).matches, false, 'normalized row fingerprints reject changed primary IDs');
const recoveryFingerprintNumericString = [['Task ID', 'Created Date', 'Quantity Planned', 'Status', 'Remarks'], ['TASK-001', '2026-08-30 10:00:00', '10', 'COMPLETED', 'Verified']];
const recoveryFingerprintDiagnostic = context.compareRecoveryRowFingerprints_('Tasks', recoveryFingerprintHeaders, recoveryFingerprintSource, recoveryFingerprintNumericString);
assert.equal(recoveryFingerprintDiagnostic.matches, false, 'normalized row fingerprints reject numeric strings in numeric fields');
assert.equal(recoveryFingerprintDiagnostic.diagnostics[0].mismatches[0].categories[0], 'NUMBER_VS_STRING', 'fingerprint diagnostics expose a sanitized type category without values');
assert.equal(context.compareRecoverySheetValues_(['Remarks'], [['']], [[null]]).matches, true, 'blank and null cells compare as empty');
let valueComparison = context.compareRecoverySheetValues_(['Quantity'], [[10]], [['10']]);
assert.equal(valueComparison.matches, false, 'numeric strings do not pass as numeric quantities');
assert.equal(valueComparison.summary.mismatchTypes.NUMBER_VS_NUMERIC_STRING, 1);
valueComparison = context.compareRecoverySheetValues_(['Active'], [[true]], [['TRUE']]);
assert.equal(valueComparison.matches, false, 'boolean strings do not pass as booleans');
assert.equal(valueComparison.summary.mismatchTypes.BOOLEAN_VS_STRING, 1);
valueComparison = context.compareRecoverySheetValues_(['Status'], [['COMPLETED']], [['IN_PROGRESS']]);
assert.equal(valueComparison.matches, false, 'genuine status differences remain failures');
const formulaSheet = new Sheet('formula-check'); formulaSheet.rows = [['Amount'], [10]]; formulaSheet.formulas = [[''], ['=5+5']];
const calculatedValueSheet = new Sheet('calculated-check'); calculatedValueSheet.rows = [['Amount'], [10]]; calculatedValueSheet.formulas = [[''], ['']];
assert.equal(context.compareRecoveryFormulas_(['Amount'], formulaSheet, calculatedValueSheet).matches, false, 'formula versus calculated-value differences remain failures');
const recoveredTaskSheet = recoveryTestSpreadsheet.getSheetByName('Tasks');
recoveredTaskSheet.rows[1][1] = 'ORD-MISSING';
assert.equal(context.validateRecoveryIntegrity_(spreadsheet, recoveryTestSpreadsheet).success, false, 'recovery validation rejects broken task-to-order relationships');
currentEmail = '';
assert.throws(() => context.getMyProfile(), /verified signed-in identity is available/);
assert.equal(context.diagnoseCurrentWebAppIdentity().authorizationResult, 'IDENTITY_UNAVAILABLE', 'identity diagnostic does not expose an unavailable email');
currentEmail = 'owner2@example.com';

// Rerunning setup must preserve master data rather than duplicating it.
context.initializeSystem();
assert.equal(context.getSheetData('Departments').length, 6);
assert.equal(context.getSheetData('Settings').length, 13);

const product = context.insertRecord('Products', {
  'Product ID': 'PROD-00001', 'Product Name': "Men's Shirt", Category: 'Shirts',
  'Garment Type': 'Shirt', 'Fabric Type': 'Cotton', Size: 'M', Color: 'Blue', Unit: 'pcs',
  'Standard Production Time Hours': 12, 'Selling Price': 899, 'Cost Price': 450,
  Active: true, 'Created Date': '2026-08-30 10:00:00', 'Updated Date': '2026-08-30 10:00:00'
});
assert.equal(context.getRecordById('Products', product['Product ID'])['Product Name'], "Men's Shirt");
assert.equal(context.findRecords('Products', { Category: 'Shirts' }).length, 1);
assert.equal(context.updateRecord('Products', 'PROD-00001', { Color: 'Navy' }).Color, 'Navy');
context.deleteRecord_('Products', 'PROD-00001');
assert.equal(context.getRecordById('Products', 'PROD-00001'), null);

assert.match(context.generateId('ORD'), /^ORD-\d{4}-00001$/);
assert.match(context.generateId('ORD'), /^ORD-\d{4}-00002$/);
assert.match(context.generateId('USR'), /^USR-\d{5}$/);

const departmentSheet = spreadsheet.getSheetByName('Departments');
departmentSheet.getRange(1, 1).setValues([['Bad Header']]);
assert.equal(context.validateInstallation().valid, false);
assert.throws(() => context.initializeSystem(), /Schema mismatch/);

console.log('Phase 1–3 dry run passed: setup, authorization, CRUD, dashboard aggregation, ID allocation, and schema protection checks succeeded.');
