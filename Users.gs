function listUsers() {
  requireAdmin_();
  return getSheetData(APP_CONFIG.SHEETS.USERS).map(toUserDto_);
}

function createUser(input) {
  return withScriptLock_(() => createUserUnderLock_(input));
}

function createUserUnderLock_(input) {
  const actor = requireAdmin_();
  validateUserInput_(input);
  const email = String(input.email).trim().toLowerCase();
  if (getSheetData(APP_CONFIG.SHEETS.USERS).some(user => String(user['Email']).trim().toLowerCase() === email)) {
    throw new Error('A user with this email already exists.');
  }
  const department = resolveDepartment_(input.departmentId, input.role);
  const timestamp = formatNow_();
  const user = {
    'User ID': generateIdUnderLock_(APP_CONFIG.ID_PREFIXES.USERS),
    'Email': email,
    'Display Name': String(input.displayName).trim(),
    'Role': input.role,
    'Department ID': department.id,
    'Department Name': department.name,
    'Active': input.active !== false,
    'Created Date': timestamp,
    'Updated Date': timestamp
  };
  insertRecord(APP_CONFIG.SHEETS.USERS, user);
  writeUserAudit_(actor, 'CREATE_USER', user['User ID'], null, user);
  return toUserDto_(user);
}

function updateUser(userId, input) {
  return withScriptLock_(() => updateUserUnderLock_(userId, input));
}

function updateUserUnderLock_(userId, input) {
  const actor = requireAdmin_();
  if (!input) throw new Error('User changes are required.');
  const existing = getRecordById(APP_CONFIG.SHEETS.USERS, userId);
  if (!existing) throw new Error('User not found.');
  const proposedRole = input.role === undefined ? existing['Role'] : input.role;
  const proposedDepartmentId = input.departmentId === undefined ? existing['Department ID'] : input.departmentId;
  const proposedActive = input.active === undefined ? (existing['Active'] === true || String(existing['Active']).toUpperCase() === 'TRUE') : input.active === true;
  validateUserInput_({
    email: input.email === undefined ? existing['Email'] : input.email,
    displayName: input.displayName === undefined ? existing['Display Name'] : input.displayName,
    role: proposedRole,
    departmentId: proposedDepartmentId
  });
  const email = String(input.email === undefined ? existing['Email'] : input.email).trim().toLowerCase();
  const duplicate = getSheetData(APP_CONFIG.SHEETS.USERS).some(user => user['User ID'] !== userId && String(user['Email']).trim().toLowerCase() === email);
  if (duplicate) throw new Error('A user with this email already exists.');
  if (existing['Role'] === APP_CONFIG.ROLES.ADMIN && (existing['Active'] === true || String(existing['Active']).toUpperCase() === 'TRUE') && isLastActiveAdmin_(userId) &&
      (proposedRole !== APP_CONFIG.ROLES.ADMIN || !proposedActive)) {
    throw new Error('At least one active administrator is required.');
  }
  const department = resolveDepartment_(proposedDepartmentId, proposedRole);
  const updated = updateRecord(APP_CONFIG.SHEETS.USERS, userId, {
    'Email': email,
    'Display Name': String(input.displayName === undefined ? existing['Display Name'] : input.displayName).trim(),
    'Role': proposedRole,
    'Department ID': department.id,
    'Department Name': department.name,
    'Active': proposedActive,
    'Updated Date': formatNow_()
  });
  writeUserAudit_(actor, 'UPDATE_USER', userId, existing, updated);
  return toUserDto_(updated);
}

/** Soft-deactivates a user; user history remains intact. */
function deactivateUser(userId) {
  return withScriptLock_(() => deactivateUserUnderLock_(userId));
}

function deactivateUserUnderLock_(userId) {
  const actor = requireAdmin_();
  const existing = getRecordById(APP_CONFIG.SHEETS.USERS, userId);
  if (!existing) throw new Error('User not found.');
  if (existing['Role'] === APP_CONFIG.ROLES.ADMIN && (existing['Active'] === true || String(existing['Active']).toUpperCase() === 'TRUE') && isLastActiveAdmin_(userId)) {
    throw new Error('At least one active administrator is required.');
  }
  const updated = updateRecord(APP_CONFIG.SHEETS.USERS, userId, { 'Active': false, 'Updated Date': formatNow_() });
  writeUserAudit_(actor, 'DEACTIVATE_USER', userId, existing, updated);
  return toUserDto_(updated);
}

function validateUserInput_(input) {
  if (!input || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input.email || '').trim())) throw new Error('A valid email address is required.');
  if (!String(input.displayName || '').trim()) throw new Error('Display name is required.');
  if (!Object.keys(APP_CONFIG.ROLES).map(key => APP_CONFIG.ROLES[key]).includes(input.role)) throw new Error('Invalid user role.');
  if (input.role === APP_CONFIG.ROLES.DEPARTMENT_USER && !input.departmentId) throw new Error('Department users must be assigned to a department.');
}

function resolveDepartment_(departmentId, role) {
  if (role === APP_CONFIG.ROLES.ADMIN && !departmentId) return { id: '', name: '' };
  const department = getRecordById(APP_CONFIG.SHEETS.DEPARTMENTS, departmentId);
  if (!department || String(department['Active']).toUpperCase() !== 'TRUE') throw new Error('Select an active department.');
  return { id: department['Department ID'], name: department['Department Name'] };
}

function isLastActiveAdmin_(userId) {
  return getSheetData(APP_CONFIG.SHEETS.USERS).filter(isActiveAdministrator_).length === 1;
}

function toUserDto_(user) {
  return {
    userId: user['User ID'], email: user['Email'], displayName: user['Display Name'],
    role: user['Role'], departmentId: user['Department ID'], departmentName: user['Department Name'],
    active: user['Active'] === true || String(user['Active']).toUpperCase() === 'TRUE', updatedDate: toClientValue_(user['Updated Date'])
  };
}

function writeUserAudit_(actor, action, entityId, oldValue, newValue) {
  // All callers hold the script lock, so user change and audit ID remain atomic.
  insertRecord(APP_CONFIG.SHEETS.AUDIT_LOG, {
    'Log ID': generateIdUnderLock_(APP_CONFIG.ID_PREFIXES.AUDIT_LOG), 'Timestamp': formatNow_(),
    'User Email': actor['Email'], 'Role': actor['Role'], 'Action': action,
    'Entity Type': 'USER', 'Entity ID': entityId,
    'Old Value JSON': oldValue ? JSON.stringify(oldValue) : '',
    'New Value JSON': newValue ? JSON.stringify(newValue) : '',
    'Remarks': '', 'Correlation ID': ''
  });
}
