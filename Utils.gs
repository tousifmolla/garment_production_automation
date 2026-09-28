function getSpreadsheet_() {
  const configuredId = PropertiesService.getScriptProperties().getProperty(APP_CONFIG.SPREADSHEET_ID_PROPERTY);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (configuredId) {
    const configured = SpreadsheetApp.openById(configuredId);
    if (active && String(active.getId()) !== String(configured.getId())) {
      throw new Error('Configured spreadsheet does not match this container-bound project. Refusing to use a different spreadsheet.');
    }
    return configured;
  }
  if (!active) throw new Error('No active spreadsheet. Bind this project to a sheet or set GARMENT_PRODUCTION_SPREADSHEET_ID.');
  return active;
}

function getCurrentEmail_() {
  return Session.getActiveUser().getEmail() || 'system';
}

function formatNow_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Kolkata', APP_CONFIG.DATE_FORMAT);
}

function toPlainObject_(headers, values) {
  return headers.reduce((record, header, index) => {
    record[header] = values[index];
    return record;
  }, {});
}

/** Converts spreadsheet values to types supported by the Html Service RPC boundary. */
function toClientValue_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || 'Asia/Kolkata', APP_CONFIG.DATE_FORMAT);
  }
  return value;
}

function toClientRecord_(record) {
  return Object.keys(record).reduce((result, key) => {
    result[key] = toClientValue_(record[key]);
    return result;
  }, {});
}

/** Runs a short critical section under the script-wide lock. */
function withScriptLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function asNumber_(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function isTrue_(value) {
  return value === true || String(value).toUpperCase() === 'TRUE';
}
