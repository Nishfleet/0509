# Ops: Backups, Uptime, Billing Portal

## D1 backup posture

- `npm run backup:d1:r2` is the owner-operated backup command. It exports the remote D1 database (`0509`) to `$HOME/.local/state/0509/backups/d1/<timestamp>.sql` and uploads it to the R2 bucket under `backups/d1/` when production auth is available. Keeping retained copies outside the checkout prevents Actions cleanup from deleting them.
- The repository validation gate is `node scripts/validate-d1-backup.mjs`. It dry-runs backup-script prerequisites, the D1 binding, and the current migration chain through the latest migration; it does not prove that a fresh production R2 object exists.
- `.github/workflows/d1-backup-r2.yml` is the explicit backup-only fallback: it supports `workflow_dispatch`, runs only on protected `main`, uses the branch-restricted `production` GitHub Environment, validates with `node scripts/validate-d1-backup.mjs`, then runs `npm run backup:d1:r2` with `D1_BACKUP_AUTOMATION_APPROVED=0509-weekly-d1-to-r2`. Scheduled off-machine backups are produced by the restore-evidence workflow below, so a second independent export cron is intentionally disabled.
- **Unblocked 2026-07-13:** repository secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (scoped custom token: D1 Edit + Workers R2 Storage Edit) were added by the owner, and dispatch run `29225583866` completed the full validate → export → upload chain ("Upload complete. Backup complete.", fresh timestamped object under the private R2 backup prefix). Historical context: the former weekly backup-only cron produced runs `28339411098`, `28758345164`, and `29212868653` while the secrets were missing; that redundant cron is now retired in favor of the scheduled restore-evidence proof.
- **Mac-side scheduled backup (the currently-live automated path):** a Claude scheduled task `0509-weekly-d1-backup` on Nish's Mac runs the manual-approved backup weekly (Sunday mornings, local). Caveat found 2026-07-13: its runs on 2026-07-05/12 silently produced no artifact because the task prompt predated the `D1_BACKUP_MANUAL_APPROVED` interlock; the prompt now sets the marker and verifies a fresh `$HOME/.local/state/0509/backups/d1/` file plus `validate-d1-backup.mjs` before reporting success. This path depends on the Mac being awake/app open — the Actions path above remains the wanted off-machine redundancy.
- Cloudflare documents that D1 export blocks other database requests while it runs. Keep this schedule in a low-traffic window and move it if real customer traffic shows a better quiet period.
- Manual run any time: `D1_BACKUP_MANUAL_APPROVED=0509-manual-d1-export npm run backup:d1:r2` from the repo root (wrangler OAuth session and R2 access must be available). This marker is the script's explicit confirmation for a production-blocking remote D1 export; unapproved manual runs fail before Wrangler starts.
- Backup command output redacts temporary signed export URL query strings before logging.

### Hardened runner routing

The VPS runner fleet uses immutable labels instead of repository-variable
fallbacks:

- `vps-verify`: three isolated, no-sudo verification runners. GitHub assigns
  each waiting job to the first matching idle runner; the repository lock
  provides three FIFO heavy-work slots and makes a fourth contender wait.

The three verification units use distinct non-login accounts, a capped
`github-0509.slice` and `github-0509-verify.slice`, and the root-created lock
state under `/run/lock/0509`. They cannot read
`/home/nish`, use passwordless sudo, or inherit the interactive Claude, Codex,
Hermes, or GitHub operator credentials. Privileged backup, restore, finalization,
production deployment, and public uptime jobs use fresh GitHub-hosted machines;
no repository-level VPS runner is eligible to receive production secrets or
trusted operational work.

Do not restore runner-variable fallback expressions or add trusted jobs to the
repository-level self-hosted fleet.
An outage should queue visibly rather than silently moving protected work to a
different trust boundary. For emergency recovery, repair or deliberately
replace the matching hardened label and run the read-only
`runner-hardening-proof.yml` workflow before resuming provider work.

The 2026-07-26 weekly backup failed because the GitHub-hosted minutes were exhausted. Verify and record the next successful weekly backup run.

### VPS-assisted remote restore evidence

The `D1 remote restore evidence` workflow performs the restore drill on the
GitHub-hosted runner during explicit low-traffic recovery windows (Monday and
Thursday at 02:17 IST) or by manual dispatch. It reuses the protected
branch-restricted `production` environment so provider credentials are not
available as repository-level secrets or to pull-request jobs.
The workflow creates a fresh D1 export, uploads it to private R2,
download that exact R2 object, restore it into a run-scoped scratch D1 database,
compare schema, key-bearing content digests, migration ledger, and aggregates
through a full exported round trip, then delete the exact scratch database.
The backup child records its exact local path and R2 key in a private
run-temporary manifest before export. The drill validates that ownership record
and deletes only that exact local production SQL export, including on child
failure; private R2 remains the durable backup, so persistent self-hosted
workspaces do not accumulate additional plaintext dumps from restore drills.
If the drill process is hard-killed before its `finally` block, the independent
cleanup job performs a clean checkout, removes every strict temp directory for
the current workflow run, and
sweeps strict temp directories older than 24 hours for runner/host recovery.
An independent `if: always()` cleanup job deletes every
`0509-restore-test-<current-run>-<attempt>` database after the restore job,
including scratch databases left by an earlier failed attempt of the same
workflow run. It also removes only strictly run-scoped
`0509-restore-test-<run>-<attempt>` databases older than 24 hours, so a canceled
or lost-runner drill cannot leave production data parked. Mandatory provider
list/delete operations retry three times with bounded backoff; exhausted
cleanup failures remain deploy-blocking.

Production deploys never export D1 or create scratch databases in their
unprivileged preparation job, and the deploy itself still performs no restore
mutation. The unprivileged preparation job downloads and verifies the newest
private restore-evidence artifact from the preceding eight days. Code-only
deploys can reuse a verified drill for the full 14-day freshness bound while
the Wrangler configuration hash and migration ledger still match. A
migration-bearing deploy or any change to restore workflows, scripts, runtime
dependencies, or Wrangler configuration requires candidate-bound evidence that
matches the pinned candidate exactly.
If no matching artifact exists, the deploy no longer blocks waiting for a
separate workflow: a `Generate D1 remote restore evidence` job in the deploy
workflow performs the same fresh backup + isolated remote restore drill as the
`D1 remote restore evidence` workflow, on a fresh GitHub-hosted machine under
the same protected `production` environment, and publishes the evidence for the
deploy job's exact verifier. An independent `if: always()` cleanup job then
deletes every run-scoped scratch database, including any left by a hard-killed
generation attempt. Only when that generated evidence passes the same exact
verifier does the protected deploy job proceed; a failed drill or a failed
cleanup still blocks the deploy. The nightly drill remains the primary
evidence source, so the first deploy of a new migration-bearing or
restore-critical main commit is the only one that normally pays for fresh
generation.
Already-applied migration files are immutable: modifying or deleting one
relative to the last successful production deploy blocks preparation instead
of allowing a fresh drill to certify the old production ledger by filename.
Preparation inspects every first-parent commit in that range, so a migration
added and then edited after a failed deploy is also blocked even when its final
range status is still `A`.
Each successful preparation republishes the validated evidence as an eight-day
permission-preserving private artifact, so the fast path survives across
workflow runs without rotating a GitHub secret. Claude on the VPS needs only
GitHub workflow-dispatch access to request a recovery-window drill; Cloudflare
credentials stay inside the protected recovery environment.
Artifact lookup distinguishes "none found" from GitHub/API infrastructure
failure: absence is no longer a release stop (the deploy generates fresh exact
evidence), while infrastructure errors retry three times and then fail loudly.
Artifact download failures follow the same three-attempt, fail-loud contract.
A runner without the GitHub CLI, or a downloaded artifact that fails content
validation, is discarded and replaced by fresh generated evidence rather than
touching production D1 with unproven state.
Deploy preparation requires 12 hours of freshness headroom before accepting
reused evidence. This covers the bounded cleanup and deploy-job windows while
the deploy plan still re-checks freshness against real wall-clock time before
any production mutation, without consuming the full 24-hour lifetime of
migration-bearing evidence.

The shared backup command retries the R2 upload four times with bounded
backoff. D1 exports retry up to 16 times with delay capped at five minutes
(52.5 minutes of total backoff), so an export already running for the weekly
backup or a recovery-window drill can finish without causing a false workflow
failure. Every attempt uses one stable timestamped local path and exact R2 key,
so overlap cannot create ambiguous fresh-backup identities. This avoids GitHub
concurrency groups that can cancel an older pending deploy.
When the backup command runs in manifest-owned drill mode, it skips normal
local retention pruning. The drill later removes only its newly created export,
leaving the pre-existing retained set unchanged.
The backup and remote-restore jobs allow 300 minutes, leaving room
for setup plus the bounded export, import, round-trip export, verification, and
retry phases. Independent cleanup jobs allow 120 minutes so multiple exact
scratch deletions can be attempted even when one provider call is slow.
The restore drill permits a single long provider command, including the exact
R2 backup download, to run for up to 240 minutes; the enclosing 300-minute
Actions job remains the fail-closed cap for the full drill.

Restore imports default to a 256 MiB SQL safety ceiling. If a valid production
export grows beyond that limit, set the repository variable
`D1_REMOTE_RESTORE_MAX_SQL_BYTES` to an explicit byte count between 16 MiB and
480 MiB, rerun the workflow, and review runner memory before retaining the
higher limit. The workflow checks every export's file size before allocating a
UTF-8 string, including the scratch round-trip export.
The local baseline imports the untouched R2 SQL; only the scratch restore uses
the statement-size transformer. Schema and content digests therefore detect a
lossy transformer regression instead of comparing two transformed copies.

The GitHub `production` environment token used by the backup and restore workflows must be
able to export, create, execute against, and delete D1 databases, and read/write
objects in the private backup R2 bucket. These capabilities are broader than a
Worker-deploy-only token; missing capability fails the protected drill before
an artifact is published.

### Owner actions to unblock Actions backups

1. Add repository secrets (or secrets on the `d1-backup-r2` GitHub Environment): `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (token needs D1 export/create/execute/delete + R2 read/write on the backup bucket).
2. Confirm the GitHub Environment named `d1-backup-r2` exists for this repo.
3. From Actions → **D1 backup to R2** → **Run workflow** on `main` (`workflow_dispatch`) and confirm the job uploads a fresh object under the private R2 `backups/d1/` prefix.

### Backup evidence

- 2026-06-27 release backup before `0060`: timestamped object under the private R2 backup prefix confirmed.
- 2026-06-28 post-cleanup backup after `0060`: timestamped object under the private R2 backup prefix confirmed.
- The post-cleanup backup passed an isolated local SQLite import smoke; aggregate schema, migration-ledger, plan, Dodo linkage, and retired-provider invariants passed.
- 2026-07-02 owner-operated manual backup: `D1_BACKUP_MANUAL_APPROVED=0509-manual-d1-export npm run backup:d1:r2` exported remote D1, uploaded a fresh object under the private R2 backup prefix, and pruned only old local backup copies. `node scripts/validate-d1-backup.mjs` passed afterward through migration `0062_dodo_plan_change_pending_target.sql`.
- 2026-06-28 scheduled GitHub Actions backup run `28339411098` reached `node scripts/validate-d1-backup.mjs`, then failed at `Run approved D1-to-R2 backup` because the required Cloudflare repository secrets were not configured — the same failure repeated on `28758345164` (2026-07-05) and `29212868653` (2026-07-12) before the secrets were added.
- 2026-07-13 GitHub Actions dispatch run `29225583866`: first successful Actions backup end-to-end — validation passed, remote D1 exported (15.7 MB), fresh timestamped object uploaded under the private R2 backup prefix. Actions backups are proven; the weekly schedule now runs off-machine.
- 2026-07-13 operator-run manual backup: exported remote D1 (15.7 MB) and uploaded a fresh timestamped object under the private R2 backup prefix; `node scripts/validate-d1-backup.mjs` passed through migration `0065_watchlist_active_partial_index.sql` (migration replay + Dodo linkage preserved).
- A remote scratch D1 restore attempt was intentionally isolated from production but hit `SQLITE_TOOBIG`: 12 single-row inserts in the 2026-07-13 export exceeded D1's documented 100,000-byte statement limit (maximum 395,537 bytes). `npm run restore:d1:transform -- <source.sql> --output <restore.sql>` now rewrites only supported oversized string literals into explicit-primary-key append statements, defaults to 90,000 bytes for headroom, and fails closed on unsupported SQL. The real 15.7 MB export transformed to a maximum 90,000-byte statement and matched the original local restore's integrity, foreign-key result, migration ledger, five plan rows, and five Dodo-linked rows. A remote scratch-D1 import is still required before production-like restore is `verified`.
- 2026-08-25 restore-order failure: every `D1 remote restore evidence` drill and every deploy-production `Generate D1 remote restore evidence` job failed importing the production dump into its scratch D1 with `{"error":{"text":"no such table: main.event_candidate: SQLITE_ERROR"}}` (failed runs 32822047118, 32822722001, 32823458044, 32824157358, 32825192602); no deploy reached `Deploy Worker` from 07:31Z until the fix landed. Root cause: a D1 export walks `sqlite_master` in creation order and emits each table immediately followed by its rows, and `migrations/0077_competitor_site_monitoring.sql` (reached production 2026-08-25 07:28:30) rebuilt `watch_event` — which has `FOREIGN KEY (candidate_id) REFERENCES event_candidate(id)` — before it rebuilt `event_candidate`; a table rebuild moves the rebuilt table to the end of creation order, so from the next export on `INSERT INTO "watch_event"` was emitted before `CREATE TABLE "event_candidate"`. SQLite resolves a foreign key's parent table when the row is written, so with foreign keys enforced the INSERT fails; D1 enforces them on import, while `sqlite3` and `node:sqlite` default to `foreign_keys = OFF`, which is why the same dump restored locally without error and only D1 went red (`PRAGMA defer_foreign_keys=TRUE`, which the export emits, defers constraint violations to commit and cannot conjure a missing table). Fix: [PR #1013](https://github.com/Nishfleet/0509/pull/1013) — `transformD1RestoreSql` in `scripts/d1-restore-transform.mjs` now hoists every `CREATE TABLE` ahead of the rows (leading PRAGMAs stay first, order preserved within each group), so a restore no longer depends on table creation order; a regression test in `tests/d1-restore-transform.test.ts` runs the failing shape under `PRAGMA foreign_keys = ON`. The backup itself was never incomplete: the `2026-08-25T07-58-41-773Z` export contained all 88 user tables and every row (the only table absent is `_cf_KV`, Cloudflare's internal D1 table, excluded from exports by design), and restored counts matched production exactly — 958 `event_candidate` rows, 1046 `watch_event` rows, 87 migrations, latest `0077`.

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
# Inspect the source, then create a fail-closed D1-sized restore file. Cloudflare
# limits each SQL statement to 100,000 bytes even when the whole import is below
# the 5 GB import-file limit. The transform also hoists every CREATE TABLE ahead
# of the row inserts (2026-08-25 restore-order incident above); importing a raw
# R2 dump straight into D1 with `wrangler d1 execute --file` skips that and
# still fails when a rebuilt parent table sorts after its child's rows.
npm run restore:d1:transform -- "$RESTORE_DIR/restore.sql" --output "$RESTORE_DIR/restore-d1.sql"

# Apply the transformed file to an isolated local SQLite database:
sqlite3 "$RESTORE_DIR/restore.sqlite" < "$RESTORE_DIR/restore-d1.sql"
sqlite3 "$RESTORE_DIR/restore.sqlite" "PRAGMA integrity_check;"
sqlite3 "$RESTORE_DIR/restore.sqlite" "PRAGMA foreign_key_check;"
sqlite3 "$RESTORE_DIR/restore.sqlite" "SELECT COUNT(*), MIN(id), MAX(id), MAX(name) FROM d1_migrations;"
sqlite3 "$RESTORE_DIR/restore.sqlite" "SELECT COUNT(*), SUM(dodo_payment_id IS NOT NULL OR dodo_subscription_id IS NOT NULL OR dodo_customer_id IS NOT NULL) FROM user_plan;"

# Remote scratch drill: use only an explicitly authorized isolated database,
# record aggregate results privately, and delete the scratch resource afterward.
npx wrangler d1 create 0509-restore-test
npx wrangler d1 execute 0509-restore-test --remote --file "$RESTORE_DIR/restore-d1.sql"
# Repeat the integrity, foreign-key, migration-ledger, plan-row, Dodo-linkage,
# and representative row-count queries against 0509-restore-test.
```

Never execute a restore file against the production `0509` database without
Nish's explicit go-ahead.

## Uptime monitoring

### Repo-configured GitHub health workflow

`.github/workflows/uptime-health.yml` checks `https://0509.io/api/health`
on an offset five-minute schedule and can be run manually from GitHub Actions.
It uses no secrets or private canary tokens. The check passes only when the endpoint
returns HTTP 200 JSON with `status: "ok"` and `app: "0509"`.

Since 2026-07-13 the same run also probes `https://0509.io/api/health/deep`
(a `SELECT 1` against D1) and fails unless it returns HTTP 200 with
`checks.d1: "ok"` — so a sustained D1 outage now fails this workflow even
while the shallow edge check stays green. curl retries (3 attempts) absorb
single blips before a run goes red.

GitHub documents 5 minutes as the shortest scheduled workflow interval, with
scheduled workflows running on the latest default-branch commit. GitHub also
routes scheduled-workflow notifications based on the workflow creator or the
user who last changes the cron schedule. Because of that, this repo-configured
check is not fully proven until an owner/operator confirms:

1. Done: the workflow exists on `main`.
2. Done: manual run `28540913266` passed.
3. Done: scheduled runs `28548096175`, `28552452662`, and `28555610571` passed on `main`.
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

The endpoint is public and unauthenticated by design. `/api/health` does **not** query D1 — a database blip should not flip the external monitor while the Worker edge is healthy. Operators who need a D1 check can hit `/api/health/deep` (cheap `SELECT 1`, returns per-dependency status, rate-limited under the public api-read bucket).

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
2. Current blocker: a 2026-07-02 aggregate remote D1 check found no linked Scout/Starter subscriptions, so there is no safe internal subscription target yet.
3. After an internal linked paid subscription exists, switch Scout/Starter or monthly/annual from `/app/billing`.
4. Confirm Dodo sends the signed webhook and the account updates.
5. Separately confirm cancellation remains available from hosted portal subscription details.

Until those are verified, customers can use in-app plan switching and the hosted
portal for card/invoice tasks, while support remains the fallback for exceptions
and cancellation questions.
