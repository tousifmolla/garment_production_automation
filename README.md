# Garment Production Automation System

## Version 1.0 — production release

This repository contains the complete Version 1 Google Apps Script production system: configurable master data, authentication and department isolation, the six-stage workflow, Admin and department dashboards, alerts, notifications, reporting, backup/recovery controls, and Power BI-ready derived reporting tabs.

Release closeout and post-launch scope are recorded in [VERSION.md](VERSION.md), [CHANGELOG.md](CHANGELOG.md), [GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md), and [POST_LAUNCH_PLAN.md](POST_LAUNCH_PLAN.md).

### Architecture

`HTML UI (future) -> server modules -> data access -> Google Sheets`

Cross-cutting services—configuration, authorization, audit, alerts, notifications, and workflow—are isolated as separate Apps Script modules. `Config.gs` is the single source of truth for sheet names, statuses, roles, ID prefixes, and column headers. No other Phase 1 module embeds headers or column numbers.

### Data model

| Area | Sheets |
| --- | --- |
| Master data | Users, Departments, Products, Customers |
| Operational data | ProductionOrders, Tasks, TaskHistory |
| Workflow/control | WorkflowConfig, Settings |
| Operational events | Notifications, Alerts, AuditLog |
| Reporting | DashboardData |

All operational entities carry stable IDs. `Tasks` is the production fact source; `TaskHistory` is append-only event history. `DashboardData` is an intentionally narrow snapshot table for BI refreshes. This structure maps cleanly to Power BI facts (`ProductionOrders`, `Tasks`, `TaskHistory`, future sales data) and dimensions (Products, Customers, Departments, Users, Orders).

### Initial setup

1. Create a Google Sheet and open **Extensions → Apps Script**.
2. Add each `.gs` file and `appsscript.json` from this repository (or use `clasp push` if you have it configured).
3. Bind the script to that spreadsheet, then run `initializeSystem` once and authorize it.
4. Run `testPhase1Installation`; it should return six departments and six workflow steps.
5. To use a standalone script rather than a bound script, set the Script Property `GARMENT_PRODUCTION_SPREADSHEET_ID` to the target spreadsheet ID.

`initializeSystem()` is rerunnable. It preserves populated sheets and rejects unexpected header changes instead of overwriting data.

## Phase 2 delivered: authentication and roles

After Phase 1 initialization, run `bootstrapInitialAdmin()` once while signed in to the intended administrator Google account. It is intentionally allowed only while `Users` is empty. Administrators can then call `createUser`, `updateUser`, `deactivateUser`, and `listUsers`.

`Auth.gs` enforces the following server-side rules for upcoming modules: `requireAdmin_()` gates administrator actions, and `requireDepartmentAccess_(departmentId)` permits department users only for their assigned department. Every public operation added in later phases must call one of these guards before accessing or mutating data.

For production deployment, configure the web app to require sign-in from your Google Workspace domain. Apps Script consumer-account deployments can return a blank active-user email, in which case authentication deliberately fails safely.

## Phase 3 delivered: admin dashboard

`Dashboard.gs` builds the live dashboard model from the structured Sheets data and verifies the caller is an administrator before returning it. `Code.gs`, `Index.html`, `AdminDashboard.html`, `CSS.html`, and `JS.html` form a responsive Apps Script web-app shell with KPI cards, department status summary, unresolved alerts, and recent-order progress. The dashboard presents useful empty states until Phase 4 begins creating orders and Phase 5 begins creating tasks.

### Local dry run

Run `node tests/phase1-dry-run.js` from the project folder. The test uses a small in-memory Apps Script/Sheets emulator and verifies initialization, all 13 tabs, default seed data, safe reruns, basic CRUD, ID allocation, and schema-mismatch protection. It does not replace testing in a real authorized Google Apps Script deployment.

Run `node tests/run-all.js` for the complete local suite through Phase 4. It runs behavioral authorization/dashboard/workflow tests plus client and server syntax, manifest, template-wiring, responsive-rule, and whitespace checks.

## Phase 4 delivered: production workflow and task management

`Orders.gs` creates administrator-approved production orders and `Workflow.gs` turns each active workflow configuration step into a single task. The first stage is `READY`; all later stages are `PENDING`. `Tasks.gs` gives departments only their own tasks and provides guarded start, progress, hold, block, resume, cancel, complete, and overdue-refresh operations.

Task completion is atomic: it validates configured quantity rules, records task history and an audit record, activates the already-generated next task without duplication, and refreshes order progress. By default, every stage requires 100% of its planned quantity. When `PARTIAL_COMPLETION_ALLOWED` is enabled, the transferred partial quantity becomes the planned quantity of the following stage.

The web app now includes an admin order-creation dialog and a department task workspace. The department page automatically uses the signed-in user’s assigned department and exposes only server-authorized Start and Complete actions.

## Phase 5 delivered: deadline monitoring and alert engine

`Alerts.gs` evaluates active tasks every time `monitorDeadlines()` runs. It calculates remaining/delay hours, marks unfinished passed-deadline tasks `OVERDUE`, creates deduplicated YELLOW/RED/BLOCKED incidents, resolves obsolete incidents, and records alert audits. It also detects delivery-risk orders. Run `setupDeadlineMonitoringTrigger()` once as an active administrator to schedule monitoring every 15 minutes. The alert notification hook writes dashboard-notification intents to `Notifications` and is ready for a future email provider.

## Phase 6 delivered: reusable department operations dashboard

`DepartmentDashboardServer.gs` resolves the active user’s department on the server and returns its filtered task queue, KPIs, product/order context, deadline indicators, alert count, and pagination—never accepting a browser-selected department as authority. The shared department UI (`DepartmentDashboard.html`) provides search, status/priority/deadline filters, responsive KPI cards, alert-highlighted task rows, and workflow actions that refresh the dashboard after successful changes.

## Phase 7 delivered: notifications

`Notifications.gs` creates recipient-specific dashboard records and optional email-delivery records from active users and department membership. Workflow and alert events create deduplicated Task Ready, Started, Completed, Blocked, Overdue, Next Department, Order At Risk, and Order Completed notices. Users can read or acknowledge only their own dashboard records. `processPendingNotifications()` records email delivery failures without throwing, so production workflow integrity is never affected.

## Phase 8 delivered: administration and settings

`AdminManagement.gs` supplies administrator-only management for departments, products, customers, workflow configuration, and typed system settings. Master data is soft-deactivated to protect operational history. Department/workflow sequences are validated before save, every change is audited, and settings reads use short-lived script-cache entries which are invalidated immediately after an update.

### Phase 1 sheet schema

Exact headers are maintained programmatically in `Config.gs` through `getSheetSchemas_()`. This lets the next phases use field names rather than fragile column positions.

### Important deployment note

Google Workspace deployment and identity behavior varies by domain and web-app execution mode. In later phases, access must be set to an authenticated audience and user emails must be registered in `Users`; consumer accounts may not expose the active email address to Apps Script.
