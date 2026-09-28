/*
 * Read-only clasp preflight. It deliberately never invokes `clasp push`,
 * creates no spreadsheet objects, and runs no Apps Script function.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, '.clasp.json');
const ignorePath = path.join(root, '.claspignore');
const manifestPath = path.join(root, 'appsscript.json');

function fail(message) {
  console.error(`Deployment preflight failed: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(configPath)) {
  fail('Missing .clasp.json. Link the existing bound Apps Script project using its real Script ID before pushing.');
}
if (!fs.existsSync(ignorePath)) fail('Missing .claspignore.');
if (!fs.existsSync(manifestPath)) fail('Missing appsscript.json.');

let config;
let manifest;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (error) {
  fail(`Invalid JSON: ${error.message}`);
}

const scriptId = typeof config.scriptId === 'string' ? config.scriptId.trim() : '';
const normalizedScriptId = scriptId.toLowerCase().replace(/[_\-\s]+/g, ' ');
const isPlaceholderScriptId =
  !scriptId ||
  /^(null|undefined)$/i.test(scriptId) ||
  /\b(paste|your|here|real)\b/i.test(normalizedScriptId) ||
  /\bscript id\b/i.test(normalizedScriptId) ||
  !/^[A-Za-z0-9_-]{20,200}$/.test(scriptId);
if (isPlaceholderScriptId) {
  fail('.clasp.json must contain the real bound Apps Script Script ID, not an empty, placeholder-style, or invalid value. Copy it from Production Sheet → Extensions → Apps Script → Project Settings → Script ID.');
}
if (config.rootDir !== '.') fail('rootDir must be "." because deployable source files are stored at the repository root.');
if (manifest.webapp?.executeAs !== 'USER_DEPLOYING') {
  fail('Manifest webapp.executeAs must remain USER_DEPLOYING so external users never need direct spreadsheet access.');
}
if (manifest.webapp?.access !== 'ANYONE') {
  fail('Manifest webapp.access must be ANYONE for signed-in external Gmail users; never use ANYONE_ANONYMOUS.');
}

const expected = [
  'AdminManagement.gs', 'Alerts.gs', 'Auth.gs', 'Code.gs', 'Config.gs',
  'Dashboard.gs', 'Database.gs', 'DepartmentDashboardServer.gs', 'ExternalIdentity.gs', 'OtpAuth.gs', 'Integration.gs',
  'Notifications.gs', 'Operations.gs', 'Orders.gs', 'Reporting.gs', 'Setup.gs',
  'Tasks.gs', 'Tests.gs', 'Users.gs', 'Utils.gs', 'Workflow.gs',
  'AdminDashboard.html', 'CSS.html', 'DepartmentDashboard.html', 'Index.html', 'JS.html',
  'appsscript.json'
];
const deployableEntries = fs.readdirSync(root, { withFileTypes: true })
  .filter(entry => entry.isFile() && ['.gs', '.html'].includes(path.extname(entry.name)))
  .map(entry => entry.name);
const byBaseName = new Map();
for (const file of deployableEntries) {
  const baseName = path.basename(file, path.extname(file));
  byBaseName.set(baseName, [...(byBaseName.get(baseName) || []), file]);
}
const basenameCollisions = [...byBaseName.entries()]
  .filter(([, files]) => files.length > 1)
  .map(([baseName, files]) => `${baseName}: ${files.join(', ')}`);
if (basenameCollisions.length) {
  fail(`Apps Script project filename collision(s) detected: ${basenameCollisions.join('; ')}. Rename one deployable file so every .gs/.html basename is unique.`);
}
for (const file of expected) {
  if (!fs.existsSync(path.join(root, file))) fail(`Expected deployable file is missing: ${file}`);
}

const claspEntry = path.join(root, 'node_modules', '@google', 'clasp', 'build', 'src', 'index.js');
if (!fs.existsSync(claspEntry)) {
  fail('Local @google/clasp is not installed. Run npm install before running deploy:check.');
}

let status;
try {
  // Invoke Node directly instead of a platform-specific .cmd/.ps1 shell wrapper.
  // `status` only analyzes local files; it does not push, pull, deploy, or run Apps Script.
  const output = execFileSync(process.execPath, [claspEntry, 'status', '--json'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  status = JSON.parse(output);
} catch (error) {
  const details = [error.stderr, error.stdout, error.message]
    .filter(Boolean)
    .map(value => String(value).trim())
    .filter(Boolean)
    .join('\n');
  fail(`Read-only clasp status failed. ${details}`);
}

if (!Array.isArray(status.filesToPush) || !Array.isArray(status.untrackedFiles)) {
  fail('clasp status returned an unexpected response.');
}

const normalizedFiles = status.filesToPush.map(file => String(file).replace(/\\/g, '/')).sort();
const expectedFiles = [...expected].sort();
if (JSON.stringify(normalizedFiles) !== JSON.stringify(expectedFiles)) {
  const unexpected = normalizedFiles.filter(file => !expectedFiles.includes(file));
  const missing = expectedFiles.filter(file => !normalizedFiles.includes(file));
  fail(`clasp status upload list is not the audited allowlist. Unexpected: ${unexpected.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'}.`);
}

const forbiddenPrefixes = ['tests/', 'docs/', 'powerbi/', 'scripts/', 'node_modules/', '.git/'];
const forbiddenFiles = ['README.md', 'package.json', 'package-lock.json', 'run-all.js'];
const excludedInStatus = normalizedFiles.filter(file =>
  forbiddenPrefixes.some(prefix => file.startsWith(prefix)) || forbiddenFiles.includes(file)
);
if (excludedInStatus.length) {
  fail(`Local-only files appeared in clasp status: ${excludedInStatus.join(', ')}.`);
}

console.log('Local clasp configuration and manifest checks passed.');
console.log('Read-only clasp status verified the audited upload allowlist:');
for (const file of normalizedFiles) console.log(`- ${file}`);
console.log('Excluded local-only tests, docs, packages, helpers, Git metadata, and Power BI files are absent from clasp status.');
