/**
 * External Google identity uses the OAuth authorization-code flow. The callback
 * is the deployed Web App's stable /exec endpoint, avoiding dynamic HtmlService
 * iframe origins. Raw OAuth tokens are never persisted or sent to the browser.
 */
function getExternalIdentityConfig() {
  const properties = PropertiesService.getScriptProperties();
  const clientId = String(properties.getProperty(APP_CONFIG.GOOGLE_OAUTH_CLIENT_ID_PROPERTY) || '').trim();
  const clientSecret = String(properties.getProperty(APP_CONFIG.GOOGLE_OAUTH_CLIENT_SECRET_PROPERTY) || '').trim();
  let redirectUri = '';
  try { redirectUri = getExternalOAuthRedirectUri_(); } catch (error) { redirectUri = ''; }
  return { enabled: Boolean(clientId && clientSecret && redirectUri), redirectUri: redirectUri };
}

/**
 * Read-only, sanitized external OAuth configuration diagnostic. It reads only
 * Script Properties and the current script ID, and never returns credentials.
 */
function diagnoseExternalIdentityConfiguration() {
  const result = {
    oauthClientIdConfigured: false,
    oauthClientIdFormatValid: false,
    clientSecretRequired: true,
    clientSecretConfigured: false,
    redirectUriRequired: true,
    redirectUriConfigured: false,
    externalIdentityMode: 'APPS_SCRIPT_OAUTH_CODE_FLOW',
    configurationComplete: false,
    errors: []
  };
  try {
    const properties = PropertiesService.getScriptProperties();
    const clientId = String(properties.getProperty(APP_CONFIG.GOOGLE_OAUTH_CLIENT_ID_PROPERTY) || '').trim();
    const clientSecret = String(properties.getProperty(APP_CONFIG.GOOGLE_OAUTH_CLIENT_SECRET_PROPERTY) || '').trim();
    result.oauthClientIdConfigured = Boolean(clientId);
    result.oauthClientIdFormatValid = /^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId);
    result.clientSecretConfigured = Boolean(clientSecret);
    if (!result.oauthClientIdConfigured) result.errors.push('Missing GARMENT_GOOGLE_OAUTH_CLIENT_ID Script Property.');
    else if (!result.oauthClientIdFormatValid) result.errors.push('GARMENT_GOOGLE_OAUTH_CLIENT_ID does not have a Google Web Client ID format.');
    if (!result.clientSecretConfigured) result.errors.push('Missing GARMENT_GOOGLE_OAUTH_CLIENT_SECRET Script Property.');
  } catch (error) {
    result.errors.push('Apps Script Script Properties could not be read.');
  }
  try {
    result.redirectUriConfigured = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(getExternalOAuthRedirectUri_());
    if (!result.redirectUriConfigured) result.errors.push('GARMENT_WEB_APP_URL is missing or invalid.');
  } catch (error) {
    result.errors.push('GARMENT_WEB_APP_URL is missing or invalid.');
  }
  result.configurationComplete = result.oauthClientIdConfigured && result.oauthClientIdFormatValid &&
    result.clientSecretConfigured && result.redirectUriConfigured && result.errors.length === 0;
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Read-only callback preflight. It does not create OAuth state or alter any
 * session, configuration, spreadsheet, trigger, or production record.
 */
function diagnoseOAuthCallbackReadiness() {
  const result = {
    callbackConfigured: false,
    callbackFunctionExists: typeof handleExternalOAuthWebCallback_ === 'function',
    redirectUriValid: false,
    perUserPropertyStore: false,
    temporaryUserKeyAvailable: false,
    stateTokenReady: false,
    externalUserCallbackAllowed: false,
    errors: []
  };
  try {
    getExternalIdentitySessionStore_();
    result.temporaryUserKeyAvailable = true;
    result.stateTokenReady = true;
  } catch (error) {
    result.errors.push('The temporary external-user context is unavailable.');
  }
  try {
    result.redirectUriValid = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(getExternalOAuthRedirectUri_());
    if (!result.redirectUriValid) result.errors.push('GARMENT_WEB_APP_URL is missing or invalid.');
  } catch (error) {
    result.errors.push('GARMENT_WEB_APP_URL is missing or invalid.');
  }
  // The deployed /exec route honors the manifest's ANYONE access setting.
  result.externalUserCallbackAllowed = result.redirectUriValid;
  result.callbackConfigured = result.callbackFunctionExists && result.redirectUriValid && result.temporaryUserKeyAvailable;
  if (!result.callbackFunctionExists) result.errors.push('The Web App OAuth callback handler is unavailable.');
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/** Read-only, sanitized view of the current browser user's OAuth session. */
function diagnoseExternalOAuthSession() {
  const result = {
    sessionPresent: false,
    sessionExpired: false,
    userRecordFound: false,
    active: false,
    roleResolved: false,
    departmentResolved: false,
    dashboardTarget: '',
    errors: []
  };
  try {
    const sessionStore = getExternalIdentitySessionStore_();
    const email = normalizeIdentityEmail_(sessionStore.properties.getProperty(sessionStore.emailProperty));
    const expiry = Number(sessionStore.properties.getProperty(sessionStore.expiryProperty) || 0);
    result.sessionPresent = Boolean(email && Number.isFinite(expiry));
    result.sessionExpired = result.sessionPresent && expiry <= Date.now();
    if (email && !result.sessionExpired) {
      const user = getUserByVerifiedEmail_(email);
      result.userRecordFound = Boolean(user);
      result.active = Boolean(user && isTrue_(user['Active']));
      result.roleResolved = Boolean(user && [APP_CONFIG.ROLES.ADMIN, APP_CONFIG.ROLES.DEPARTMENT_USER].includes(user['Role']));
      result.departmentResolved = Boolean(user && (user['Role'] === APP_CONFIG.ROLES.ADMIN || String(user['Department ID'] || '').trim()));
      if (result.active && result.roleResolved && result.departmentResolved) {
        result.dashboardTarget = user['Role'] === APP_CONFIG.ROLES.ADMIN ? 'ADMIN' : 'DEPARTMENT';
      }
    }
  } catch (error) {
    result.errors.push('External browser session storage is unavailable.');
  }
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/** Starts a one-time OAuth request. It does not modify business records. */
function beginExternalOAuthAuthorization() {
  const config = getExternalOAuthConfig_();
  const nonce = Utilities.getUuid();
  const state = 'external_oauth_' + nonce;
  const sessionStore = getExternalIdentitySessionStore_();
  sessionStore.properties.setProperties({
    [sessionStore.stateProperty]: state,
    [sessionStore.stateExpiryProperty]: String(Date.now() + 10 * 60 * 1000)
  });
  return {
    success: true,
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?' + toQueryString_({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: state,
      nonce: nonce,
      prompt: 'select_account',
      access_type: 'online'
    })
  };
}

/**
 * OAuth redirects to the deployed Web App /exec endpoint. doGet() dispatches
 * matching requests here before rendering any application HTML. It stores only
 * a verified, short-lived email session in Script Properties scoped by Apps
 * Script's anonymous temporary active-user key. User Properties are scoped to
 * the deploying owner for an "execute as me" web app and therefore must not be
 * used as a browser-user session store.
 */
function handleExternalOAuthWebCallback_(request) {
  const parameters = request && request.parameter || {};
  const state = String(parameters.state || '');
  if (parameters.error || !parameters.code || !validateExternalOAuthState_(state)) {
    return renderExternalOAuthResult_('Google sign-in was cancelled or could not be completed.');
  }
  try {
    const claims = exchangeGoogleAuthorizationCode_(parameters.code, state.substring('external_oauth_'.length));
    const email = normalizeIdentityEmail_(claims.email);
    const user = getUserByVerifiedEmail_(email);
    if (!user || !isTrue_(user['Active']) || !isValidExternalIdentityRole_(user)) {
      return renderExternalOAuthResult_('This Google account is not authorized for this application.');
    }
    const sessionStore = getExternalIdentitySessionStore_();
    sessionStore.properties.setProperties({
      [sessionStore.emailProperty]: email,
      [sessionStore.expiryProperty]: String(claims.exp * 1000)
    });
    clearExternalOAuthState_();
    return renderExternalOAuthResult_('Google identity verified. Returning to the application…');
  } catch (error) {
    return renderExternalOAuthResult_('Google identity verification could not be completed.');
  }
}

function isExternalOAuthWebCallbackRequest_(request) {
  const state = String(request && request.parameter && request.parameter.state || '');
  return state.indexOf('external_oauth_') === 0;
}

function validateExternalOAuthState_(state) {
  try {
    const sessionStore = getExternalIdentitySessionStore_();
    const expectedState = String(sessionStore.properties.getProperty(sessionStore.stateProperty) || '');
    const expiry = Number(sessionStore.properties.getProperty(sessionStore.stateExpiryProperty) || 0);
    return /^external_oauth_[A-Za-z0-9-]{20,}$/.test(state) && state === expectedState &&
      Number.isFinite(expiry) && expiry > Date.now();
  } catch (error) {
    return false;
  }
}

function clearExternalOAuthState_() {
  const sessionStore = getExternalIdentitySessionStore_();
  sessionStore.properties.deleteProperty(sessionStore.stateProperty);
  sessionStore.properties.deleteProperty(sessionStore.stateExpiryProperty);
}

/** Read-only setup aid; no credential or token is returned. */
function getExternalOAuthSetupInfo() {
  const config = getExternalIdentityConfig();
  return { redirectUri: config.redirectUri, clientConfigured: config.enabled };
}

/** Reads only the user-scoped verified identity session. */
function getExternalIdentityEmail_() {
  try {
    const sessionStore = getExternalIdentitySessionStore_();
    const expiry = Number(sessionStore.properties.getProperty(sessionStore.expiryProperty) || 0);
    const email = normalizeIdentityEmail_(sessionStore.properties.getProperty(sessionStore.emailProperty));
    return email && Number.isFinite(expiry) && expiry > Date.now() ? email : '';
  } catch (error) {
    return '';
  }
}

/**
 * Returns a Script-Properties namespace bound to Apps Script's anonymous,
 * temporary active-user key. The key is unique to this script and rotates, so
 * no email or client-supplied identity is used as the session lookup key.
 */
function getExternalIdentitySessionStore_() {
  const temporaryKey = String(Session.getTemporaryActiveUserKey() || '').trim();
  if (!temporaryKey) throw new Error('EXTERNAL_IDENTITY_USER_CONTEXT_UNAVAILABLE');
  const keySuffix = temporaryKey.replace(/[^A-Za-z0-9_-]/g, '_');
  if (!keySuffix) throw new Error('EXTERNAL_IDENTITY_USER_CONTEXT_UNAVAILABLE');
  const prefix = 'GARMENT_EXTERNAL_IDENTITY_SESSION_' + keySuffix + '_';
  return {
    properties: PropertiesService.getScriptProperties(),
    stateProperty: prefix + 'STATE',
    stateExpiryProperty: prefix + 'STATE_EXPIRY',
    emailProperty: prefix + 'EMAIL',
    expiryProperty: prefix + 'EXPIRY'
  };
}

function getExternalOAuthConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const clientId = String(properties.getProperty(APP_CONFIG.GOOGLE_OAUTH_CLIENT_ID_PROPERTY) || '').trim();
  const clientSecret = String(properties.getProperty(APP_CONFIG.GOOGLE_OAUTH_CLIENT_SECRET_PROPERTY) || '').trim();
  if (!clientId || !clientSecret) throw new Error('EXTERNAL_IDENTITY_NOT_CONFIGURED');
  return { clientId: clientId, clientSecret: clientSecret, redirectUri: getExternalOAuthRedirectUri_() };
}

function getExternalOAuthRedirectUri_() {
  const url = String(PropertiesService.getScriptProperties()
    .getProperty(APP_CONFIG.WEB_APP_URL_PROPERTY) || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) {
    throw new Error('EXTERNAL_OAUTH_WEB_APP_URL_NOT_CONFIGURED');
  }
  return url;
}

function exchangeGoogleAuthorizationCode_(code, expectedNonce) {
  const config = getExternalOAuthConfig_();
  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: {
      code: String(code), client_id: config.clientId, client_secret: config.clientSecret,
      redirect_uri: config.redirectUri, grant_type: 'authorization_code'
    },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error('INVALID_AUTHORIZATION_CODE');
  let payload;
  try { payload = JSON.parse(response.getContentText()); } catch (error) { throw new Error('INVALID_AUTHORIZATION_CODE'); }
  return verifyGoogleOAuthIdToken_(payload.id_token, expectedNonce, config.clientId);
}

function verifyGoogleOAuthIdToken_(idToken, expectedNonce, expectedAudience) {
  const token = String(idToken || '').trim();
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) || token.length > 12000) {
    throw new Error('INVALID_ID_TOKEN');
  }
  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), {
    method: 'get', muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error('INVALID_ID_TOKEN');
  let claims;
  try { claims = JSON.parse(response.getContentText()); } catch (error) { throw new Error('INVALID_ID_TOKEN'); }
  const issuer = String(claims.iss || '');
  const expiration = Number(claims.exp || 0);
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(issuer) ||
      String(claims.aud || '') !== String(expectedAudience || '') ||
      String(claims.nonce || '') !== String(expectedNonce || '') ||
      !(claims.email_verified === true || String(claims.email_verified).toLowerCase() === 'true') ||
      !normalizeIdentityEmail_(claims.email) ||
      !Number.isFinite(expiration) || expiration * 1000 <= Date.now()) {
    throw new Error('INVALID_ID_TOKEN');
  }
  return { email: claims.email, exp: expiration };
}

function isValidExternalIdentityRole_(user) {
  if (![APP_CONFIG.ROLES.ADMIN, APP_CONFIG.ROLES.DEPARTMENT_USER].includes(user['Role'])) return false;
  return user['Role'] !== APP_CONFIG.ROLES.DEPARTMENT_USER || Boolean(String(user['Department ID'] || '').trim());
}

function toQueryString_(parameters) {
  return Object.keys(parameters).map(function(key) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(String(parameters[key]));
  }).join('&');
}

function renderExternalOAuthResult_(message) {
  let redirectUrl = '';
  try { redirectUrl = getExternalOAuthRedirectUri_(); } catch (error) { redirectUrl = ''; }
  const safeMessage = escapeExternalHtml_(message);
  const hasCleanRedirect = /^https:\/\/script\.google\.com\/macros\/s\//.test(redirectUrl);
  const continueLink = hasCleanRedirect
    ? '<p><a id="external-oauth-continue" href="' + escapeExternalHtml_(redirectUrl) + '" target="_top">Continue to Garment Production</a></p>'
    : '';
  // HtmlService iframes may block automatic top-level navigation unless it was
  // initiated by a user gesture. The link is the reliable handoff; the script
  // preserves automatic navigation in runtimes where it is permitted.
  const redirectScript = hasCleanRedirect
    ? '<script>(function(){var url=' + JSON.stringify(redirectUrl) + ';try{if(window.top===window){window.location.replace(url);}}catch(error){}}());</script>'
    : '';
  return HtmlService.createHtmlOutput('<!doctype html><html><head><base target="_top"></head><body><p>' + safeMessage + '</p>' + continueLink + redirectScript + '</body></html>');
}

function escapeExternalHtml_(value) {
  return String(value || '').replace(/[&<>"']/g, function(character) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character];
  });
}
