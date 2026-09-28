/** Reusable, role-scoped operational dashboard for any department user. */
function getDepartmentDashboard(filters) {
  const user = getCurrentUser_();
  if (user['Role'] !== APP_CONFIG.ROLES.DEPARTMENT_USER) throw new Error('Department dashboard access requires a department-user role.');
  const departmentId = user['Department ID'];
  const normalized = normalizeDepartmentFilters_(filters);
  const tasks = getSheetData(APP_CONFIG.SHEETS.TASKS).filter(task => String(task['Department ID']) === String(departmentId));
  const ordersById = getSheetData(APP_CONFIG.SHEETS.PRODUCTION_ORDERS).reduce((map, order) => { map[order['Order ID']] = order; return map; }, {});
  const alertsByTask = getSheetData(APP_CONFIG.SHEETS.ALERTS).filter(alert => String(alert['Department ID']) === String(departmentId) && ['OPEN', 'ACKNOWLEDGED'].includes(String(alert['Status']).toUpperCase())).reduce((map, alert) => { const taskId = alert['Task ID']; if (!map[taskId]) map[taskId] = []; map[taskId].push(alert); return map; }, {});
  const taskRows = tasks.map(task => toDepartmentTaskDto_(task, ordersById[task['Order ID']], alertsByTask[task['Task ID']] || []));
  const filtered = taskRows.filter(row => matchesDepartmentFilters_(row, normalized));
  const sorted = filtered.sort((a, b) => String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')) || String(a.taskId).localeCompare(String(b.taskId)));
  const pageCount = Math.max(1, Math.ceil(sorted.length / normalized.pageSize));
  const page = Math.min(normalized.page, pageCount);
  const start = (page - 1) * normalized.pageSize;
  return {
    department: { id: departmentId, name: user['Department Name'] },
    kpis: buildDepartmentKpis_(taskRows),
    alertSummary: buildDepartmentAlertSummary_(alertsByTask),
    tasks: sorted.slice(start, start + normalized.pageSize),
    pagination: { page, pageSize: normalized.pageSize, total: sorted.length, pageCount },
    filters: normalized
  };
}

function normalizeDepartmentFilters_(filters) {
  const source = filters || {};
  const pageSize = Math.min(100, Math.max(5, Number(source.pageSize) || 10));
  return {
    search: String(source.search || '').trim().toLowerCase(), status: String(source.status || 'ALL').toUpperCase(),
    priority: String(source.priority || 'ALL').toUpperCase(), deadline: String(source.deadline || 'ALL').toUpperCase(),
    page: Math.max(1, Number(source.page) || 1), pageSize
  };
}

function buildDepartmentKpis_(tasks) {
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Kolkata', 'yyyy-MM-dd');
  return {
    ready: tasks.filter(task => task.status === APP_CONFIG.STATUS.READY).length,
    inProgress: tasks.filter(task => task.status === APP_CONFIG.STATUS.IN_PROGRESS).length,
    pending: tasks.filter(task => task.status === APP_CONFIG.STATUS.PENDING).length,
    completedToday: tasks.filter(task => task.status === APP_CONFIG.STATUS.COMPLETED && String(task.completedDate).slice(0, 10) === today).length,
    overdue: tasks.filter(task => task.status === APP_CONFIG.STATUS.OVERDUE).length,
    blocked: tasks.filter(task => task.status === APP_CONFIG.STATUS.BLOCKED).length,
    plannedQuantity: tasks.reduce((total, task) => total + task.quantityPlanned, 0),
    completedQuantity: tasks.reduce((total, task) => total + task.quantityCompleted, 0),
    remainingQuantity: tasks.reduce((total, task) => total + task.quantityRemaining, 0)
  };
}

function buildDepartmentAlertSummary_(alertsByTask) {
  const alerts = Object.keys(alertsByTask).reduce((all, taskId) => all.concat(alertsByTask[taskId]), []);
  return { red: alerts.filter(alert => alert['Alert Level'] === 'RED').length, yellow: alerts.filter(alert => alert['Alert Level'] === 'YELLOW').length, blocked: alerts.filter(alert => alert['Alert Level'] === 'BLOCKED').length };
}

function toDepartmentTaskDto_(task, order, alerts) {
  const base = toTaskDto_(task);
  const level = alerts.length ? alerts.sort((a, b) => alertWeight_(b['Alert Level']) - alertWeight_(a['Alert Level']))[0]['Alert Level'] : evaluateTaskDeadline_(task, new Date()).level;
  return Object.assign(base, {
    productName: order ? order['Product Name'] : '', customerName: order ? order['Customer Name'] : '',
    alertLevel: level, alertCount: alerts.length,
    timeLabel: base.status === APP_CONFIG.STATUS.COMPLETED ? completedTaskTimeLabel_(base) : base.delayDurationHours > 0 ? base.delayDurationHours + ' h delayed' : base.remainingTimeHours === '' ? 'No deadline' : base.remainingTimeHours + ' h remaining'
  });
}

function completedTaskTimeLabel_(task) {
  const duration = Number(task.taskDurationHours);
  return task.startDate && task.completedDate && task.taskDurationHours !== '' && Number.isFinite(duration) ? duration + ' h completed' : 'Completed';
}

function alertWeight_(level) { return ({ RED: 4, BLOCKED: 3, YELLOW: 2, GREEN: 1 })[level] || 0; }

function matchesDepartmentFilters_(task, filters) {
  if (filters.search && ![task.taskId, task.orderId, task.productName, task.taskName].join(' ').toLowerCase().includes(filters.search)) return false;
  if (filters.status !== 'ALL' && task.status !== filters.status) return false;
  if (filters.priority !== 'ALL' && task.priority !== filters.priority) return false;
  if (filters.deadline === 'OVERDUE' && task.status !== APP_CONFIG.STATUS.OVERDUE) return false;
  if (filters.deadline === 'APPROACHING' && task.alertLevel !== 'YELLOW') return false;
  if (filters.deadline === 'NO_DEADLINE' && task.deadline) return false;
  if (filters.deadline === 'DUE_TODAY' && (!task.deadline || String(task.deadline).slice(0, 10) !== Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Kolkata', 'yyyy-MM-dd'))) return false;
  return true;
}
