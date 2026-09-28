# Disaster recovery

## Controlled backup and recovery-test process

Set these Script Properties in the bound Production Apps Script project:

- `GARMENT_BACKUP_FOLDER_ID` — a dedicated Google Drive folder for system backups.
- `GARMENT_BACKUP_RETENTION_COUNT` — positive whole-number count of tagged backups to keep.
- `GARMENT_RECOVERY_TEST_SPREADSHEET_ID` — a separate, non-Production spreadsheet used only for restore testing.

Run `verifyBackupRecoveryReadiness()` as an active administrator. It is read-only and must return `success: true`. Then run `backupSystemData()` to create a timestamped backup in the configured folder. Only files tagged by this application for the current Production spreadsheet are archived by retention; unrelated Drive files are never selected.

Run `runRecoveryTest()` only after readiness passes. It refuses the Production spreadsheet as a target, restores the newest tagged backup only into the configured recovery-test spreadsheet, and validates schemas, row counts, IDs, relationships, statuses, quantities, timestamps, and record values. It never writes into the Production spreadsheet.

For a real incident: stop writes, capture a fresh backup, identify the last known-good copy/version, and obtain explicit approval before any Production restoration. Code rollback and data restore are separate operations.
