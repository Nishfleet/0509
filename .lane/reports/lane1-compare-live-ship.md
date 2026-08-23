# Lane evidence: lane1-compare-live-ship

Item: `83159b377f` — ship compare pages live.

## Investigation

### Live state (pre-fix)

| URL | HTTP | Marker |
|-----|------|--------|
| /compare/visualping | 404 | — |
| /compare/spyland | 404 | — |
| /compare/pulzifi | 404 | — |
| /compare/foreplay | 404 | — |
| /compare/meta-ad-library | 200 | ok |

Compare routes merged in PR #897 on `fab8e262`; production deploy blocked ~30h.

### Dispatch run #32628708292 (fab8e262)

Failed in **Generate D1 remote restore evidence**, not Deploy Worker tests.

```
source_backup_migration_ledger_stale
```

Production ledger: `…0074`, `0075_teams_delivery`, `0076_browser_job_telemetry` (no competitor migration).

Repository expected: `…0074`, `0075_competitor_site_monitoring`, `0075_teams_delivery`, `0076_browser_job_telemetry`.

Root cause: `0075_teams_delivery` applied on production before `0075_competitor_site_monitoring.sql` existed in the repo — append-only ledger fork.

Prior run #32542387000 failed on `landing-page-signals` timing flake; PR #898 (`fab8e262`) already raised the `smallDuration` floor to 0.5ms on main.

## Fix

1. Renumber `0075_competitor_site_monitoring.sql` → `0077_competitor_site_monitoring.sql` so production prefix matches repo.
2. Add `0077_competitor_site_monitoring.sql` to `POST_DEPLOY_CLEANUP_MIGRATIONS` so restore evidence and deploy sync allow it to trail until remote apply.

## Local proof

```
npx vitest run tests/d1-migration-sync-check.test.ts tests/d1-remote-restore-evidence.test.ts tests/competitor-site-monitoring-migration.test.ts tests/competitor-site-monitor.server.test.ts
→ 77 passed
```

## Next step after merge

Re-dispatch `deploy-production.yml` via `scripts/dispatch-deploy-production.sh`, then curl-verify all five compare URLs return 200 with title markers.
