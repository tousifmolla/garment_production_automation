# Garment Production Automation v1.0 Go-Live Checklist

This release-closeout checklist records the accepted production evidence. It is not a substitute for the routine checks in the operations runbook.

- [x] Admin web app accepted.
- [x] Department dashboards and department isolation accepted.
- [x] Six-stage workflow completed end-to-end.
- [x] Orders, tasks, quantities, statuses, TaskHistory, and AuditLog validated.
- [x] Alerts, notifications, and scheduled triggers validated.
- [x] Reporting certification passed.
- [x] Backup and isolated recovery test passed.
- [x] Power BI connection and Executive Dashboard accepted.
- [x] Executive baseline KPIs confirmed: Total Orders 2; Completed Orders 1; Active Orders 1; Production Quantity 20; Completed Quantity 10; WIP Quantity 10.

## Release controls

- Do not change Production orders, users, workflow configuration, triggers, or recovery configuration as part of the v1.0 freeze.
- Record post-launch defects and enhancement requests in the v1.1 backlog.
- Before any future release, run the local suite and deployment preflight, then repeat only the relevant controlled live acceptance checks.
