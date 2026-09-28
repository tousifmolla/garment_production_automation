/**
 * Email OTP authentication for browser users. OTPs and sessions are opaque
 * server-side records; the client receives only a short-lived bearer session
 * token after a successful verification.
 */
var ACTIVE_OTP_SESSION_USER_ = null;

function requestEmailOtp(emailInput) {
  const email = normalizeIdentityEmail_(emailInput);
  const generic = { success: true, message: 'If this email is authorized, a verification code has been sent.' };
  if (!email) return generic;
  return withScriptLock_(() => requestEmailOtpUnderLock_(email, generic));
}

function requestEmailOtpUnderLock_(email, generic) {
  const user = getUserByVerifiedEmail_(email);
  if (!user || !isTrue_(user['Active']) || !isValidOtpUser_(user)) return generic;
  const properties = PropertiesService.getScriptProperties();
  const key = getOtpRecordProperty_(email);
  const now = Date.now();
  const existing = parseOtpRecord_(properties.getProperty(key));
  if (existing && now - existing.lastRequestedAt < APP_CONFIG.OTP_MIN_REQUEST_INTERVAL_MILLIS) return generic;
  if (existing && now - existing.windowStartedAt < 60 * 60 * 1000 && existing.requestCount >= APP_CONFIG.OTP_MAX_REQUESTS_PER_HOUR) return generic;
  const code = generateOtpCode_();
  const windowStartedAt = existing && now - existing.windowStartedAt < 60 * 60 * 1000 ? existing.windowStartedAt : now;
  const requestCount = existing && now - existing.windowStartedAt < 60 * 60 * 1000 ? existing.requestCount + 1 : 1;
  properties.setProperty(key, JSON.stringify({
    hash: hashOtp_(email, code), expiresAt: now + APP_CONFIG.OTP_EXPIRY_MILLIS,
    attempts: 0, lastRequestedAt: now, windowStartedAt: windowStartedAt, requestCount: requestCount
  }));
  try {
    MailApp.sendEmail({
      to: email,
      subject: APP_CONFIG.APP_NAME + ' verification code',
      body: 'Your verification code is ' + code + '. It expires in 10 minutes. Do not share this code.'
    });
  } catch (error) {
    properties.deleteProperty(key);
  }
  return generic;
}

function verifyEmailOtp(emailInput, codeInput) {
  const email = normalizeIdentityEmail_(emailInput);
  const code = String(codeInput || '').trim();
  if (!email || !/^\d{6}$/.test(code)) throw new Error('Verification code is invalid or expired.');
  return withScriptLock_(() => verifyEmailOtpUnderLock_(email, code));
}

function verifyEmailOtpUnderLock_(email, code) {
  const properties = PropertiesService.getScriptProperties();
  const key = getOtpRecordProperty_(email);
  const record = parseOtpRecord_(properties.getProperty(key));
  const now = Date.now();
  if (!record || record.expiresAt <= now || record.attempts >= APP_CONFIG.OTP_MAX_ATTEMPTS) {
    properties.deleteProperty(key);
    throw new Error('Verification code is invalid or expired.');
  }
  if (!constantTimeEqual_(record.hash, hashOtp_(email, code))) {
    record.attempts += 1;
    properties.setProperty(key, JSON.stringify(record));
    throw new Error('Verification code is invalid or expired.');
  }
  const user = getUserByVerifiedEmail_(email);
  properties.deleteProperty(key);
  if (!user || !isTrue_(user['Active']) || !isValidOtpUser_(user)) throw new Error('Access denied.');
  const token = generateOtpSessionToken_();
  properties.setProperty(getOtpSessionProperty_(token), JSON.stringify({ email: email, expiresAt: now + APP_CONFIG.OTP_SESSION_EXPIRY_MILLIS }));
  return { success: true, sessionToken: token, profile: toUserProfile_(user) };
}

function logoutOtpSession(sessionToken) {
  const token = validateOtpSessionToken_(sessionToken);
  if (token) PropertiesService.getScriptProperties().deleteProperty(getOtpSessionProperty_(token));
  return { success: true };
}

/** Browser-only session gate. */
function getOtpWebAppProfile(sessionToken) {
  return withOtpSessionUser_(sessionToken, user => toUserProfile_(user));
}

/**
 * Single allowlisted RPC entry point for authenticated browser operations.
 * Existing business functions retain their server-side requireAdmin_/department
 * checks, which resolve the verified session established here.
 */
function invokeAuthenticated(action, args, sessionToken) {
  const handlers = {
    getAdminDashboard: getAdminDashboard, listAlerts: listAlerts, listMyAlerts: listMyAlerts,
    acknowledgeAlert: acknowledgeAlert, getDepartmentDashboard: getDepartmentDashboard,
    listProducts: listProducts, listCustomers: listCustomers, createProductionOrder: createProductionOrder,
    saveProduct: saveProduct, saveCustomer: saveCustomer, deactivateProduct: deactivateProduct,
    deactivateCustomer: deactivateCustomer, listUsers: listUsers, listDepartments: listDepartments,
    updateUser: updateUser, createUser: createUser, deactivateUser: deactivateUser,
    startTask: startTask, updateTaskProgress: updateTaskProgress, putTaskOnHold: putTaskOnHold,
    resumeTask: resumeTask, reportTaskBlocked: reportTaskBlocked, completeTask: completeTask,
    getUserNotifications: getUserNotifications
  };
  const handler = handlers[String(action || '')];
  if (!handler || !Array.isArray(args)) throw new Error('Unsupported authenticated operation.');
  return withOtpSessionUser_(sessionToken, () => handler.apply(null, args));
}

function withOtpSessionUser_(sessionToken, callback) {
  const token = validateOtpSessionToken_(sessionToken);
  if (!token) throw new Error('Session expired. Sign in again.');
  const properties = PropertiesService.getScriptProperties();
  const record = parseOtpRecord_(properties.getProperty(getOtpSessionProperty_(token)));
  if (!record || record.expiresAt <= Date.now()) {
    properties.deleteProperty(getOtpSessionProperty_(token));
    throw new Error('Session expired. Sign in again.');
  }
  const user = getUserByVerifiedEmail_(normalizeIdentityEmail_(record.email));
  if (!user || !isTrue_(user['Active']) || !isValidOtpUser_(user)) throw new Error('Access denied.');
  ACTIVE_OTP_SESSION_USER_ = user;
  try { return callback(user); } finally { ACTIVE_OTP_SESSION_USER_ = null; }
}

function getOtpAuthenticatedEmail_() {
  return ACTIVE_OTP_SESSION_USER_ ? normalizeIdentityEmail_(ACTIVE_OTP_SESSION_USER_['Email']) : '';
}

function isValidOtpUser_(user) {
  return [APP_CONFIG.ROLES.ADMIN, APP_CONFIG.ROLES.DEPARTMENT_USER].includes(user['Role']) &&
    (user['Role'] === APP_CONFIG.ROLES.ADMIN || Boolean(String(user['Department ID'] || '').trim()));
}

function getOtpRecordProperty_(email) { return APP_CONFIG.OTP_RECORD_PREFIX + sha256Hex_(email); }
function getOtpSessionProperty_(token) { return APP_CONFIG.OTP_SESSION_PREFIX + sha256Hex_(token); }

function parseOtpRecord_(value) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) { return null; }
}

function generateOtpCode_() {
  const numeric = parseInt(String(Utilities.getUuid()).replace(/-/g, '').slice(0, 12), 16) % 1000000;
  return String(numeric).padStart(6, '0');
}

function generateOtpSessionToken_() { return Utilities.getUuid() + Utilities.getUuid().replace(/-/g, ''); }
function validateOtpSessionToken_(value) { return /^[A-Za-z0-9-]{48,80}$/.test(String(value || '')) ? String(value) : ''; }

function getOtpPepper_() {
  const properties = PropertiesService.getScriptProperties();
  let pepper = String(properties.getProperty(APP_CONFIG.OTP_PEPPER_PROPERTY) || '');
  if (!pepper) { pepper = Utilities.getUuid() + Utilities.getUuid(); properties.setProperty(APP_CONFIG.OTP_PEPPER_PROPERTY, pepper); }
  return pepper;
}

function hashOtp_(email, code) { return sha256Hex_(getOtpPepper_() + ':' + email + ':' + code); }
function sha256Hex_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8)
    .map(byte => ('0' + (byte & 0xff).toString(16)).slice(-2)).join('');
}
function constantTimeEqual_(left, right) {
  const a = String(left || ''), b = String(right || '');
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  return difference === 0;
}
