# Phase 11 integration test checklist

Use a new, non-production spreadsheet first. Make a copy before every destructive or concurrency scenario; never delete production data during tests.

| ID | Area | Preconditions | Steps | Expected result | Actual | Pass/Fail | Notes |
|---|---|---|---|---|---|---|---|
| I-01 | Clean bound spreadsheet | Run `initializeSystem()` twice | Canonical tabs/headers/defaults created; no duplicated seed data | | | |
| I-02 | Active admin bootstrapped | Deploy Web App; open as admin | Admin dashboard and Create order work | | | |
| I-03 | Active department user | Open deployment as department user | Only own task/alert data appears; other-department calls denied | | | |
| I-04 | Test order quantity 500 | Complete six stages in order | One next task activates each time; history/audit/notifications written; order completes | | | |
| I-05 | Partial completion enabled | Purchase 500; Cutting 300 | Rule-driven next-stage quantity; no double count | | | |
| I-06 | Short task deadline | Run `monitorDeadlines()` twice, then complete | Yellow/red alerts once, dashboards show them, alert resolves | | | |
| I-07 | Valid/invalid recipients | Run `processPendingNotifications()` with email enabled/disabled | Valid mail arrives; failure/invalid recipient does not affect task completion | | | |
| I-08 | Admin | Run `setupTriggers()` twice | Exactly one trigger per handler | | | |
| I-09 | Two signed-in users | Submit completion concurrently for one task | One completion/transition only; no duplicate task/ID/notification | | | |
| I-10 | Operational data | Run `rebuildReportingData()` | Derived sheets rebuild; source records unchanged; keys unique | | | |
| I-11 | Power BI Desktop | Connect using approved authenticated method | Types/keys/relationships load; no public sharing used | | | |
