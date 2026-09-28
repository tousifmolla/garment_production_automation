/*
 * Consolidated local verification for Phases 1–3.
 * Run: node tests/run-all.js
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const commands = [
  ['node', ['tests/phase1-dry-run.js'], 'Behavioral and authorization dry run'],
  ['node', ['tests/phase4-dry-run.js'], 'Phase 4 workflow and task-management dry run'],
  ['node', ['tests/phase5-dry-run.js'], 'Phase 5 deadline-monitoring and alert-engine dry run'],
  ['node', ['tests/phase6-dry-run.js'], 'Phase 6 department-operational dashboard dry run'],
  ['node', ['tests/phase7-dry-run.js'], 'Phase 7 notification-system dry run'],
  ['node', ['tests/phase8-dry-run.js'], 'Phase 8 administration and settings dry run'],
  ['node', ['tests/phase9-dry-run.js'], 'Phase 9 reporting-layer dry run'],
  ['node', ['tests/phase10-dry-run.js'], 'Phase 10 Power BI model dry run'],
  ['node', ['tests/phase12-dry-run.js'], 'Phase 12 production-hardening dry run'],
  ['node', ['tests/project-audit.js'], 'Final deployment-source project audit'],
  ['node', ['tests/dashboard-static-check.js'], 'Dashboard template static check'],
  ['node', ['tests/phase6-static-check.js'], 'Department dashboard static check'],
  ['powershell', ['-NoProfile', '-Command', "$clientScript = (Get-Content -Raw JS.html) -replace '(?s)^\\s*<script>\\s*', '' -replace '(?s)\\s*</script>\\s*$', ''; $clientScript | node --check -"], 'Client JavaScript syntax check'],
  ['powershell', ['-NoProfile', '-Command', 'Get-Content -Raw Code.gs,Config.gs,Utils.gs,Database.gs,Setup.gs,Auth.gs,Users.gs,Notifications.gs,Dashboard.gs,Orders.gs,Workflow.gs,Tasks.gs,Alerts.gs,DepartmentDashboardServer.gs,AdminManagement.gs,Integration.gs,Operations.gs,Reporting.gs,Tests.gs | node --check -'], 'Apps Script server syntax check'],
  ['powershell', ['-NoProfile', '-Command', 'Get-Content -Raw appsscript.json | ConvertFrom-Json | Out-Null'], 'Apps Script manifest check'],
  ['git', ['diff', '--check'], 'Whitespace check']
];

for (const [command, args, label] of commands) {
  process.stdout.write('\n→ ' + label + '\n');
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', shell: false });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.status !== 0) {
    process.stderr.write('FAILED: ' + label + '\n');
    process.exit(result.status || 1);
  }
}

console.log('\nAll local tests passed.');
