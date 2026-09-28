/** Returns the complete administrator dashboard model. */
function getAdminDashboard() {
  requireAdmin_();
  const orders = getSheetData(APP_CONFIG.SHEETS.PRODUCTION_ORDERS);
  const tasks = getSheetData(APP_CONFIG.SHEETS.TASKS);
  const departments = getSheetData(APP_CONFIG.SHEETS.DEPARTMENTS)
    .filter(department => isTrue_(department['Active']))
    .sort((a, b) => Number(a['Sequence']) - Number(b['Sequence']));
  const alerts = getSheetData(APP_CONFIG.SHEETS.ALERTS)
    .filter(alert => String(alert['Status']).toUpperCase() !== 'RESOLVED')
    .sort((a, b) => String(b['Raised Date']).localeCompare(String(a['Raised Date'])));

  const timeZone = Session.getScriptTimeZone() || 'Asia/Kolkata';
  const today = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
  const openOrderStatuses = [APP_CONFIG.STATUS.PENDING, APP_CONFIG.STATUS.READY, APP_CONFIG.STATUS.IN_PROGRESS, APP_CONFIG.STATUS.ON_HOLD, APP_CONFIG.STATUS.OVERDUE, APP_CONFIG.STATUS.BLOCKED];
  const activeOrders = orders.filter(order => openOrderStatuses.includes(String(order['Overall Status']).toUpperCase()));
  const completedOrders = orders.filter(order => String(order['Overall Status']).toUpperCase() === APP_CONFIG.STATUS.COMPLETED);
  const tasksByOrder = tasks.reduce((index, task) => {
    (index[task['Order ID']] || (index[task['Order ID']] = [])).push(task);
    return index;
  }, {});
  const kpis = {
    totalOrders: orders.length,
    activeOrders: activeOrders.length,
    completedOrders: completedOrders.length,
    pendingTasks: countStatus_(tasks, APP_CONFIG.STATUS.PENDING) + countStatus_(tasks, APP_CONFIG.STATUS.READY),
    inProgressTasks: countStatus_(tasks, APP_CONFIG.STATUS.IN_PROGRESS),
    overdueTasks: countStatus_(tasks, APP_CONFIG.STATUS.OVERDUE),
    blockedTasks: countStatus_(tasks, APP_CONFIG.STATUS.BLOCKED),
    completedToday: completedOrders.filter(order => isDashboardDate_(getFinalOrderCompletionTimestamp_(order, tasksByOrder[order['Order ID']] || []), today, timeZone)).length,
    totalProductionQuantity: sumNumber_(orders, 'Quantity'),
    completedQuantity: completedOrders.reduce((total, order) => total + completedOrderQuantity_(order), 0),
    activeWipQuantity: activeOrders.reduce((total, order) => total + asNumber_(order['Quantity']), 0)
  };

  return {
    generatedAt: formatNow_(),
    kpis: kpis,
    departments: departments.map(department => buildDepartmentSummary_(department, tasks)),
    alerts: alerts.slice(0, 8).map(toAlertDto_),
    recentOrders: orders.sort((a, b) => String(b['Created Date']).localeCompare(String(a['Created Date']))).slice(0, 8).map(order => buildOrderSummary_(order, tasks))
  };
}

/** Final output quantity counts only completed ProductionOrders, never intermediate task output. */
function completedOrderQuantity_(order) {
  return Math.min(asNumber_(order['Quantity']), Math.max(0, asNumber_(order['Completed Quantity'])));
}

/** Uses the final workflow stage timestamp; Updated Date is a legacy fallback only. */
function getFinalOrderCompletionTimestamp_(order, orderTasks) {
  const finalTask = orderTasks.slice().sort((left, right) => Number(right['Workflow Step']) - Number(left['Workflow Step']))[0];
  return finalTask && finalTask['Completed Date'] ? finalTask['Completed Date'] : order['Updated Date'];
}

function isDashboardDate_(value, expectedDate, timeZone) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && Utilities.formatDate(date, timeZone, 'yyyy-MM-dd') === expectedDate;
}

function buildDepartmentSummary_(department, tasks) {
  const departmentTasks = tasks.filter(task => String(task['Department ID']) === String(department['Department ID']));
  return {
    departmentId: department['Department ID'], name: department['Department Name'],
    pending: countStatus_(departmentTasks, APP_CONFIG.STATUS.PENDING) + countStatus_(departmentTasks, APP_CONFIG.STATUS.READY),
    inProgress: countStatus_(departmentTasks, APP_CONFIG.STATUS.IN_PROGRESS),
    completed: countStatus_(departmentTasks, APP_CONFIG.STATUS.COMPLETED),
    overdue: countStatus_(departmentTasks, APP_CONFIG.STATUS.OVERDUE),
    blocked: countStatus_(departmentTasks, APP_CONFIG.STATUS.BLOCKED)
  };
}

function buildOrderSummary_(order, tasks) {
  const orderTasks = tasks.filter(task => String(task['Order ID']) === String(order['Order ID']));
  const completed = countStatus_(orderTasks, APP_CONFIG.STATUS.COMPLETED);
  return {
    orderId: order['Order ID'], customerName: order['Customer Name'], productName: order['Product Name'],
    quantity: asNumber_(order['Quantity']), completedQuantity: asNumber_(order['Completed Quantity']),
    status: order['Overall Status'] || APP_CONFIG.STATUS.PENDING,
    deliveryDate: toClientValue_(order['Required Delivery Date']), taskProgress: orderTasks.length ? Math.round(completed / orderTasks.length * 100) : 0
  };
}

function toAlertDto_(alert) {
  return {
    alertId: alert['Alert ID'], level: alert['Alert Level'], type: alert['Alert Type'],
    orderId: alert['Order ID'], taskId: alert['Task ID'], message: alert['Message'], raisedDate: toClientValue_(alert['Raised Date'])
  };
}

function countStatus_(records, status) {
  return records.filter(record => String(record['Status']).toUpperCase() === status).length;
}

function sumNumber_(records, field) {
  return records.reduce((total, record) => total + asNumber_(record[field]), 0);
}
