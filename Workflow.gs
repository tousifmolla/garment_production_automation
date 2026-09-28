function getActiveWorkflow_() {
  const steps = getSheetData(APP_CONFIG.SHEETS.WORKFLOW_CONFIG)
    .filter(step => isTrue_(step['Active']))
    .sort((a, b) => Number(a['Step Number']) - Number(b['Step Number']));
  if (!steps.length) throw new Error('No active workflow steps are configured.');
  return steps;
}

function createWorkflowTasksUnderLock_(order, workflow, actor) {
  const existing = getTasksForOrder_(order['Order ID']);
  if (existing.length) throw new Error('Workflow tasks already exist for this order.');
  const timestamp = formatNow_();
  workflow.forEach((step, index) => {
    const task = buildWorkflowTask_(order, step, index === 0 ? APP_CONFIG.STATUS.READY : APP_CONFIG.STATUS.PENDING, timestamp);
    insertRecord(APP_CONFIG.SHEETS.TASKS, task);
    recordTaskHistoryUnderLock_(task, actor, '', task['Status'], 0, 0, 'TASK_CREATED');
    if (index === 0) notifyWorkflowEventUnderLock_('TASK_READY', task, actor, { severity: 'GREEN', subject: 'Task ready', message: 'A new ' + task['Department Name'] + ' task is ready for order ' + task['Order ID'] + '.' });
  });
}

function buildWorkflowTask_(order, step, status, timestamp) {
  const plannedQuantity = asNumber_(order['Quantity']);
  const deadline = calculateTaskDeadline_(order, Number(step['Step Number']));
  const department = getRecordById(APP_CONFIG.SHEETS.DEPARTMENTS, step['Department ID']);
  return {
    'Task ID': generateIdUnderLock_(APP_CONFIG.ID_PREFIXES.TASKS),
    'Order ID': order['Order ID'],
    'Workflow Step': Number(step['Step Number']),
    'Department ID': step['Department ID'],
    'Department Name': step['Department Name'],
    'Task Name': renderTaskName_(step['Task Name Template'], order, step),
    'Assigned User Email': department ? department['Default Assignee Email'] : '',
    'Quantity Planned': plannedQuantity,
    'Quantity Completed': 0,
    'Unit': order['Unit'],
    'Assigned Date': timestamp,
    'Start Date': '',
    'Deadline': deadline,
    'Completed Date': '',
    'Status': status,
    'Priority': order['Priority'],
    'Overdue Flag': false,
    'Remaining Time Hours': calculateRemainingHours_(deadline),
    'Task Duration Hours': '',
    'Delay Duration Hours': '',
    'Remarks': '',
    'Created Date': timestamp,
    'Updated Date': timestamp,
    'Version': 1,
    'Quantity Remaining': plannedQuantity
  };
}

function renderTaskName_(template, order, step) {
  return String(template || '{Department Name} - {Product Name}')
    .replace('{Department Name}', step['Department Name'])
    .replace('{Product Name}', order['Product Name']);
}

function calculateTaskDeadline_(order, stepNumber) {
  if (!order['Required Delivery Date']) return '';
  const delivery = new Date(order['Required Delivery Date']);
  if (Number.isNaN(delivery.getTime())) return '';
  const start = order['Order Date'] ? new Date(order['Order Date']) : new Date();
  const totalSteps = getActiveWorkflow_().length;
  if (Number.isNaN(start.getTime()) || delivery <= start) return order['Required Delivery Date'];
  return new Date(start.getTime() + (delivery.getTime() - start.getTime()) * stepNumber / totalSteps);
}

function activateNextTaskUnderLock_(completedTask, actor) {
  const nextStep = Number(completedTask['Workflow Step']) + 1;
  const nextTask = getTasksForOrder_(completedTask['Order ID']).find(task => Number(task['Workflow Step']) === nextStep);
  if (!nextTask) return null;
  if (nextTask['Status'] !== APP_CONFIG.STATUS.PENDING) return nextTask;
  const partialEnabled = getSettingValue_('PARTIAL_COMPLETION_ALLOWED', 'FALSE') === 'TRUE';
  const plannedQuantity = partialEnabled ? asNumber_(completedTask['Quantity Completed']) : asNumber_(nextTask['Quantity Planned']);
  const updated = updateTaskRecordUnderLock_(nextTask, {
    'Status': APP_CONFIG.STATUS.READY,
    'Quantity Planned': plannedQuantity,
    'Quantity Remaining': plannedQuantity,
    'Updated Date': formatNow_(),
    'Version': asNumber_(nextTask['Version']) + 1
  });
  recordTaskHistoryUnderLock_(updated, actor, APP_CONFIG.STATUS.PENDING, APP_CONFIG.STATUS.READY, 0, 0, 'TASK_ACTIVATED');
  writeWorkflowAuditUnderLock_(actor, 'ACTIVATE_NEXT_TASK', 'TASK', updated['Task ID'], nextTask, updated, 'Previous stage completed.');
  notifyWorkflowEventUnderLock_('NEXT_DEPARTMENT_ACTIVATED', updated, actor, { severity: 'GREEN', subject: 'Next department activated', message: updated['Department Name'] + ' can now begin order ' + updated['Order ID'] + '.' });
  notifyWorkflowEventUnderLock_('TASK_READY', updated, actor, { severity: 'GREEN', subject: 'Task ready', message: 'A task is ready for order ' + updated['Order ID'] + '.' });
  return updated;
}

function updateOrderProgressUnderLock_(orderId, actor) {
  const order = getRecordById(APP_CONFIG.SHEETS.PRODUCTION_ORDERS, orderId);
  const tasks = getTasksForOrder_(orderId);
  const allCompleted = tasks.length > 0 && tasks.every(task => task['Status'] === APP_CONFIG.STATUS.COMPLETED);
  const hasStarted = tasks.some(task => ![APP_CONFIG.STATUS.PENDING, APP_CONFIG.STATUS.READY].includes(task['Status']));
  const finalTask = tasks.slice().sort((a, b) => Number(a['Workflow Step']) - Number(b['Workflow Step'])).pop();
  const furthestOutput = allCompleted && finalTask ? asNumber_(finalTask['Quantity Completed']) : tasks.reduce((quantity, task) => Math.max(quantity, asNumber_(task['Quantity Completed'])), 0);
  const status = allCompleted ? APP_CONFIG.STATUS.COMPLETED : (hasStarted ? APP_CONFIG.STATUS.IN_PROGRESS : APP_CONFIG.STATUS.READY);
  const updated = updateRecord(APP_CONFIG.SHEETS.PRODUCTION_ORDERS, orderId, {
    'Completed Quantity': furthestOutput, 'Overall Status': status, 'Updated Date': formatNow_()
  });
  if (status !== order['Overall Status'] || asNumber_(order['Completed Quantity']) !== furthestOutput) {
    writeWorkflowAuditUnderLock_(actor, 'UPDATE_ORDER_PROGRESS', 'PRODUCTION_ORDER', orderId, order, updated, 'Workflow progress recalculated.');
  }
  if (status === APP_CONFIG.STATUS.COMPLETED && order['Overall Status'] !== APP_CONFIG.STATUS.COMPLETED && finalTask) {
    notifyWorkflowEventUnderLock_('ORDER_COMPLETED', finalTask, actor, { severity: 'GREEN', subject: 'Order completed', message: 'Production order ' + orderId + ' is complete.' });
  }
  return updated;
}

function calculateOrderProgress_(tasks) {
  if (!tasks.length) return 0;
  const completed = tasks.reduce((total, task) => total + (task['Status'] === APP_CONFIG.STATUS.COMPLETED ? 1 : Math.min(1, asNumber_(task['Quantity Completed']) / Math.max(1, asNumber_(task['Quantity Planned'])))), 0);
  return Math.round(completed / tasks.length * 100);
}

function getSettingValue_(key, fallback) {
  if (typeof CacheService !== 'undefined') {
    const cache = CacheService.getScriptCache();
    const cached = cache.get('SETTING_' + key);
    if (cached !== null) return cached;
    const setting = getSheetData(APP_CONFIG.SHEETS.SETTINGS).find(record => record['Setting Key'] === key);
    const value = setting && setting['Setting Value'] !== '' ? String(setting['Setting Value']).toUpperCase() : fallback;
    cache.put('SETTING_' + key, value, 300);
    return value;
  }
  const setting = getSheetData(APP_CONFIG.SHEETS.SETTINGS).find(record => record['Setting Key'] === key);
  return setting && setting['Setting Value'] !== '' ? String(setting['Setting Value']).toUpperCase() : fallback;
}

function calculateRemainingHours_(deadline) {
  if (!deadline) return '';
  const date = new Date(deadline);
  if (Number.isNaN(date.getTime())) return '';
  return Math.round((date.getTime() - Date.now()) / 3600000 * 100) / 100;
}

function writeWorkflowAuditUnderLock_(actor, action, entityType, entityId, oldValue, newValue, remarks) {
  insertRecord(APP_CONFIG.SHEETS.AUDIT_LOG, {
    'Log ID': generateIdUnderLock_(APP_CONFIG.ID_PREFIXES.AUDIT_LOG), 'Timestamp': formatNow_(),
    'User Email': actor['Email'], 'Role': actor['Role'], 'Action': action, 'Entity Type': entityType,
    'Entity ID': entityId, 'Old Value JSON': oldValue ? JSON.stringify(oldValue) : '',
    'New Value JSON': newValue ? JSON.stringify(newValue) : '', 'Remarks': remarks || '', 'Correlation ID': ''
  });
}
