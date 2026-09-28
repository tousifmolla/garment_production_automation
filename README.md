# Garment Production Automation System

**Version 1.0 · Google Apps Script · Google Sheets · Power BI**

A spreadsheet-backed garment production management application covering the workflow from purchase through selling. It provides an administrator web app, department-specific task dashboards, order and quantity tracking, deadline alerts, notifications, audit history, reporting datasets, and backup/recovery controls.

Version 1.0 is recorded as a production-ready release freeze dated 2 September 2026. See [release status](VERSION.md), [changelog](CHANGELOG.md), and [go-live acceptance checklist](GO_LIVE_CHECKLIST.md). This repository contains source code and documentation; deploying it requires your own Google Sheets and Apps Script configuration.

## Features

- **Six-stage workflow:** Purchase → Cutting → Stitching/Making → Finishing → Packaging → Selling.
- **Role-based access:** administrator operations and server-enforced department isolation.
- **Orders and tasks:** configured stage creation, task status transitions, quantity tracking, task history, and audit records.
- **Operational dashboards:** administrator KPIs and department-scoped queues with filtering and deadline indicators.
- **Alerts and notifications:** overdue, blocked, and delivery-risk detection; recipient-specific dashboard notices and optional email processing.
- **Administration:** departments, products, customers, workflow configuration, and typed settings.
- **Reporting and recovery:** rebuildable reporting sheets, Power BI model guidance, backup/retention controls, and isolated recovery checks.

## Technology stack

| Layer | Technology |
| --- | --- |
| Web interface | HTML, CSS, JavaScript; Apps Script HTML Service |
| Backend and authorization | Google Apps Script (`.gs` modules) |
| Operational storage | Google Sheets |
| Reporting | Derived Sheets tabs, Power BI, DAX |
| Local tooling and tests | Node.js, npm, clasp |

## Architecture

```text
Admin / Department web app
            |
     Apps Script server
            |
 Authorization + configuration
            |
 Orders / tasks / workflow
 Alerts / notifications / audit
            |
 Google Sheets operational data
            |
 Derived reporting tabs → Power BI
```

`Config.gs` centralizes sheet schemas, roles, statuses, IDs, and configuration. Operational records use stable IDs; `Tasks` is a production fact source and `TaskHistory` records task events. For further details, see [Architecture](docs/ARCHITECTURE.md).

## Screenshots and presentation

[View the project presentation](Garment%20Production%20Automation%20-%20Project%20Presentation.pptx) or browse the [slide images](Garment%20Production%20Automation%20-%20Project%20Presentation/).

![Project presentation overview](Garment%20Production%20Automation%20-%20Project%20Presentation/slide-1.png)

## Getting started

1. Create a Google Sheet and open **Extensions → Apps Script** to use a spreadsheet-bound script.
2. Add the repository's root `.gs` and `.html` files and `appsscript.json`, or configure `clasp` following the [clasp deployment guide](docs/CLASP-DEPLOYMENT.md). Do not commit your local `.clasp.json`.
3. Run `initializeSystem()` once and grant the required permissions. It is designed to preserve populated sheets and reject unexpected schema changes on rerun.
4. Run `testPhase1Installation()` to check initial departments and workflow configuration.
5. Run `bootstrapInitialAdmin()` once, signed in as the intended administrator, while the `Users` sheet is empty.
6. Configure authorized users, deployment access, and operational triggers according to the [deployment checklist](docs/DEPLOYMENT-CHECKLIST.md) and [operations runbook](docs/OPERATIONS-RUNBOOK.md).

For a standalone rather than spreadsheet-bound script, set the Script Property `GARMENT_PRODUCTION_SPREADSHEET_ID` to the target spreadsheet ID. **Do not run initialization, bootstrap, or deployment commands against an existing production spreadsheet without reviewing the deployment guidance and backup state.**

### Local checks

```bash
npm install
node tests/phase1-dry-run.js
node tests/run-all.js
npm run deploy:check
```

The Node.js tests include an in-memory Apps Script/Sheets emulator and static/behavioral checks. They do not replace authorized live deployment and recovery acceptance testing. The deployment preflight requires valid local clasp configuration; see [clasp deployment workflow](docs/CLASP-DEPLOYMENT.md).

## Reporting

The operational Sheets feed derived reporting data for Power BI. Version 1.0 includes the accepted **Executive Dashboard baseline KPIs**. Additional Production Tracking, Department Performance, Delivery Performance, and Cycle Time/Bottlenecks pages are planned for v1.1; they are not claimed as delivered here. See [Power BI guide](powerbi/POWER_BI_GUIDE.md), [core DAX measures](powerbi/CoreMeasures.dax), and [post-launch plan](POST_LAUNCH_PLAN.md).

## Security and deployment considerations

Authorization is checked server-side, not inferred from a selected browser department. Deploy to an appropriately authenticated Google audience and register user email addresses in the `Users` sheet. Active-user email availability depends on Google account type and Apps Script execution/deployment mode; missing identity is handled by denying access. Keep Script IDs, credentials, customer data, and production spreadsheet contents out of public commits. Review [production deployment](docs/PRODUCTION-DEPLOYMENT.md) and [disaster recovery](docs/DISASTER-RECOVERY.md) before live use.

## Documentation

- [Version and release scope](VERSION.md) · [Changelog](CHANGELOG.md)
- [Go-live checklist](GO_LIVE_CHECKLIST.md) · [Post-launch backlog](POST_LAUNCH_PLAN.md)
- [Architecture](docs/ARCHITECTURE.md) · [Deployment checklist](docs/DEPLOYMENT-CHECKLIST.md)
- [Operations runbook](docs/OPERATIONS-RUNBOOK.md) · [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Disaster recovery](docs/DISASTER-RECOVERY.md) · [Power BI guide](powerbi/POWER_BI_GUIDE.md)
