/**
 * Server-side identity and authorization service.
 * Keep these checks at the start of every future public server operation;
 * frontend visibility is never treated as an authorization control.
 */
function getAuthenticatedEmail_() {
  const otpEmail = typeof getOtpAuthenticatedEmail_ === 'function' ? getOtpAuthenticatedEmail_() : '';
  if (otpEmail) return otpEmail;
  const sessionEmail = normalizeIdentityEmail_(Session.getActiveUser().getEmail());
  if (sessionEmail) return sessionEmail;
  throw new Error('No verified signed-in identity is available.');
}

function getCurrentUser_() {
  const email = getAuthenticatedEmail_();
  const user = getUserByVerifiedEmail_(email);
  if (!user || user['Active'] !== true && String(user['Active']).toUpperCase() !== 'TRUE') {
    throw new Error('Access denied. Your account is not an active system user.');
  }
  return user;
}

/** Safe profile data that can be returned to a web client. */
function getMyProfile() {
  const user = getCurrentUser_();
  return toUserProfile_(user);
}

/**
 * Web-App-only profile gate. A browser must present an OTP-issued session; it
 * never falls back to the deploying owner's Session identity.
 */
function getWebAppProfile(sessionToken) { return getOtpWebAppProfile(sessionToken); }

/** Read-only, sanitized identity diagnostic for the currently executing web-app user. */
function diagnoseCurrentWebAppIdentity() {
  const result = {
    identityAvailable: false,
    authorizationRequired: false,
    userRecordFound: false,
    active: false,
    role: '',
    departmentAssigned: false,
    authorizationResult: 'IDENTITY_UNAVAILABLE'
  };
  try {
    const authorizationStatus = String(ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL).getAuthorizationStatus());
    if (authorizationStatus === 'REQUIRED') {
      result.authorizationRequired = true;
      result.authorizationResult = 'AUTHORIZATION_REQUIRED';
      console.log(JSON.stringify(result, null, 2));
      return result;
    }
  } catch (error) {
    result.authorizationResult = 'AUTHORIZATION_STATUS_UNAVAILABLE';
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  let email = '';
  try {
    email = getAuthenticatedEmail_();
    result.identityAvailable = true;
  } catch (error) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  let user;
  try {
    user = getUserByVerifiedEmail_(email);
  } catch (error) {
    result.authorizationResult = 'USER_LOOKUP_UNAVAILABLE';
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  if (!user) {
    result.authorizationResult = 'USER_RECORD_NOT_FOUND';
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  result.userRecordFound = true;
  result.active = isTrue_(user['Active']);
  result.role = String(user['Role'] || '');
  result.departmentAssigned = result.role === APP_CONFIG.ROLES.ADMIN || !!String(user['Department ID'] || '').trim();
  if (!result.active) result.authorizationResult = 'USER_INACTIVE';
  else if (![APP_CONFIG.ROLES.ADMIN, APP_CONFIG.ROLES.DEPARTMENT_USER].includes(result.role)) result.authorizationResult = 'ROLE_INVALID';
  else if (!result.departmentAssigned) result.authorizationResult = 'DEPARTMENT_NOT_ASSIGNED';
  else result.authorizationResult = 'AUTHORIZED';
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function normalizeIdentityEmail_(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function getUserByVerifiedEmail_(email) {
  return getSheetData(APP_CONFIG.SHEETS.USERS).find(record =>
    normalizeIdentityEmail_(record['Email']) === email) || null;
}

function toUserProfile_(user) {
  return {
    userId: user['User ID'], email: user['Email'], displayName: user['Display Name'],
    role: user['Role'], departmentId: user['Department ID'], departmentName: user['Department Name']
  };
}

function requireAdmin_() {
  const user = getCurrentUser_();
  if (user['Role'] !== APP_CONFIG.ROLES.ADMIN) throw new Error('Access denied. Administrator role required.');
  return user;
}

/** Canonical predicate used by all readiness checks for an active administrator. */
function isActiveAdministrator_(user) {
  return !!user && user['Role'] === APP_CONFIG.ROLES.ADMIN && isTrue_(user['Active']);
}

/** Allows an administrator or a user whose assigned department matches. */
function requireDepartmentAccess_(departmentId) {
  const user = getCurrentUser_();
  if (user['Role'] === APP_CONFIG.ROLES.ADMIN) return user;
  if (user['Role'] !== APP_CONFIG.ROLES.DEPARTMENT_USER || String(user['Department ID']) !== String(departmentId)) {
    throw new Error('Access denied. You can only access tasks in your own department.');
  }
  return user;
}

/**
 * One-time secure bootstrap. It can only succeed while Users is empty and
 * takes the active Google account as the initial administrator.
 */
function bootstrapInitialAdmin() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const users = getSheetData(APP_CONFIG.SHEETS.USERS);
    if (users.length > 0) throw new Error('Initial administrator already exists. Use createUser as an administrator.');
    const email = getAuthenticatedEmail_();
    const configuredEmail = getConfiguredInitialAdminEmail_();
    if (!configuredEmail) throw new Error('Initial administrator is not configured. Set GARMENT_INITIAL_ADMIN_EMAIL in Apps Script Script properties before bootstrap.');
    if (email !== configuredEmail) throw new Error('The signed-in account does not match the configured initial administrator.');
    const timestamp = formatNow_();
    const admin = {
      'User ID': generateIdUnderLock_(APP_CONFIG.ID_PREFIXES.USERS),
      'Email': email,
      'Display Name': email.split('@')[0],
      'Role': APP_CONFIG.ROLES.ADMIN,
      'Department ID': '',
      'Department Name': '',
      'Active': true,
      'Created Date': timestamp,
      'Updated Date': timestamp
    };
    insertRecord(APP_CONFIG.SHEETS.USERS, admin);
    writeUserAudit_(admin, 'BOOTSTRAP_INITIAL_ADMIN', admin['User ID'], null, admin);
    return getMyProfile();
  } finally {
    lock.releaseLock();
  }
}

/** Read-only readiness check for the one-time initial administrator bootstrap. */
function verifyAdminBootstrapReadiness() {
  const setup = verifySystemSetup();
  const users = getSheetData(APP_CONFIG.SHEETS.USERS);
  let identityAvailable = false;
  let identityMatchesConfiguredAdmin = false;
  const warnings = [];
  try {
    const activeEmail = getAuthenticatedEmail_();
    identityAvailable = true;
    const configuredEmail = getConfiguredInitialAdminEmail_();
    identityMatchesConfiguredAdmin = !!configuredEmail && activeEmail === configuredEmail;
    if (!configuredEmail) warnings.push('Configure GARMENT_INITIAL_ADMIN_EMAIL in Apps Script Script properties before bootstrap.');
    else if (!identityMatchesConfiguredAdmin) warnings.push('Run bootstrapInitialAdmin() only while signed in as the configured initial administrator.');
  } catch (error) {
    warnings.push('Signed-in identity is unavailable for bootstrap verification.');
  }
  if (users.length > 0) warnings.push('Bootstrap is permanently blocked because the Users sheet already contains records.');
  return {
    ready: setup.success && users.length === 0 && identityAvailable && identityMatchesConfiguredAdmin,
    existingAdminCount: users.filter(isActiveAdministrator_).length,
    existingUserCount: users.length,
    productionSchemaValid: setup.success,
    identityAvailable: identityAvailable,
    identityMatchesConfiguredAdmin: identityMatchesConfiguredAdmin,
    warnings: warnings
  };
}

/**
 * Read-only, sanitized diagnostic for the initial-admin Script Property.
 * It never returns the configured email address or changes production data.
 */
function checkInitialAdminConfig() {
  const errors = [];
  const warnings = [];
  let setup = null;
  let users = [];
  let rawValue = '';
  let identityAvailable = false;
  let identityMatchesConfiguredAdmin = false;

  try {
    setup = verifySystemSetup();
  } catch (error) {
    errors.push('Production schema verification could not complete.');
  }

  try {
    rawValue = String(PropertiesService.getScriptProperties()
      .getProperty(APP_CONFIG.INITIAL_ADMIN_EMAIL_PROPERTY) || '');
  } catch (error) {
    errors.push('Apps Script Script Properties are unavailable.');
  }
  const trimmedValue = rawValue.trim();
  const validFormat = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedValue);
  if (!trimmedValue) errors.push('Initial administrator email is not configured or is blank.');
  else if (!validFormat) errors.push('Initial administrator email has an invalid format.');

  try {
    users = getSheetData(APP_CONFIG.SHEETS.USERS);
  } catch (error) {
    errors.push('Users sheet could not be read.');
  }
  const existingAdminCount = users.filter(isActiveAdministrator_).length;
  const conflictingUserRecord = validFormat && users.some(user =>
    String(user['Email'] || '').trim().toLowerCase() === trimmedValue.toLowerCase());
  if (users.length) warnings.push('Bootstrap is blocked because the Users sheet already contains records.');

  try {
    const activeEmail = getAuthenticatedEmail_();
    identityAvailable = true;
    identityMatchesConfiguredAdmin = validFormat && activeEmail === trimmedValue.toLowerCase();
    if (validFormat && !identityMatchesConfiguredAdmin) {
      warnings.push('The signed-in account does not match the configured initial administrator.');
    }
  } catch (error) {
    warnings.push('Signed-in identity is unavailable for bootstrap verification.');
  }

  const bootstrapAllowed = !!(setup && setup.success && validFormat && users.length === 0 &&
    identityAvailable && identityMatchesConfiguredAdmin && errors.length === 0);
  const result = {
    configured: !!trimmedValue,
    propertyStore: 'ScriptProperties',
    propertyName: APP_CONFIG.INITIAL_ADMIN_EMAIL_PROPERTY,
    validFormat: validFormat,
    existingAdminCount: existingAdminCount,
    existingUserCount: users.length,
    conflict: users.length > 0,
    conflictingUserRecord: conflictingUserRecord,
    identityAvailable: identityAvailable,
    identityMatchesConfiguredAdmin: identityMatchesConfiguredAdmin,
    bootstrapAllowed: bootstrapAllowed,
    errors: errors,
    warnings: warnings
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function getConfiguredInitialAdminEmail_() {
  const email = String(PropertiesService.getScriptProperties().getProperty(APP_CONFIG.INITIAL_ADMIN_EMAIL_PROPERTY) || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}
