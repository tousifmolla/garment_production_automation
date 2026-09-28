function listTasks(filters) {
  requireAdmin_();
  return filterTasks_(getSheetData(APP_CONFIG.SHEETS.TASKS), filters).map(toTaskDto_);
}

function listMyTasks(filters) {
  const user = getCurrentUser_();
  const allTasks = getSheetData(APP_CONFIG.SHEETS.TASKS);
  const scoped = user['Role'] === APP_CONFIG.ROLES.ADMIN ? allTasks : allTasks.filter(task => String(task['Department ID']) === String(user['Department ID']));
  return filterTasks_(scoped, filters).map(toTaskDto_);
}

function getTask(taskId) {
  const task = getRecordById(APP_CONFIG.SHEETS.TASKS, taskId);
  if (!task) throw new Error('Task not found.');
  requireDepartmentAccess_(task['Department ID']);
  return toTaskDto_(task);
}

function startTask(taskId, remarks) {
  return withScriptLock_(() => changeTaskStateUnderLock_(taskId, APP_CONFIG.STATUS.IN_PROGRESS, remarks, [APP_CONFIG.STATUS.READY, APP_CONFIG.STATUS.OVERDUE], false));
}

function putTaskOnHold(taskId, remarks) {
  return withScriptLock_(() => changeTaskStateUnderLock_(taskId, APP_CONFIG.STATUS.ON_HOLD, remarks, [APP_CONFIG.STATUS.READY, APP_CONFIG.STATUS.IN_PROGRESS], false));
}

function reportTaskBlocked(taskId, remarks) {
  return withScriptLock_(() => changeTaskStateUnderLock_(taskId, APP_CONFIG.STATUS.BLOCKED, remarks, [APP_CONFIG.STATUS.READY, APP_CONFIG.STATUS.IN_PROGRESS, APP_CONFIG.STATUS.ON_HOLD], false));
}

function resumeTask(taskId, remarks) {
  return withScriptLock_(() => {
    const task = getTaskForMutation_(taskId);
    const resumeStatus = asNumber_(task['Quantity Completed']) > 0 || task['Start Date'] ? APP_CONFIG.STATUS.IN_PROGRESS : APP_CONFIG.STATUS.READY;
    return changeTaskStateUnderLock_(taskId, resumeStatus, remarks, [APP_CONFIG.STATUS.ON_HOLD, APP_CONFIG.STATUS.BLOCKED], false);
  });
}

function cancelTask(taskId, remarks) {
  return withScriptLock_(() => changeTaskStateUnderLock_(taskId, APP_CONFIG.STATUS.CANCELLED, remarks, [APP_CONFIG.STATUS.PENDING, APP_CONFIG.STATUS.READY, APP_CONFIG.STATUS.IN_PROGRESS, APP_CONFIG.STATUS.ON_HOLD, APP_CONFIG.STATUS.BLOCKED], true));
}

function updateTaskProgress(taskId, input) {
  return withScriptLock_(() => updateTaskProgressUnderLock_(taskId, input));
}

function completeTask(taskId, input) {
  return withScriptLock_(() => completeTaskUnderLock_(taskId, input));
}

/** Read-only administrator diagnostic for legacy task state/quantity inconsistencies. */
function diagnoseInconsistentCompletedTasks() {
  requireAdmin_();
  const inconsistentTasks = getSheetData(APP_CONFIG.SHEETS.TASKS).filter(task => {
    const planned = asNumber_(task['Quantity Planned']);
    const completed = asNumber_(task['Quantity Completed']);
    return planned > 0 && completed >= planned && task['Status'] !== APP_CONFIG.STATUS.COMPLETED;
  }).map(task => ({
    taskId: task['Task ID'], orderId: task['Order ID'], departmentName: task['Department Name'],
    plannedQuantity: asNumber_(task['Quantity Planned']), completedQuantity: asNumber_(task['Quantity Completed']),
    remainingQuantity: asNumber_(task['Quantity Remaining']), status: task['Status']
  }));
  const result = { success: true, inconsistentTaskCount: inconsistentTasks.length, inconsistentTasks };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Explicit, one-time recovery for the known legacy Purchase task on ORD-2026-00001.
 * It intentionally fails unless the task is still exactly the inconsistent state
 * diagnosed above, then uses the normal start and completion workflow.
 * Do not run this automatically.
 */
function recoverOrd202600001PurchaseTaskCompletion() {
  return withScriptLock_(() => {
    const actor = requireAdmin_();
    const orderId = 'ORD-2026-00001';
    const candidates = getTasksForOrder_(orderId).filter(task => task['Department Name'] === 'Purchase');
    if (candidates.length !== 1) throw new Error('Recovery stopped: expected exactly one Purchase task for ORD-2026-00001.');
    const task = candidates[0];
    const planned = asNumber_(task['Quantity Planned']);
    const completed = asNumber_(task['Quantity Completed']);
    const stages = getTasksForOrder_(orderId).sort((a, b) => asNumber_(a['Workflow Step']) - asNumber_(b['Workflow Step']));
    const nextTask = stages.find(stage => asNumber_(stage['Workflow Step']) === asNumber_(task['Workflow Step']) + 1);
    if (task['Status'] !== APP_CONFIG.STATUS.READY || planned <= 0 || completed !== planned || asNumber_(task['Quantity Remaining']) !== 0 || !nextTask || nextTask['Status'] !== APP_CONFIG.STATUS.PENDING) {
      throw new Error('Recovery stopped: ORD-2026-00001 is no longer in the expected legacy state.');
    }
    changeTaskStateUnderLock_(task['Task ID'], APP_CONFIG.STATUS.IN_PROGRESS, 'Explicit recovery of legacy completed quantity state.', [APP_CONFIG.STATUS.READY], true);
    const completion = completeTaskUnderLock_(task['Task ID'], { quantityCompleted: completed, remarks: 'Explicit recovery of legacy completed quantity state.' });
    return { success: true, orderId, recoveredTaskId: task['Task ID'], nextTaskActivated: completion.nextTaskActivated, actorRole: actor['Role'] };
  });
}

function updateTaskProgressUnderLock_(taskId, input) {
  const task = getTaskForMutation_(taskId);
  if (task['Status'] !== APP_CONFIG.STATUS.IN_PROGRESS) throw new Error('Progress can only be updated while a task is in progress.');
  const quantity = asNumber_(input && input.quantityCompleted);
  validateTaskQuantity_(task, quantity);
  const actor = getCurrentUser_();
  const updated = updateTaskRecordUnderLock_(task, {
    'Quantity Completed': quantity, 'Quantity Remaining': asNumber_(task['Quantity Planned']) - quantity,
    'Remarks': input && input.remarks !== undefined ? String(input.remarks) : task['Remarks'],
    'Updated Date': formatNow_(), 'Version': asNumber_(task['Version']) + 1
  });
  recordTaskHistoryUnderLock_(updated, actor, task['Status'], updated['Status'], asNumber_(task['Quantity Completed']), quantity, 'PROGRESS_UPDATED');
  writeWorkflowAuditUnderLock_(actor, 'UPDATE_TASK_PROGRESS', 'TASK', taskId, task, updated, updated['Remarks']);
  updateOrderProgressUnderLock_(task['Order ID'], actor);
  return toTaskDto_(updated);
}

function completeTaskUnderLock_(taskId, input) {
  const task = getTaskForMutation_(taskId);
  const isStartedOverdueTask = task['Status'] === APP_CONFIG.STATUS.OVERDUE && !!task['Start Date'];
  if (task['Status'] !== APP_CONFIG.STATUS.IN_PROGRESS && !isStartedOverdueTask) throw new Error('Only an in-progress or started overdue task can be completed.');
  const actor = getCurrentUser_();
  const quantity = asNumber_(input && input.quantityCompleted);
  validateTaskQuantity_(task, quantity);
  const partialEnabled = getSettingValue_('PARTIAL_COMPLETION_ALLOWED', 'FALSE') === 'TRUE';
  if (!partialEnabled && quantity !== asNumber_(task['Quantity Planned'])) throw new Error('Full planned quantity is required before completing this task.');
  if (quantity <= 0) throw new Error('Completed quantity must be greater than zero.');
  const timestamp = formatNow_();
  const updated = updateTaskRecordUnderLock_(task, {
    'Quantity Completed': quantity, 'Quantity Remaining': 0, 'Completed Date': timestamp,
    'Status': APP_CONFIG.STATUS.COMPLETED, 'Overdue Flag': false,
    'Task Duration Hours': calculateDurationHours_(task['Start Date'], timestamp),
    'Delay Duration Hours': calculateDelayHours_(task['Deadline'], timestamp),
    'Remarks': input && input.remarks !== undefined ? String(input.remarks) : task['Remarks'],
    'Updated Date': timestamp, 'Version': asNumber_(task['Version']) + 1
  });
  recordTaskHistoryUnderLock_(updated, actor, task['Status'], APP_CONFIG.STATUS.COMPLETED, asNumber_(task['Quantity Completed']), quantity, 'TASK_COMPLETED');
  writeWorkflowAuditUnderLock_(actor, 'COMPLETE_TASK', 'TASK', taskId, task, updated, updated['Remarks']);
  notifyWorkflowEventUnderLock_('TASK_COMPLETED', updated, actor, { severity: 'GREEN', subject: 'Task completed', message: updated['Department Name'] + ' completed task ' + updated['Task ID'] + '.' });
  const nextTask = activateNextTaskUnderLock_(updated, actor);
  const order = updateOrderProgressUnderLock_(task['Order ID'], actor);
  return { task: toTaskDto_(updated), order: toOrderDto_(order), nextTaskActivated: Boolean(nextTask) };
}

function refreshOverdueTasks() {
  return withScriptLock_(() => {
    const actor = requireAdmin_();
    const now = new Date();
    const changed = getSheetData(APP_CONFIG.SHEETS.TASKS).filter(task => {
      const deadline = new Date(task['Deadline']);
      return task['Deadline'] && deadline < now && ![APP_CONFIG.STATUS.COMPLETED, APP_CONFIG.STATUS.CANCELLED, APP_CONFIG.STATUS.OVERDUE].includes(task['Status']);
    }).map(task => {
      const updated = updateTaskRecordUnderLock_(task, { 'Status': APP_CONFIG.STATUS.OVERDUE, 'Overdue Flag': true, 'Remaining Time Hours': calculateRemainingHours_(task['Deadline']), 'Updated Date': formatNow_(), 'Version': asNumber_(task['Version']) + 1 });
      recordTaskHistoryUnderLock_(updated, actor, task['Status'], APP_CONFIG.STATUS.OVERDUE, asNumber_(task['Quantity Completed']), asNumber_(task['Quantity Completed']), 'TASK_OVERDUE');
      return updated['Task ID'];
    });
    return { updatedTaskIds: changed };
  });
}

function changeTaskStateUnderLock_(taskId, nextStatus, remarks, allowedStates, adminOnly) {
  const task = getRecordById(APP_CONFIG.SHEETS.TASKS, taskId);
  if (!task) throw new Error('Task not found.');
  const actor = adminOnly ? requireAdmin_() : requireDepartmentAccess_(task['Department ID']);
  if (!allowedStates.includes(task['Status'])) throw new Error('This task cannot transition from ' + task['Status'] + ' to ' + nextStatus + '.');
  const timestamp = formatNow_();
  const changes = { 'Status': nextStatus, 'Remarks': remarks === undefined ? task['Remarks'] : String(remarks), 'Updated Date': timestamp, 'Version': asNumber_(task['Version']) + 1 };
  if (nextStatus === APP_CONFIG.STATUS.IN_PROGRESS && !task['Start Date']) changes['Start Date'] = timestamp;
  const updated = updateTaskRecordUnderLock_(task, changes);
  recordTaskHistoryUnderLock_(updated, actor, task['Status'], nextStatus, asNumber_(task['Quantity Completed']), asNumber_(task['Quantity Completed']), 'STATUS_CHANGED');
  writeWorkflowAuditUnderLock_(actor, 'CHANGE_TASK_STATUS', 'TASK', taskId, task, updated, changes['Remarks']);
  if (nextStatus === APP_CONFIG.STATUS.IN_PROGRESS) notifyWorkflowEventUnderLock_('TASK_STARTED', updated, actor, { severity: 'GREEN', subject: 'Task started', message: updated['Department Name'] + ' started task ' + updated['Task ID'] + '.' });
  if (nextStatus === APP_CONFIG.STATUS.BLOCKED) notifyWorkflowEventUnderLock_('TASK_BLOCKED', updated, actor, { severity: 'BLOCKED', subject: 'Task blocked', message: updated['Department Name'] + ' blocked task ' + updated['Task ID'] + '.' });
  updateOrderProgressUnderLock_(task['Order ID'], actor);
  return toTaskDto_(updated);
}

function getTaskForMutation_(taskId) {
  const task = getRecordById(APP_CONFIG.SHEETS.TASKS, taskId);
  if (!task) throw new Error('Task not found.');
  requireDepartmentAccess_(task['Department ID']);
  return task;
}

function updateTaskRecordUnderLock_(task, changes) {
  assertTaskStateQuantityInvariant_(task, changes);
  return updateRecord(APP_CONFIG.SHEETS.TASKS, task['Task ID'], changes);
}

function assertTaskStateQuantityInvariant_(task, changes) {
  const status = changes['Status'] === undefined ? task['Status'] : changes['Status'];
  const planned = asNumber_(changes['Quantity Planned'] === undefined ? task['Quantity Planned'] : changes['Quantity Planned']);
  const completed = asNumber_(changes['Quantity Completed'] === undefined ? task['Quantity Completed'] : changes['Quantity Completed']);
  const remaining = asNumber_(changes['Quantity Remaining'] === undefined ? task['Quantity Remaining'] : changes['Quantity Remaining']);
  if (planned < 0 || completed < 0 || completed > planned) throw new Error('Task quantity state is invalid.');
  if (status === APP_CONFIG.STATUS.READY && completed !== 0) throw new Error('READY tasks must have zero completed quantity. Start the task before recording progress.');
  if (status === APP_CONFIG.STATUS.COMPLETED && remaining !== 0) throw new Error('COMPLETED tasks must have zero remaining quantity.');
}

function recordTaskHistoryUnderLock_(task, actor, previousStatus, newStatus, previousQuantity, newQuantity, eventType) {
  insertRecord(APP_CONFIG.SHEETS.TASK_HISTORY, {
    'History ID': generateIdUnderLock_(APP_CONFIG.ID_PREFIXES.HISTORY), 'Task ID': task['Task ID'], 'Order ID': task['Order ID'],
    'Timestamp': formatNow_(), 'Actor Email': actor['Email'], 'Actor Role': actor['Role'],
    'Previous Status': previousStatus, 'New Status': newStatus, 'Previous Quantity Completed': previousQuantity,
    'New Quantity Completed': newQuantity, 'Remarks': task['Remarks'] || '', 'Event Type': eventType
  });
}

function validateTaskQuantity_(task, quantity) {
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > asNumber_(task['Quantity Planned'])) throw new Error('Completed quantity must be between zero and planned quantity.');
}

function calculateDurationHours_(start, end) {
  if (!start || !end) return '';
  const duration = (new Date(end).getTime() - new Date(start).getTime()) / 3600000;
  return Number.isFinite(duration) ? Math.round(duration * 100) / 100 : '';
}

function calculateDelayHours_(deadline, completed) {
  if (!deadline || !completed) return 0;
  const delay = (new Date(completed).getTime() - new Date(deadline).getTime()) / 3600000;
  return Number.isFinite(delay) ? Math.max(0, Math.round(delay * 100) / 100) : 0;
}

function getTasksForOrder_(orderId) {
  return getSheetData(APP_CONFIG.SHEETS.TASKS).filter(task => String(task['Order ID']) === String(orderId));
}

function filterTasks_(tasks, filters) {
  return tasks.filter(task => Object.keys(filters || {}).every(key => !filters[key] || String(task[taskFilterField_(key)] || '').toUpperCase() === String(filters[key]).toUpperCase()));
}

function taskFilterField_(key) {
  return { orderId: 'Order ID', departmentId: 'Department ID', status: 'Status', priority: 'Priority', assignedUser: 'Assigned User Email' }[key] || key;
}

function toTaskDto_(task) {
  const planned = asNumber_(task['Quantity Planned']);
  const completed = asNumber_(task['Quantity Completed']);
  const isCompleted = task['Status'] === APP_CONFIG.STATUS.COMPLETED;
  return {
    taskId: task['Task ID'], orderId: task['Order ID'], workflowStep: asNumber_(task['Workflow Step']),
    departmentId: task['Department ID'], departmentName: task['Department Name'], taskName: task['Task Name'],
    assignedUserEmail: task['Assigned User Email'], quantityPlanned: planned, quantityCompleted: completed,
    quantityRemaining: task['Quantity Remaining'] === '' ? planned - completed : asNumber_(task['Quantity Remaining']),
    unit: task['Unit'], assignedDate: toClientValue_(task['Assigned Date']), startDate: toClientValue_(task['Start Date']), deadline: toClientValue_(task['Deadline']),
    completedDate: toClientValue_(task['Completed Date']), status: task['Status'], priority: task['Priority'], overdue: isTrue_(task['Overdue Flag']),
    remainingTimeHours: isCompleted ? '' : calculateRemainingHours_(task['Deadline']), taskDurationHours: task['Task Duration Hours'],
    delayDurationHours: task['Delay Duration Hours'], remarks: task['Remarks'], version: asNumber_(task['Version'])
  };
}
