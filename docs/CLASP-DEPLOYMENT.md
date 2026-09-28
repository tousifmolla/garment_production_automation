# clasp deployment workflow

## Scope and safety

This repository is linked only to the Apps Script project bound to **Garment Production Automation - Production**. `clasp push` changes Apps Script source files only; it does not create, delete, or edit spreadsheet data. However, it replaces the complete remote script source set, so always run the preflight first.

Do not run initialization, bootstrap, trigger, readiness, or deployment functions as part of this setup.

## One-time Google action

Open the Production spreadsheet and select **Extensions > Apps Script**. This opens (or, if needed, creates) the script project bound to that existing spreadsheet. In the Apps Script editor, open **Project Settings** and copy the **Script ID**. This action does not create another spreadsheet.

Enable the Apps Script API for the same Google account at https://script.google.com/home/usersettings before using clasp.

## Local setup

From the repository root:

```cmd
npm install
npm run gas:login
```

Create `.clasp.json` only after obtaining the real Script ID. In Windows CMD, replace the quoted value with the copied ID:

```cmd
echo {"scriptId":"PASTE_THE_REAL_BOUND_SCRIPT_ID_HERE","rootDir":"."}>.clasp.json
```

Never use a placeholder ID in a committed or active `.clasp.json`.
The file is intentionally Git-ignored because it identifies the production deployment target, but it remains available locally to clasp.

## Verify and push

```cmd
npm run deploy:check
npm run gas:status
npm run gas:push
```

`deploy:check` runs the full local test suite, validates the local clasp configuration and manifest, then performs read-only `clasp status`. Confirm that its upload list contains only root `.gs` files, root `.html` files, and `appsscript.json`.

`.claspignore` deny-lists everything by default and permits only those root source types. It excludes tests, documentation, Power BI assets, Node packages, Git metadata, helper scripts, and package files.

## Pull, status, and editor

```cmd
npm run gas:status
npm run gas:pull
npm run gas:open
```

Do not run `gas:pull` over uncommitted local production source without first reviewing differences or making a Git checkpoint, because pull updates local source files.

## Deployment versus source push

- `clasp push` uploads the current local source to the existing Apps Script project. It does **not** create a web-app release.
- An Apps Script version is an immutable snapshot of a project's source.
- A Web App deployment points to a specific version (or may be updated to a newer version). Update or create a deployment only after an explicit deployment decision and validation.

## Rollback

Use Git to restore the verified local source revision, run `npm run deploy:check`, and push it. For a previously deployed Web App version, use the Apps Script deployment management interface to point the deployment back to the known-good version. Do not use destructive commands such as `git reset --hard` for routine rollback.

## Common errors

- **Script API is disabled:** enable it at https://script.google.com/home/usersettings.
- **Not authorized:** rerun `npm run gas:login` with the Google account that owns or can edit the Production spreadsheet.
- **Wrong Script ID:** get the ID from the bound project's Project Settings, not the spreadsheet URL.
- **Unexpected upload list:** stop; inspect `.claspignore` and run `npm run gas:status` again.
- **Manifest conflict:** do not force-push. Compare the remote manifest first and preserve `webapp.executeAs` as `USER_ACCESSING` and signed-in `webapp.access` as `ANYONE` (never `ANYONE_ANONYMOUS`).
