/* Phase 4 workflow and task-management dry run using an in-memory GAS mock. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Range {
  constructor(sheet, row, column, rows, columns) { Object.assign(this, { sheet, row, column, rows, columns }); }
  getValues() { return Array.from({ length: this.rows }, (_, r) => Array.from({ length: this.columns }, (_, c) => (this.sheet.rows[this.row - 1 + r] || [])[this.column - 1 + c] ?? '')); }
  setValues(values) { values.forEach((source, r) => source.forEach((value, c) => { const row = this.row - 1 + r; this.sheet.rows[row] ||= []; this.sheet.rows[row][this.column - 1 + c] = value; })); return this; }
  setFontWeight() { return this; } setBackground() { return this; } setFontColor() { return this; }
}
class Sheet {
  constructor(name) { this.name = name; this.rows = [[]]; }
  getLastColumn() { return this.rows.reduce((size, row) => Math.max(size, row.length), 0); }
  getLastRow() { return this.rows.length; }
  getRange(row, column, rows = 1, columns = 1) { return new Range(this, row, column, rows, columns); }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  appendRow(row) { this.rows.push([...row]); } deleteRow(row) { this.rows.splice(row - 1, 1); }
  setFrozenRows() {} autoResizeColumns() {}
}
class Spreadsheet {
  constructor() { this.sheets = new Map(); } getId() { return 'phase4-dry-run'; }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) { const sheet = new Sheet(name); this.sheets.set(name, sheet); return sheet; }
}

const spreadsheet = new Spreadsheet();
const properties = new Map();
let currentEmail = 'admin@example.com';
const context = vm.createContext({
  SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, openById: () => spreadsheet, flush: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties.get(key) || null, setProperty: (key, value) => properties.set(key, value) }) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  Session: { getActiveUser: () => ({ getEmail: () => currentEmail }), getScriptTimeZone: () => 'Asia/Kolkata' },
  Utilities: { formatDate: () => '2026-08-30 10:00:00' }, Date, Error, Object, String, Number, Array, JSON
});
['Config.gs', 'Utils.gs', 'Database.gs', 'Setup.gs', 'Auth.gs', 'Users.gs', 'Notifications.gs', 'Orders.gs', 'Workflow.gs', 'Tasks.gs'].forEach(file =>
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file }));

properties.set('GARMENT_INITIAL_ADMIN_EMAIL', currentEmail);
context.initializeSystem();
const admin = context.bootstrapInitialAdmin();
const departmentUsers = [
  ['purchase@example.com', 'Purchase Lead', 'DEPT-001'], ['cutting@example.com', 'Cutting Lead', 'DEPT-002'],
  ['making@example.com', 'Making Lead', 'DEPT-003'], ['finishing@example.com', 'Finishing Lead', 'DEPT-004'],
  ['packaging@example.com', 'Packaging Lead', 'DEPT-005'], ['selling@example.com', 'Selling Lead', 'DEPT-006']
].map(([email, displayName, departmentId]) => context.createUser({ email, displayName, role: 'DEPARTMENT_USER', departmentId }));
context.insertRecord('Products', { 'Product ID': 'PROD-TEST', 'Product Name': "Men's Shirt", 'Garment Type': 'Shirt', 'Size': 'M', 'Color': 'Blue', Unit: 'pcs', Active: true });
context.insertRecord('Customers', { 'Customer ID': 'CUST-TEST', 'Customer Name': 'Northwind Garments', Active: true });

const tracking = context.createProductionOrder({
  customerId: 'CUST-TEST', productId: 'PROD-TEST',
  quantity: 100, unit: 'pcs', orderDate: '2026-08-30 09:00:00', requiredDeliveryDate: '2026-09-05 18:00:00', priority: 'HIGH'
});
assert.equal(tracking.stages.length, 6, 'complete configured workflow is generated');
assert.equal(tracking.stages[0].status, 'READY', 'only first task starts ready');
assert.equal(typeof tracking.stages[0].deadline, 'string', 'workflow response converts Date values into RPC-safe strings');
assert.ok(tracking.stages.slice(1).every(task => task.status === 'PENDING'), 'later stages wait');
assert.equal(context.getSheetData('Tasks').length, 6, 'no duplicate workflow tasks generated');

const purchaseTask = tracking.stages[0];
currentEmail = 'cutting@example.com';
assert.throws(() => context.startTask(purchaseTask.taskId), /own department/, 'department isolation is enforced');
currentEmail = 'purchase@example.com';
assert.equal(context.listMyTasks().length, 1, 'department sees only own task');
assert.throws(() => context.updateTaskProgress(purchaseTask.taskId, { quantityCompleted: 1 }), /only be updated while a task is in progress/, 'ready tasks cannot receive progress');
assert.throws(() => context.completeTask(purchaseTask.taskId, { quantityCompleted: 100 }), /Only an in-progress or started overdue task/, 'ready tasks cannot be completed');
assert.equal(context.getRecordById('Tasks', purchaseTask.taskId)['Quantity Completed'], 0, 'a rejected READY progress request does not change quantity');
assert.equal(context.startTask(purchaseTask.taskId, 'Supplier confirmed').status, 'IN_PROGRESS');
assert.equal(context.updateTaskProgress(purchaseTask.taskId, { quantityCompleted: 40, remarks: 'First shipment received' }).quantityRemaining, 60);
assert.throws(() => context.updateTaskProgress(purchaseTask.taskId, { quantityCompleted: 101 }), /between zero and planned quantity/, 'progress cannot exceed planned quantity');
assert.throws(() => context.completeTask(purchaseTask.taskId, { quantityCompleted: 40 }), /Full planned quantity/, 'default completion rule requires 100%');

// Enable partial completion to verify the configured exception flow.
currentEmail = 'admin@example.com';
const partialSetting = context.getSheetData('Settings').find(row => row['Setting Key'] === 'PARTIAL_COMPLETION_ALLOWED');
context.updateRecord('Settings', partialSetting['Setting Key'], { 'Setting Value': 'TRUE' });
currentEmail = 'purchase@example.com';
const purchaseResult = context.completeTask(purchaseTask.taskId, { quantityCompleted: 40, remarks: 'Partial transfer approved' });
assert.equal(purchaseResult.task.status, 'COMPLETED');
assert.equal(purchaseResult.nextTaskActivated, true);

currentEmail = 'admin@example.com';
let stages = context.getOrderTracking(tracking.order.orderId).stages;
assert.equal(stages[1].status, 'READY', 'completion activates next department');
assert.equal(stages[1].quantityPlanned, 40, 'partial output becomes next planned quantity');
assert.equal(context.getSheetData('Tasks').length, 6, 'transition does not create duplicate tasks');
assert.throws(() => context.completeTask(purchaseTask.taskId, { quantityCompleted: 40 }), /Only an in-progress or started overdue task/, 'a completed task cannot activate the next stage twice');
assert.equal(context.getOrderTracking(tracking.order.orderId).stages[1].status, 'READY', 'next department remains activated exactly once');
assert.ok(context.getSheetData('TaskHistory').some(row => row['Event Type'] === 'TASK_COMPLETED'), 'completion history recorded');
assert.ok(context.getSheetData('AuditLog').some(row => row['Action'] === 'COMPLETE_TASK'), 'completion audit recorded');

// Complete every remaining stage with the transferred quantity.
let finalCompletion;
for (let step = 1; step < stages.length; step += 1) {
  const task = stages[step];
  currentEmail = departmentUsers[step].email;
  assert.equal(context.startTask(task.taskId).status, 'IN_PROGRESS');
  const completion = context.completeTask(task.taskId, { quantityCompleted: task.quantityPlanned });
  if (step === stages.length - 1) finalCompletion = completion;
  currentEmail = 'admin@example.com';
  stages = context.getOrderTracking(tracking.order.orderId).stages;
}

const completedOrder = context.getOrderTracking(tracking.order.orderId);
assert.equal(completedOrder.order.status, 'COMPLETED', 'final task completes order');
assert.equal(completedOrder.order.completedQuantity, 40, 'final output quantity is retained');
assert.equal(completedOrder.progressPercent, 100, 'completed workflow reports 100% progress');
assert.ok(completedOrder.stages.every(task => task.status === 'COMPLETED'), 'all stages are traceably complete');
assert.equal(finalCompletion.nextTaskActivated, false, 'final completion does not activate a nonexistent next stage');
assert.equal(finalCompletion.order.status, 'COMPLETED', 'final completion response identifies order closure');
currentEmail = 'selling@example.com';
assert.throws(() => context.createProductionOrder({ customerName: 'X', productName: 'Y', quantity: 1 }), /Administrator role required/, 'non-admin cannot create orders');
assert.equal(admin.role, 'ADMIN');
console.log('Phase 4 dry run passed: order creation, pipeline generation, authorization, partial quantities, transitions, history, audit, duplicate prevention, and order completion succeeded.');
