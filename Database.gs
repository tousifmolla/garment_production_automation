/** Creates or validates the sheet schema and returns the sheet. */
function ensureSheet_(spreadsheet, sheetName, headers) {
  const sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
  const existingHeaders = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] : [];
  if (existingHeaders.filter(String).length === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else if (existingHeaders.length <= headers.length && existingHeaders.join('|') === headers.slice(0, existingHeaders.length).join('|')) {
    // Appenditive schema migration: Phase updates may add fields without
    // touching historical rows or changing existing column positions.
    if (existingHeaders.length < headers.length) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    throw new Error('Schema mismatch in sheet "' + sheetName + '". Existing data was not changed.');
  }
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1f4e78').setFontColor('#ffffff');
  sheet.autoResizeColumns(1, headers.length);
  return sheet;
}

/** Returns all records in a named sheet as header-keyed objects. */
function getSheetData(sheetName) {
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) throw new Error('Unknown sheet: ' + sheetName);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).filter(row => row.some(value => value !== '')).map(row => toPlainObject_(headers, row));
}

function getRecordById(sheetName, id) {
  const headers = getSheetSchemas_()[sheetName];
  if (!headers) throw new Error('No schema configured for ' + sheetName);
  const idField = headers[0];
  return getSheetData(sheetName).find(record => String(record[idField]) === String(id)) || null;
}

function findRecords(sheetName, filters) {
  return getSheetData(sheetName).filter(record => Object.keys(filters || {}).every(key => {
    const expected = filters[key];
    return expected === undefined || expected === null || expected === '' || String(record[key]) === String(expected);
  }));
}

function insertRecord(sheetName, record) {
  const headers = getSheetSchemas_()[sheetName];
  if (!headers) throw new Error('No schema configured for ' + sheetName);
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) throw new Error('Unknown sheet: ' + sheetName);
  sheet.appendRow(headers.map(header => protectSpreadsheetValue_(record[header] === undefined ? '' : record[header])));
  return record;
}

function updateRecord(sheetName, id, changes) {
  const headers = getSheetSchemas_()[sheetName];
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!headers || !sheet) throw new Error('Unknown sheet: ' + sheetName);
  const values = sheet.getDataRange().getValues();
  const idIndex = 0;
  const rowIndex = values.findIndex((row, index) => index > 0 && String(row[idIndex]) === String(id));
  if (rowIndex < 0) throw new Error('Record not found: ' + id);
  const updated = toPlainObject_(headers, values[rowIndex]);
  Object.keys(changes).forEach(key => {
    if (!headers.includes(key)) throw new Error('Unknown field: ' + key);
    updated[key] = changes[key];
  });
  sheet.getRange(rowIndex + 1, 1, 1, headers.length).setValues([headers.map(header => protectSpreadsheetValue_(updated[header]))]);
  return updated;
}

/** Prevent untrusted text from being interpreted as a Google Sheets formula. */
function protectSpreadsheetValue_(value) {
  return typeof value === 'string' && /^[=+\-@]/.test(value) ? "'" + value : value;
}

/**
 * Internal single-record deletion helper for local maintenance tests only.
 * It is intentionally not a public Apps Script/web-app entry point.
 */
function deleteRecord_(sheetName, id) {
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) throw new Error('Unknown sheet: ' + sheetName);
  if (sheet.getLastRow() < 2) throw new Error('Record not found: ' + id);
  const values = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 0), 1).getValues();
  const index = values.findIndex(row => String(row[0]) === String(id));
  if (index < 0) throw new Error('Record not found: ' + id);
  sheet.deleteRow(index + 2);
}

/** Allocates an ID under a script lock so simultaneous users cannot collide. */
function generateId(prefix) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return generateIdUnderLock_(prefix);
  } finally {
    lock.releaseLock();
  }
}

/** Internal ID allocation for callers that already hold the script lock. */
function generateIdUnderLock_(prefix) {
  const usesAnnualSequence = APP_CONFIG.ANNUAL_ID_PREFIXES.includes(prefix);
  const year = new Date().getFullYear();
  const key = 'SEQ_' + prefix + (usesAnnualSequence ? '_' + year : '');
  const properties = PropertiesService.getScriptProperties();
  const next = Number(properties.getProperty(key) || 0) + 1;
  properties.setProperty(key, String(next));
  const sequence = ('00000' + next).slice(-5);
  return usesAnnualSequence ? [prefix, year, sequence].join('-') : [prefix, sequence].join('-');
}
