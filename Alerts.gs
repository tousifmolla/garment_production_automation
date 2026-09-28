/** Admin-only deadline monitor; install as a 15-minute time-driven trigger. */
function monitorDeadlines() {
  return withScriptLock_(() => monitorDeadlinesUnderLock_());
}

function monitorDeadlinesUnderLock_() {
  const actor = requireAdmin_();
  const now = new Date();
  const tasks = getSheetData(APP_CONFIG.SHEETS.TASKS);
  const changedTasks = [];
  tasks.forEach(task => {
    if (!isMonitoredTask_(task)) {
      if ([APP_CONFIG.STATUS.COMPLETED, APP_CONFIG.STATUS.CANCELLED].includes(task['Status'])) resolveOpenAlertsUnderLock_('TASK|' + task['Task ID'] + '|', actor, 'Task completed or cancelled.');
      return;
    }
    const evaluation = evaluateTaskDeadline_(task, now);
    const updated = updateTaskTimingUnderLock_(task, evaluation);
    if (updated) changedTasks.push(updated['Task ID']);
    reconcileTaskAlertUnderLock_(updated || task, evaluation, actor);
  });
  reconcileDeliveryRiskAlertsUnderLock_(now, actor);
  return { success: true, checkedAt: formatNow_(), updatedTaskIds: changedTasks };
}

function evaluateTaskDeadline_(task, now) {
  if (task['Status'] === APP_CONFIG.STATUS.BLOCKED) return { level: 'BLOCKED', overdue: false, remainingHours: calculateRemainingHours_(task['Deadline']), delayHours: 0 };
  const deadline = task['Deadline'] ? new Date(task['Deadline']) : null;
  if (!deadline || Number.isNaN(deadline.getTime())) return { level: 'GREEN', overdue: false, remainingHours: '', delayHours: 0 };
  const remainingHours = Math.round((deadline.getTime() - now.getTime()) / 3600000 * 100) / 100;
  const warningHours = Number(getSettingValue_('OVERDUE_WARNING_HOURS', '24')) || 24;
  if (remainingHours < 0) return { level: 'RED', overdue: true, remainingHours, delayHours: Math.abs(remainingHours) };
  if (remainingHours <= warningHours) return { level: 'YELLOW', overdue: false, remainingHours, delayHours: 0 };
  return { level: 'GREEN', overdue: false, remainingHours, delayHours: 0 };
}

function isMonitoredTask_(task) {
  return ![APP_CONFIG.STATUS.PENDING, APP_CONFIG.STATUS.COMPLETED, APP_CONFIG.STATUS.CANCELLED].includes(task['Status']);
}

function updateTaskTimingUnderLock_(task, evaluation) {
  const nextStatus = evaluation.overdue ? APP_CONFIG.STATUS.OVERDUE : task['Status'];
  const statusChanged = nextStatus !== task['Status'];
  const timingChanged = isTrue_(task['Overdue Flag']) !== evaluation.overdue || asNumber_(task['Remaining Time Hours']) !== asNumber_(evaluation.remainingHours) || asNumber_(task['Delay Duration Hours']) !== asNumber_(evaluation.delayHours);
  if (!statusChanged && !timingChanged) return null;
  const updated = updateTaskRecordUnderLock_(task, {
    'Status': nextStatus, 'Overdue Flag': evaluation.overdue, 'Remaining Time Hours': evaluation.remainingHours,
    'Delay Duration Hours': evaluation.delayHours, 'Updated Date': formatNow_(), 'Version': asNumber_(task['Version']) + 1
  });
  if (statusChanged) {
    const actor = getCurrentUser_();
    recordTaskHistoryUnderLock_(updated, actor, task['Status'], nextStatus, asNumber_(task['Quantity Completed']), asNumber_(task['Quantity Completed']), 'TASK_OVERDUE');
    writeWorkflowAuditUnderLock_(actor, 'MARK_TASK_OVERDUE', 'TASK', task['Task ID'], task, updated, 'Deadline monitoring detected an overdue task.');
  }
  return updated;
}

function reconcileTaskAlertUnderLock_(task, evaluation, actor) {
  const type = evaluation.level === 'RED' ? 'TASK_OVERDUE' : evaluation.level === 'YELLOW' ? 'TASK_DEADLINE_APPROACHING' : evaluation.level === 'BLOCKED' ? 'TASK_BLOCKED' : '';
  if (!type) {
    resolveOpenAlertsUnderLock_('TASK|' + task['Task ID'], actor, 'Task is on schedule or no longer active.');
    return;
  }
  const key = 'TASK|' + task['Task ID'] + '|' + type;
  resolveOpenAlertsUnderLock_('TASK|' + task['Task ID'] + '|', actor, 'Alert condition changed.', key);
  upsertAlertUnderLock_({
    level: evaluation.level, type, orderId: task['Order ID'], taskId: task['Task ID'], departmentId: task['Department ID'],
    departmentName: task['Department Name'], deadline: task['Deadline'], delayHours: evaluation.delayHours,
    message: buildTaskAlertMessage_(task, evaluation), deduplicationKey: key
  }, actor);
}

function buildTaskAlertMessage_(task, evaluation) {
  if (evaluation.level === 'BLOCKED') return 'Blocked: ' + task['Department Name'] + ' cannot proceed on ' + task['Order ID'] + '.';
  if (evaluation.level === 'RED') return 'Overdue: ' + task['Department Name'] + ' task for ' + task['Order ID'] + ' is delayed by ' + evaluation.delayHours + ' hours.';
  return 'Deadline approaching: ' + task['Department Name'] + ' task for ' + task['Order ID'] + ' is due in ' + evaluation.remainingHours + ' hours.';
}

function reconcileDeliveryRiskAlertsUnderLock_(now, actor) {
  const warningHours = Number(getSettingValue_('OVERDUE_WARNING_HOURS', '24')) || 24;
  getSheetData(APP_CONFIG.SHEETS.PRODUCTION_ORDERS).forEach(order => {
    const key = 'ORDER|' + order['Order ID'] + '|DELIVERY_RISK';
    if (order['Overall Status'] === APP_CONFIG.STATUS.COMPLETED) return resolveOpenAlertsUnderLock_(key, actor, 'Order completed.');
    if (!order['Required Delivery Date']) return;
    const delivery = new Date(order['Required Delivery Date']);
    if (Number.isNaN(delivery.getTime())) return;
    const remainingHours = Math.round((delivery.getTime() - now.getTime()) / 3600000 * 100) / 100;
    if (remainingHours > warningHours) return resolveOpenAlertsUnderLock_(key, actor, 'Delivery date is no longer at risk.');
    const level = remainingHours < 0 ? 'RED' : 'YELLOW';
    upsertAlertUnderLock_({ level, type: 'ORDER_DELIVERY_RISK', orderId: order['Order ID'], taskId: '', departmentId: '', departmentName: '', deadline: order['Required Delivery Date'], delayHours: Math.max(0, -remainingHours), message: 'Delivery risk: order ' + order['Order ID'] + ' is due in ' + remainingHours + ' hours.', deduplicationKey: key }, actor);
  });
}

function upsertAlertUnderLock_(input, actor) {
  const existing = getSheetData(APP_CONFIG.SHEETS.ALERTS).find(alert => alert['Deduplication Key'] === input.deduplicationKey && ['OPEN', 'ACKNOWLEDGED'].includes(String(alert['Status']).toUpperCase()));
  const timestamp = formatNow_();
  if (existing) {
    return updateRecord(APP_CONFIG.SHEETS.ALERTS, existing['Alert ID'], { 'Alert Level': input.level, 'Message': input.message, 'Deadline': input.deadline, 'Delay Duration Hours': input.delayHours, 'Updated Date': timestamp });
  }
  const alert = {
    'Alert ID': generateIdUnderLock_(APP_CONFIG.ID_PREFIXES.ALERTS), 'Alert Level': input.level, 'Alert Type': input.type,
    'Order ID': input.orderId, 'Task ID': input.taskId, 'Department ID': input.departmentId, 'Message': input.message,
    'Status': 'OPEN', 'Raised Date': timestamp, 'Resolved Date': '', 'Deduplication Key': input.deduplicationKey,
    'Created Date': timestamp, 'Updated Date': timestamp, 'Department Name': input.departmentName, 'Deadline': input.deadline,
    'Delay Duration Hours': input.delayHours, 'Acknowledged At': '', 'Acknowledged By': ''
  };
  insertRecord(APP_CONFIG.SHEETS.ALERTS, alert);
  writeWorkflowAuditUnderLock_(actor, 'CREATE_ALERT', 'ALERT', alert['Alert ID'], null, alert, input.type);
  createNotificationUnderLock_({ eventType: input.type === 'TASK_OVERDUE' ? 'TASK_OVERDUE' : input.type === 'TASK_DEADLINE_APPROACHING' ? 'DEADLINE_APPROACHING' : input.type === 'ORDER_DELIVERY_RISK' ? 'ORDER_AT_RISK' : 'TASK_BLOCKED', taskId: input.taskId, orderId: input.orderId, departmentId: input.departmentId, severity: input.level, subject: input.level + ' alert', message: input.message, deduplicationKey: 'ALERT|' + alert['Alert ID'] });
  return alert;
}

function resolveOpenAlertsUnderLock_(keyPrefix, actor, remarks, exceptKey) {
  getSheetData(APP_CONFIG.SHEETS.ALERTS).filter(alert => String(alert['Deduplication Key']).indexOf(keyPrefix) === 0 && alert['Deduplication Key'] !== exceptKey && ['OPEN', 'ACKNOWLEDGED'].includes(String(alert['Status']).toUpperCase())).forEach(alert => {
    const updated = updateRecord(APP_CONFIG.SHEETS.ALERTS, alert['Alert ID'], { 'Status': 'RESOLVED', 'Resolved Date': formatNow_(), 'Updated Date': formatNow_() });
    writeWorkflowAuditUnderLock_(actor, 'RESOLVE_ALERT', 'ALERT', alert['Alert ID'], alert, updated, remarks);
  });
}

function listAlerts(filters) {
  requireAdmin_();
  return filterAlerts_(getSheetData(APP_CONFIG.SHEETS.ALERTS), filters).map(toAlertDetailDto_);
}

function listMyAlerts(filters) {
  const user = getCurrentUser_();
  const alerts = user['Role'] === APP_CONFIG.ROLES.ADMIN ? getSheetData(APP_CONFIG.SHEETS.ALERTS) : getSheetData(APP_CONFIG.SHEETS.ALERTS).filter(alert => String(alert['Department ID']) === String(user['Department ID']));
  return filterAlerts_(alerts, filters).map(toAlertDetailDto_);
}

function acknowledgeAlert(alertId) { return withScriptLock_(() => changeAlertStateUnderLock_(alertId, 'ACKNOWLEDGED')); }
function resolveAlert(alertId) { return withScriptLock_(() => changeAlertStateUnderLock_(alertId, 'RESOLVED')); }

function changeAlertStateUnderLock_(alertId, status) {
  const alert = getRecordById(APP_CONFIG.SHEETS.ALERTS, alertId);
  if (!alert) throw new Error('Alert not found.');
  const actor = alert['Department ID'] ? requireDepartmentAccess_(alert['Department ID']) : requireAdmin_();
  const changes = { 'Status': status, 'Updated Date': formatNow_() };
  if (status === 'ACKNOWLEDGED') { changes['Acknowledged At'] = formatNow_(); changes['Acknowledged By'] = actor['Email']; }
  if (status === 'RESOLVED') changes['Resolved Date'] = formatNow_();
  const updated = updateRecord(APP_CONFIG.SHEETS.ALERTS, alertId, changes);
  writeWorkflowAuditUnderLock_(actor, status + '_ALERT', 'ALERT', alertId, alert, updated, 'Alert state changed manually.');
  return toAlertDetailDto_(updated);
}

/** @deprecated Use setupTriggers() to configure the complete production trigger set. */
function setupDeadlineMonitoringTrigger() {
  requireAdmin_();
  ScriptApp.getProjectTriggers().filter(trigger => trigger.getHandlerFunction() === 'monitorDeadlines').forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('monitorDeadlines').timeBased().everyMinutes(15).create();
  return { success: true, message: '15-minute deadline monitor trigger configured.' };
}

/** Future notification extension point; writes dashboard-notification intent only. */

function filterAlerts_(alerts, filters) {
  return alerts.filter(alert => Object.keys(filters || {}).every(key => !filters[key] || String(alert[alertFilterField_(key)] || '').toUpperCase() === String(filters[key]).toUpperCase()));
}
function alertFilterField_(key) { return { orderId: 'Order ID', taskId: 'Task ID', departmentId: 'Department ID', severity: 'Alert Level', status: 'Status', type: 'Alert Type' }[key] || key; }
function toAlertDetailDto_(alert) { return { alertId: alert['Alert ID'], level: alert['Alert Level'], severity: alert['Alert Level'], type: alert['Alert Type'], orderId: alert['Order ID'], taskId: alert['Task ID'], departmentId: alert['Department ID'], departmentName: alert['Department Name'], message: alert['Message'], deadline: toClientValue_(alert['Deadline']), delayHours: asNumber_(alert['Delay Duration Hours']), status: alert['Status'], createdAt: toClientValue_(alert['Raised Date']), acknowledgedAt: toClientValue_(alert['Acknowledged At']), resolvedAt: toClientValue_(alert['Resolved Date']) }; }
