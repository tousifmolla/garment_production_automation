/** Read-only operational report API. Administrators see all data. */
function getOperationalReports(filters) {
  requireAdmin_();
  return buildReports_(filters || {});
}

/** Department users may retrieve only their own department's report rows. */
function getMyDepartmentReport(filters) {
  const user = getCurrentUser_();
  if (user['Role'] !== APP_CONFIG.ROLES.DEPARTMENT_USER) throw new Error('Department report access requires a department-user role.');
  const report = buildReports_(filters || {});
  report.departmentPerformance = report.departmentPerformance.filter(row => row.departmentId === user['Department ID']);
  report.tasks = report.tasks.filter(row => row.departmentId === user['Department ID']);
  report.orderCycleTime = report.orderCycleTime.filter(row => row.departmentId === user['Department ID']);
  report.dailyProduction = report.dailyProduction.filter(row => row.departmentId === user['Department ID']);
  return report;
}

/** Builds reproducible reporting datasets entirely from transactional sheets. */
function buildReports_(filters) {
  const orders = getSheetData(APP_CONFIG.SHEETS.PRODUCTION_ORDERS);
  const tasks = getSheetData(APP_CONFIG.SHEETS.TASKS);
  const departments = getSheetData(APP_CONFIG.SHEETS.DEPARTMENTS);
  const productNamesById = getActiveReportingMasterNames_(getSheetData(APP_CONFIG.SHEETS.PRODUCTS), 'Product ID', 'Product Name');
  const customerNamesById = getActiveReportingMasterNames_(getSheetData(APP_CONFIG.SHEETS.CUSTOMERS), 'Customer ID', 'Customer Name');
  const tasksByOrder = {};
  tasks.forEach(task => (tasksByOrder[task['Order ID']] || (tasksByOrder[task['Order ID']] = [])).push(task));

  const production = orders.map(order => {
    const orderTasks = tasksByOrder[order['Order ID']] || [];
    const orderedTasks = orderTasks.slice().sort((left, right) => Number(left['Workflow Step']) - Number(right['Workflow Step']));
    const active = orderedTasks.find(task => ![APP_CONFIG.STATUS.PENDING, APP_CONFIG.STATUS.COMPLETED, APP_CONFIG.STATUS.CANCELLED].includes(task['Status'])) || orderedTasks[orderedTasks.length - 1] || {};
    const finalTask = orderedTasks[orderedTasks.length - 1] || {};
    const completedDate = order['Overall Status'] === APP_CONFIG.STATUS.COMPLETED ? finalTask['Completed Date'] || '' : '';
    const deliveryTime = order['Required Delivery Date'] ? new Date(order['Required Delivery Date']) : null;
    const completionTime = completedDate ? new Date(completedDate) : null;
    const delayHours = deliveryTime && completionTime && !Number.isNaN(deliveryTime.getTime()) && !Number.isNaN(completionTime.getTime()) ? Math.max(0, Math.round((completionTime.getTime() - deliveryTime.getTime()) / 3600000 * 100) / 100) : 0;
    const quantity = Number(order['Quantity']) || 0;
    const completedQuantity = Number(order['Completed Quantity']) || 0;
    return {
      orderId: order['Order ID'], productId: order['Product ID'], productName: productNamesById[String(order['Product ID'])] || '',
      customerId: order['Customer ID'], customerName: customerNamesById[String(order['Customer ID'])] || '',
      currentDepartmentId: active['Department ID'] || '', orderQuantity: quantity, completedQuantity,
      remainingQuantity: Math.max(0, quantity - completedQuantity),
      progressPercent: orderedTasks.length ? Math.round(orderedTasks.filter(task => task['Status'] === APP_CONFIG.STATUS.COMPLETED).length / orderedTasks.length * 100) : 0,
      status: order['Overall Status'], orderStatus: order['Overall Status'], priority: order['Priority'], orderDate: order['Order Date'],
      requiredDeliveryDate: order['Required Delivery Date'], completionDate: completedDate,
      onTime: completedDate ? delayHours === 0 : '', delayHours
    };
  });

  const taskRows = tasks.map(task => ({
    taskId: task['Task ID'], orderId: task['Order ID'], departmentId: task['Department ID'],
    assignedUserEmail: task['Assigned User Email'], quantityPlanned: Number(task['Quantity Planned']) || 0,
    quantityCompleted: Number(task['Quantity Completed']) || 0, quantityRemaining: Number(task['Quantity Remaining']) || 0,
    status: task['Status'], deadline: task['Deadline'], completedDate: task['Completed Date'],
    taskDurationHours: reportTaskDurationHours_(task), delayHours: Number(task['Delay Duration Hours']) || 0
  }));

  const departmentPerformance = departments.map(department => {
    const rows = taskRows.filter(task => task.departmentId === department['Department ID']);
    const completed = rows.filter(task => task.status === APP_CONFIG.STATUS.COMPLETED);
    return {
      departmentId: department['Department ID'], departmentName: department['Department Name'], totalTasks: rows.length,
      completedTasks: completed.length, pendingTasks: rows.filter(task => [APP_CONFIG.STATUS.PENDING, APP_CONFIG.STATUS.READY].includes(task.status)).length,
      inProgressTasks: rows.filter(task => task.status === APP_CONFIG.STATUS.IN_PROGRESS).length,
      overdueTasks: rows.filter(task => task.status === APP_CONFIG.STATUS.OVERDUE).length,
      blockedTasks: rows.filter(task => task.status === APP_CONFIG.STATUS.BLOCKED).length,
      plannedQuantity: rows.reduce((sum, task) => sum + task.quantityPlanned, 0),
      completedQuantity: rows.reduce((sum, task) => sum + task.quantityCompleted, 0),
      onTimePercent: completed.length ? completed.filter(task => !task.delayHours).length / completed.length * 100 : 0,
      overduePercent: rows.length ? rows.filter(task => task.status === APP_CONFIG.STATUS.OVERDUE).length / rows.length * 100 : 0,
      averageDurationHours: completed.length ? completed.reduce((sum, task) => sum + task.taskDurationHours, 0) / completed.length : 0,
      averageDelayHours: completed.length ? completed.reduce((sum, task) => sum + task.delayHours, 0) / completed.length : 0,
      throughput: completed.reduce((sum, task) => sum + task.quantityCompleted, 0)
    };
  });

  const orderCycleTime = Object.keys(tasksByOrder).flatMap(orderId => {
    const orderTasks = tasksByOrder[orderId];
    const durations = orderTasks.map(reportTaskDurationHours_);
    const totalCycleHours = Math.round(durations.reduce((sum, duration) => sum + duration, 0) * 100) / 100;
    const bottleneck = Math.max.apply(null, durations.concat([0]));
    return orderTasks.map((task, index) => ({ orderId, departmentId: task['Department ID'], stageDurationHours: durations[index], totalCycleHours, bottleneck: durations[index] === bottleneck && bottleneck > 0 }));
  });

  const completedOrders = production.filter(row => row.status === APP_CONFIG.STATUS.COMPLETED);
  const activeOrders = production.filter(row => ![APP_CONFIG.STATUS.COMPLETED, APP_CONFIG.STATUS.CANCELLED].includes(row.status));
  const onTimeOrders = completedOrders.filter(row => row.onTime === true);
  const lateOrders = completedOrders.filter(row => row.onTime === false);
  const deliveryRows = [
    ['Total Orders', production.length], ['Active Orders', activeOrders.length], ['Completed Orders', completedOrders.length],
    ['Completed Production Quantity', completedOrders.reduce((sum, row) => sum + row.completedQuantity, 0)],
    ['Active / WIP Quantity', activeOrders.reduce((sum, row) => sum + row.remainingQuantity, 0)],
    ['On-Time Orders', onTimeOrders.length],
    ['Late Orders', lateOrders.length], ['On-Time Delivery Percent', completedOrders.length ? onTimeOrders.length / completedOrders.length * 100 : 0],
    ['Average Delivery Delay Hours', lateOrders.length ? lateOrders.reduce((sum, row) => sum + row.delayHours, 0) / lateOrders.length : 0],
    ['Orders At Risk', production.filter(row => row.status !== APP_CONFIG.STATUS.COMPLETED && row.requiredDeliveryDate && new Date(row.requiredDeliveryDate) < new Date()).length]
  ].map(([metric, metricValue]) => ({ metric, metricValue, snapshotDate: new Date() }));

  const dailyMap = {};
  tasks.forEach(task => {
    const date = reportDate_(task['Completed Date'] || task['Assigned Date']);
    if (!date) return;
    const key = date + '|' + task['Department ID'];
    const row = dailyMap[key] || (dailyMap[key] = { date, departmentId: task['Department ID'], orders: {}, tasksCompleted: 0, quantityPlanned: 0, quantityCompleted: 0, overdueTasks: 0, blockedTasks: 0, durationTotal: 0, durationCount: 0 });
    if (![APP_CONFIG.STATUS.COMPLETED, APP_CONFIG.STATUS.CANCELLED].includes(task['Status'])) row.orders[task['Order ID']] = true;
    row.tasksCompleted += task['Status'] === APP_CONFIG.STATUS.COMPLETED ? 1 : 0;
    row.quantityPlanned += Number(task['Quantity Planned']) || 0;
    row.quantityCompleted += Number(task['Quantity Completed']) || 0;
    row.overdueTasks += task['Status'] === APP_CONFIG.STATUS.OVERDUE ? 1 : 0;
    row.blockedTasks += task['Status'] === APP_CONFIG.STATUS.BLOCKED ? 1 : 0;
    if (task['Status'] === APP_CONFIG.STATUS.COMPLETED) { row.durationTotal += reportTaskDurationHours_(task); row.durationCount += 1; }
  });
  const dailyProduction = Object.keys(dailyMap).map(key => {
    const row = dailyMap[key];
    return { date: row.date, departmentId: row.departmentId, ordersActive: Object.keys(row.orders).length, tasksCompleted: row.tasksCompleted, quantityPlanned: row.quantityPlanned, quantityCompleted: row.quantityCompleted, overdueTasks: row.overdueTasks, blockedTasks: row.blockedTasks, averageCompletionTimeHours: row.durationCount ? row.durationTotal / row.durationCount : 0 };
  });

  return { production, tasks: taskRows, departmentPerformance, orderCycleTime, deliveryRows, dailyProduction };
}

/** Active master names are report labels only; IDs remain the reporting keys. */
function getActiveReportingMasterNames_(records, idField, nameField) {
  return records.reduce((names, record) => {
    const id = String(record[idField] || '').trim();
    if (id && isTrue_(record.Active)) names[id] = String(record[nameField] || '').trim();
    return names;
  }, {});
}

/** Admin-only derived-sheet refresh. Source production records remain unchanged. */
function rebuildReportingData() {
  const report = getOperationalReports({});
  const sheets = [
    [APP_CONFIG.SHEETS.REPORT_PRODUCTION, report.production], [APP_CONFIG.SHEETS.REPORT_TASKS, report.tasks],
    [APP_CONFIG.SHEETS.REPORT_DEPARTMENT, report.departmentPerformance], [APP_CONFIG.SHEETS.REPORT_CYCLE, report.orderCycleTime],
    [APP_CONFIG.SHEETS.REPORT_DELIVERY, report.deliveryRows], [APP_CONFIG.SHEETS.REPORT_DAILY, report.dailyProduction]
  ];
  const spreadsheet = getSpreadsheet_();
  sheets.forEach(([sheetName, rows]) => {
    const headers = getSheetSchemas_()[sheetName];
    const sheet = ensureSheet_(spreadsheet, sheetName, headers);
    if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).clearContent();
    if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows.map(row => headers.map(header => row[reportKey_(header)] === undefined ? '' : row[reportKey_(header)])));
  });
  return { success: true, refreshedSheets: sheets.map(([sheetName]) => sheetName) };
}

/**
 * Admin-only, read-only acceptance check for the derived reporting tabs.
 * It intentionally never refreshes reports or writes to any spreadsheet tab.
 */
function validateReportingCertification() {
  requireAdmin_();
  const checks = [];
  const errors = [];
  const check = (name, passed, message) => {
    checks.push({ name, passed: Boolean(passed), message });
    if (!passed) errors.push(message);
  };
  const reportProduction = getSheetData(APP_CONFIG.SHEETS.REPORT_PRODUCTION);
  const reportTasks = getSheetData(APP_CONFIG.SHEETS.REPORT_TASKS);
  const reportDepartments = getSheetData(APP_CONFIG.SHEETS.REPORT_DEPARTMENT);
  const reportCycle = getSheetData(APP_CONFIG.SHEETS.REPORT_CYCLE);
  const reportDelivery = getSheetData(APP_CONFIG.SHEETS.REPORT_DELIVERY);
  const reportDaily = getSheetData(APP_CONFIG.SHEETS.REPORT_DAILY);
  const activeDepartmentIds = getSheetData(APP_CONFIG.SHEETS.DEPARTMENTS)
    .filter(row => String(row.Active).toUpperCase() !== 'FALSE')
    .map(row => String(row['Department ID'] || '').trim())
    .filter(Boolean);
  const orderOne = reportProduction.find(row => row['Order ID'] === 'ORD-2026-00001');
  const orderTwo = reportProduction.find(row => row['Order ID'] === 'ORD-2026-00002');
  const taskIds = reportTasks.map(row => String(row['Task ID'] || '').trim());
  const metrics = {};
  reportDelivery.forEach(row => { metrics[String(row.Metric || '').trim()] = Number(row['Metric Value']); });
  const numeric = value => Number.isFinite(Number(value));
  const validDate = value => value !== '' && value !== null && value !== undefined && !Number.isNaN(new Date(value).getTime());
  const latestDailyDate = reportDaily.map(row => String(row.Date || '')).filter(Boolean).sort().pop() || '';
  const latestDailyRows = reportDaily.filter(row => String(row.Date || '') === latestDailyDate);

  check('report_production_row_count', reportProduction.length === 2, 'ReportProduction must contain exactly two order rows.');
  check('report_production_ord_00002', Boolean(orderTwo) && orderTwo['Order Status'] === APP_CONFIG.STATUS.COMPLETED && Number(orderTwo['Order Quantity']) === 10 && Number(orderTwo['Completed Quantity']) === 10 && Number(orderTwo['Remaining Quantity']) === 0, 'ORD-2026-00002 must be completed with quantity 10, completed quantity 10, and remaining quantity 0.');
  check('report_production_ord_00001', Boolean(orderOne) && orderOne['Order Status'] === APP_CONFIG.STATUS.IN_PROGRESS && Number(orderOne['Order Quantity']) === 10, 'ORD-2026-00001 must remain in progress with quantity 10.');
  check('report_production_keys', reportProduction.every(row => String(row['Order ID'] || '').trim()), 'ReportProduction contains a blank Order ID.');
  check('report_production_display_fields', reportProduction.every(row => Object.prototype.hasOwnProperty.call(row, 'Product Name') && Object.prototype.hasOwnProperty.call(row, 'Customer Name')), 'ReportProduction must include Product Name and Customer Name display fields.');
  check('report_tasks_counts', reportTasks.length === 12 && reportTasks.filter(row => row['Order ID'] === 'ORD-2026-00001').length === 6 && reportTasks.filter(row => row['Order ID'] === 'ORD-2026-00002').length === 6, 'ReportTasks must contain six rows for each order.');
  check('report_tasks_completed', reportTasks.filter(row => row['Order ID'] === 'ORD-2026-00002').every(row => row.Status === APP_CONFIG.STATUS.COMPLETED), 'All ORD-2026-00002 report tasks must be completed.');
  check('report_tasks_keys', taskIds.every(Boolean) && new Set(taskIds).size === taskIds.length && reportTasks.every(row => String(row['Department ID'] || '').trim()), 'ReportTasks contains blank or duplicate task/department keys.');
  check('department_performance', reportDepartments.length === 6 && reportDepartments.every(row => String(row['Department ID'] || '').trim()) && new Set(reportDepartments.map(row => row['Department ID'])).size === 6, 'ReportDepartmentPerformance must contain six unique populated department IDs.');
  const purchase = reportDepartments.find(row => row['Department ID'] === 'DEPT-001');
  const downstream = reportDepartments.filter(row => row['Department ID'] !== 'DEPT-001');
  check('department_stage_aggregation', Boolean(purchase) && Number(purchase['Completed Tasks']) === 2 && downstream.length === 5 && downstream.every(row => Number(row['Completed Tasks']) === 1 && Number(row['Pending Tasks']) === 1 && Number(row['Planned Quantity']) === 20 && Number(row['Completed Quantity']) === 10), 'Department metrics must remain stage-scoped without final-production double counting.');
  check('cycle_time_rows', reportCycle.filter(row => row['Order ID'] === 'ORD-2026-00001').length === 6 && reportCycle.filter(row => row['Order ID'] === 'ORD-2026-00002').length === 6 && reportCycle.every(row => String(row['Department ID'] || '').trim() && numeric(row['Stage Duration Hours']) && Number(row['Stage Duration Hours']) >= 0 && numeric(row['Total Cycle Hours']) && Number(row['Total Cycle Hours']) >= 0), 'ReportOrderCycleTime requires six valid non-negative stage rows per order.');
  check('delivery_metrics', metrics['Total Orders'] === 2 && metrics['Completed Orders'] === 1 && metrics['Active Orders'] === 1 && metrics['Completed Production Quantity'] === 10, 'ReportDelivery aggregate metrics do not match the two-order acceptance state.');
  check('daily_production_keys', latestDailyRows.length === 6 && latestDailyRows.every(row => String(row['Department ID'] || '').trim()) && new Set(latestDailyRows.map(row => row.Date + '|' + row['Department ID'])).size === 6 && activeDepartmentIds.every(id => latestDailyRows.some(row => row['Department ID'] === id)), 'ReportDailyProduction must contain one populated row for each active department on the latest report date.');
  check('daily_stage_aggregation', Boolean(latestDailyRows.find(row => row['Department ID'] === 'DEPT-001' && Number(row['Tasks Completed']) === 2 && Number(row['Quantity Completed']) === 20)) && latestDailyRows.filter(row => row['Department ID'] !== 'DEPT-001').every(row => Number(row['Tasks Completed']) === 1 && Number(row['Quantity Completed']) === 10), 'ReportDailyProduction stage quantities do not match the acceptance workflow.');
  check('report_value_types', reportProduction.every(row => numeric(row['Order Quantity']) && numeric(row['Completed Quantity']) && numeric(row['Remaining Quantity'])) && reportTasks.every(row => numeric(row['Quantity Planned']) && numeric(row['Quantity Completed']) && numeric(row['Quantity Remaining'])) && reportDaily.every(row => validDate(row.Date) && numeric(row['Quantity Planned']) && numeric(row['Quantity Completed'])), 'Reporting tabs contain invalid date or numeric values.');
  const result = { success: errors.length === 0, passed: checks.filter(row => row.passed).length, failed: errors.length, latestDailyDate, checks, errors };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function reportTaskDurationHours_(task) {
  const stored = Number(task['Task Duration Hours']);
  if (Number.isFinite(stored) && stored >= 0) return stored;
  const start = task['Start Date'] ? new Date(task['Start Date']) : null;
  const end = task['Completed Date'] ? new Date(task['Completed Date']) : null;
  return start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 3600000 * 100) / 100) : 0;
}

function reportDate_(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : Utilities.formatDate(date, Session.getScriptTimeZone() || 'Asia/Kolkata', 'yyyy-MM-dd');
}

function reportKey_(header) {
  const words = String(header || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words.length ? words[0] + words.slice(1).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('') : '';
}
