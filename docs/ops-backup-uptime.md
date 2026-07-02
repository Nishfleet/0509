# Ops: Backups, Uptime, Billing Portal

## D1 backup posture

- `npm run backup:d1:r2` is the owner-operated backup command. It exports the remote D1 database (`0509`) to `backups/d1/<timestamp>.sql` and uploads it to the R2 bucket under `backups/d1/` when production auth is available.
- The repository validation gate is `node scripts/validate-d1-backup.mjs`. It dry-runs backup-script prerequisites, the D1 binding, and the current migration chain through the latest migration; it does not prove that a fresh production R2 object exists.
- `.github/workflows/d1-backup-r2.yml` schedules the same D1-to-R2 backup weekly at 22:17 UTC Sunday (03:47 IST Monday) and can be run manually from GitHub Actions. It requires repository secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`; those secret names were not listed by `gh secret list` on 2026-06-28, so the first scheduled Actions run is still unproven.
- Cloudflare documents that D1 export blocks other database requests while it runs. Keep this schedule in a low-traffic window and move it if real customer traffic shows a better quiet period.
- Manual run any time: `D1_BACKUP_MANUAL_APPROVED=0509-manual-d1-export npm run backup:d1:r2` from the repo root (wrangler OAuth session and R2 access must be available). This marker is the script's explicit confirmation for a production-blocking remote D1 export; unapproved manual runs fail before Wrangler starts.
- Backup command output redacts temporary signed export URL query strings before logging.

### Backup evidence

- 2026-06-27 release backup before `0060`: timestamped object under the private R2 backup prefix confirmed.
- 2026-06-28 post-cleanup backup after `0060`: timestamped object under the private R2 backup prefix confirmed.
- The post-cleanup backup passed an isolated local SQLite import smoke; aggregate schema, migration-ledger, plan, Dodo linkage, and retired-provider invariants passed.
- A remote scratch D1 restore attempt was intentionally isolated from production but hit `SQLITE_TOOBIG` on large exported insert statements. Production-like D1 rebuild is not proven until the export is split/transformed into D1-importable statements and restored into a scratch D1 database.

### Post-deploy D1 cleanup evidence

For the `0060_remove_legacy_billing_provider.sql` cleanup, collect aggregate-only evidence before and after applying the migration. These commands do not print user IDs, customer IDs, payment IDs, or webhook payloads:

```bash
SAFE_DEPLOY_APPROVED=d1 npm run d1:cleanup-0060:evidence -- --remote --stage pre
SAFE_DEPLOY_APPROVED=d1 npm run d1:cleanup-0060:evidence -- --remote --stage post
```

Use the pre output before applying `0060`; use the post output after `0060` to confirm `user_plan` row counts match, legacy billing columns/table are gone, and Dodo linkage rows remain.
The post command exits non-zero if legacy billing columns or the retired-provider webhook table are still present.

### Restore drill

```bash
RESTORE_DIR="$(mktemp -d -t 0509-restore.XXXXXX)"
trap 'rm -rf "$RESTORE_DIR"' EXIT
npx wrangler r2 object get 0509-landing-page-artifacts/backups/d1/<file>.sql --file "$RESTORE_DIR/restore.sql" --remote
# Inspect restore.sql, then apply to an isolated local SQLite database:
sqlite3 "$RESTORE_DIR/restore.sqlite" < "$RESTORE_DIR/restore.sql"
sqlite3 "$RESTORE_DIR/restore.sqlite" "PRAGMA integrity_check;"
sqlite3 "$RESTORE_DIR/restore.sqlite" "PRAGMA foreign_key_check;"

# Optional remote D1 scratch drill, only after splitting too-large statements:
npx wrangler d1 create 0509-restore-test
npx wrangler d1 execute 0509-restore-test --remote --file "$RESTORE_DIR/restore.sql"
```

Never execute a restore file against the production `0509` database without
Nish's explicit go-ahead.

## Uptime monitoring

### Repo-configured GitHub health workflow

`.github/workflows/uptime-health.yml` checks `https://0509.io/api/health`
on an offset five-minute schedule and can be run manually from GitHub Actions.
It uses no secrets or private canary tokens. The check passes only when the endpoint
returns HTTP 200 JSON with `status: "ok"` and `app: "0509"`.

GitHub documents 5 minutes as the shortest scheduled workflow interval, with
scheduled workflows running on the latest default-branch commit. GitHub also
routes scheduled-workflow notifications based on the workflow creator or the
user who last changes the cron schedule. Because of that, this repo-configured
check is not fully proven until an owner/operator confirms:

1. Done: the workflow exists on `main`.
2. Done: manual run `28540913266` passed.
3. A scheduled run appears at roughly the configured cadence.
4. Failed-run notifications reach the intended inbox.

### Independent external monitor option

Cloudflare has no free externally-initiated health checks, and a Worker
can't reliably monitor itself. Recommended: [UptimeRobot](https://uptimerobot.com)
free tier —

1. Create a free account (no card).
2. Add an HTTP(s) monitor for `https://0509.io/api/health`, interval 5 min.
3. Add a keyword check that the response contains `ok` (the health endpoint
   returns JSON with a `status` field).
4. Alert contact: nishant345@gmail.com (or me@inish.in).

The endpoint is public and unauthenticated by design. It does **not** query D1 — a database blip should not flip the external monitor while the Worker edge is healthy.

### Owner verification (no API token)

This stronger independent gate cannot be automated from the repo without an UptimeRobot API key. Nish verifies manually:

1. Sign in to the [UptimeRobot dashboard](https://uptimerobot.com/dashboard).
2. Confirm a monitor named for 0509 (or similar) targets **`https://0509.io/api/health`**.
3. Interval: **5 minutes**; monitor type: HTTP(s) with keyword **`ok`** in response body.
4. Open the monitor → **Response times** — the latest check should be **Up** (green) within the last 5 minutes.
5. Optional smoke: pause the monitor for one interval, confirm the alert email arrives, then resume.
6. From any machine: `curl -fsS https://0509.io/api/health` should print JSON with `"status":"ok"` and HTTP 200.
7. Record the verification date in `docs/ga-launch-scorecard.md` (Ops readiness / UptimeRobot row).

If sign-up is undesirable, the fallback is a health-ping cron inside the
`0509-support-inbox` Worker (it has an EMAIL send binding) — that repo had
uncommitted local changes on 2026-06-12, so the cron was deliberately not
added; revisit once that working tree is clean.

## Dodo billing — plan switching and portal cancellation (needs smoke)

The customer portal button on `/app/billing` opens Dodo's hosted portal.
Plan switching is now handled from the in-app billing cards through Dodo's
documented subscription plan-change preview/change endpoints:

1. Done: the live Scout/Starter monthly and annual products are grouped in the Five to Nine Product Collection.
2. After deploy, use an internal linked paid subscription to switch Scout/Starter or monthly/annual from `/app/billing`.
3. Confirm Dodo sends the signed webhook and the account updates.
4. Separately confirm cancellation remains available from hosted portal subscription details.

Until those are verified, customers can use in-app plan switching and the hosted
portal for card/invoice tasks, while support remains the fallback for exceptions
and cancellation questions.
