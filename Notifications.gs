/** Creates deduplicated dashboard records and optional queued email records. */
function createNotification(input) {
  return withScriptLock_(() => { requireAdmin_(); return createNotificationUnderLock_(input); });
}

function createNotificationUnderLock_(input) {
  validateNotificationInput_(input);
  if (getSettingValue_('NOTIFICATIONS_ENABLED', 'TRUE') !== 'TRUE') return [];
  const recipients = input.recipientEmails ? input.recipientEmails.filter(isValidNotificationEmail_) : resolveNotificationRecipients_(input.departmentId, input.includeAdmins !== false);
  const created = [];
  recipients.forEach(email => {
    const dashboard = createNotificationRecordUnderLock_(input, email, 'DASHBOARD', 'UNREAD');
    if (dashboard) created.push(dashboard);
    if (getSettingValue_('EMAIL_NOTIFICATIONS_ENABLED', 'TRUE') === 'TRUE') {
      const emailRecord = createNotificationRecordUnderLock_(input, email, 'EMAIL', 'PENDING');
      if (emailRecord) created.push(emailRecord);
    }
  });
  return created;
}

function createNotificationRecordUnderLock_(input, recipientEmail, channel, status) {
  const normalizedEmail = String(recipientEmail || '').trim().toLowerCase();
  if (!isValidNotificationEmail_(normalizedEmail)) return null;
  const key = String(input.deduplicationKey || [input.eventType, input.taskId || '', input.orderId || ''].join('|')) + '|' + channel + '|' + normalizedEmail;
  const existing = getSheetData(APP_CONFIG.SHEETS.NOTIFICATIONS).find(record => record['Deduplication Key'] === key);
  if (existing) return null;
  const timestamp = formatNow_();
  const record = {
    'Notification ID': generateIdUnderLock_(APP_CONFIG.ID_PREFIXES.NOTIFICATIONS), 'Recipient Email': normalizedEmail,
    'Department ID': input.departmentId || '', 'Order ID': input.orderId || '', 'Task ID': input.taskId || '',
    'Event Type': input.eventType, 'Channel': channel, 'Subject': input.subject, 'Message': input.message,
    'Status': status, 'Sent Date': '', 'Created Date': timestamp, 'Deduplication Key': key,
    'Severity': input.severity || 'GREEN', 'Read At': '', 'Acknowledged At': '', 'Acknowledged By': '', 'Updated Date': timestamp
  };
  insertRecord(APP_CONFIG.SHEETS.NOTIFICATIONS, record);
  return record;
}

function resolveNotificationRecipients_(departmentId, includeAdmins) {
  return getSheetData(APP_CONFIG.SHEETS.USERS).filter(user => isTrue_(user['Active']) && isValidNotificationEmail_(user['Email']) && ((departmentId && String(user['Department ID']) === String(departmentId)) || (includeAdmins && user['Role'] === APP_CONFIG.ROLES.ADMIN))).map(user => String(user['Email']).trim().toLowerCase());
}

function getUserNotifications(filters) {
  const user = getCurrentUser_();
  return filterNotifications_(getSheetData(APP_CONFIG.SHEETS.NOTIFICATIONS).filter(record => String(record['Recipient Email']).toLowerCase() === String(user['Email']).toLowerCase() && record['Channel'] === 'DASHBOARD'), filters).map(toNotificationDto_);
}

function listNotifications(filters) {
  requireAdmin_();
  return filterNotifications_(getSheetData(APP_CONFIG.SHEETS.NOTIFICATIONS), filters).map(toNotificationDto_);
}

function markNotificationRead(notificationId) { return withScriptLock_(() => updateNotificationStateUnderLock_(notificationId, 'READ')); }
function acknowledgeNotification(notificationId) { return withScriptLock_(() => updateNotificationStateUnderLock_(notificationId, 'ACKNOWLEDGED')); }

function updateNotificationStateUnderLock_(notificationId, status) {
  const user = getCurrentUser_();
  const record = getRecordById(APP_CONFIG.SHEETS.NOTIFICATIONS, notificationId);
  if (!record) throw new Error('Notification not found.');
  if (user['Role'] !== APP_CONFIG.ROLES.ADMIN && String(record['Recipient Email']).toLowerCase() !== String(user['Email']).toLowerCase()) throw new Error('Access denied. You can only update your own notifications.');
  const changes = { 'Status': status, 'Updated Date': formatNow_() };
  if (status === 'READ') changes['Read At'] = formatNow_();
  if (status === 'ACKNOWLEDGED') { changes['Acknowledged At'] = formatNow_(); changes['Acknowledged By'] = user['Email']; }
  return toNotificationDto_(updateRecord(APP_CONFIG.SHEETS.NOTIFICATIONS, notificationId, changes));
}

function processPendingNotifications() {
  return withScriptLock_(() => {
    requireAdmin_();
    return getSheetData(APP_CONFIG.SHEETS.NOTIFICATIONS)
      .filter(record => record['Channel'] === 'EMAIL' && record['Status'] === 'PENDING')
      .map(record => sendEmailNotification(record['Notification ID']));
  });
}

/** Never throws delivery errors so workflow transitions remain consistent. */
function sendEmailNotification(notificationId) {
  requireAdmin_();
  const record = getRecordById(APP_CONFIG.SHEETS.NOTIFICATIONS, notificationId);
  if (!record || record['Channel'] !== 'EMAIL') return { success: false, message: 'Email notification not found.' };
  if (getSettingValue_('EMAIL_NOTIFICATIONS_ENABLED', 'TRUE') !== 'TRUE') return { success: false, disabled: true };
  if (!isValidNotificationEmail_(record['Recipient Email'])) return updateNotificationDelivery_(record, 'SKIPPED', 'Invalid recipient email.');
  try {
    MailApp.sendEmail({ to: record['Recipient Email'], subject: record['Subject'], htmlBody: escapeEmailHtml_(record['Message']), body: record['Message'] });
    return updateNotificationDelivery_(record, 'SENT', '');
  } catch (error) {
    return updateNotificationDelivery_(record, 'FAILED', 'Email delivery failed.');
  }
}

function updateNotificationDelivery_(record, status, message) {
  updateRecord(APP_CONFIG.SHEETS.NOTIFICATIONS, record['Notification ID'], { 'Status': status, 'Sent Date': status === 'SENT' ? formatNow_() : '', 'Updated Date': formatNow_() });
  return { success: status === 'SENT', status, message };
}

function validateNotificationInput_(input) {
  if (!input || !String(input.eventType || '').trim() || !String(input.subject || '').trim() || !String(input.message || '').trim()) throw new Error('Notification event, subject, and message are required.');
}
function isValidNotificationEmail_(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim()); }
function escapeEmailHtml_(text) { return String(text).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character])); }
function filterNotifications_(records, filters) { return records.filter(record => Object.keys(filters || {}).every(key => !filters[key] || String(record[notificationFilterField_(key)] || '').toUpperCase() === String(filters[key]).toUpperCase())); }
function notificationFilterField_(key) { return { unread: 'Status', eventType: 'Event Type', severity: 'Severity', orderId: 'Order ID', taskId: 'Task ID' }[key] || key; }
function toNotificationDto_(record) { return { notificationId: record['Notification ID'], recipientEmail: record['Recipient Email'], departmentId: record['Department ID'], orderId: record['Order ID'], taskId: record['Task ID'], eventType: record['Event Type'], channel: record['Channel'], subject: record['Subject'], message: record['Message'], status: record['Status'], severity: record['Severity'], createdAt: toClientValue_(record['Created Date']), readAt: toClientValue_(record['Read At']), acknowledgedAt: toClientValue_(record['Acknowledged At']) }; }

function notifyWorkflowEventUnderLock_(eventType, task, actor, options) {
  const config = options || {};
  const order = getRecordById(APP_CONFIG.SHEETS.PRODUCTION_ORDERS, task['Order ID']);
  return createNotificationUnderLock_({ eventType, taskId: task['Task ID'], orderId: task['Order ID'], departmentId: task['Department ID'], includeAdmins: config.includeAdmins !== false, severity: config.severity || 'GREEN', subject: config.subject || eventType.replace(/_/g, ' '), message: config.message || eventType.replace(/_/g, ' ') + ': ' + task['Task Name'] + ' for ' + task['Order ID'] + '.', deduplicationKey: eventType + '|' + task['Task ID'] + '|' + (task['Version'] || '') + '|' + (order ? order['Overall Status'] : '') });
}
