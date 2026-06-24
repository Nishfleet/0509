# Ops: Backups, Uptime, Billing Portal

## D1 off-site backups (automated)

- `npm run backup:d1:r2` exports the remote D1 database (`0509`) to
  `backups/d1/<timestamp>.sql` and uploads it to the R2 bucket
  `0509-landing-page-artifacts` under `backups/d1/`. Local copies are pruned
  to the newest 8; R2 copies are kept forever (they're small SQL files).
- Scheduled weekly (Sunday ~09:30 local) as the Claude Code scheduled task
  `0509-weekly-d1-backup` on Nish's Mac. It runs while the desktop app is
  open and catches up on next launch if the Mac was asleep — fine for a
  weekly cadence. Logs land in the task run history.
- Manual run any time: `npm run backup:d1:r2` from the repo root (wrangler
  OAuth session must be logged in).
- CI validates backup script shape: `node scripts/validate-d1-backup.mjs` (dry-run, no remote export).

### Restore drill

```bash
npx wrangler r2 object get 0509-landing-page-artifacts/backups/d1/<file>.sql --file restore.sql --remote
# Inspect restore.sql, then apply to a NEW scratch database first:
npx wrangler d1 create 0509-restore-test
npx wrangler d1 execute 0509-restore-test --remote --file restore.sql
```

Never execute a restore file against the production `0509` database without
Nish's explicit go-ahead.

## Uptime monitoring (needs Nish, ~2 minutes)

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

This gate cannot be automated from the repo without an UptimeRobot API key. Nish verifies manually:

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

## Dodo customer portal — "Allow Subscription Updates" (needs Nish)

The customer portal button on `/app/billing` opens Dodo's hosted portal.
Whether customers can change/cancel subscriptions there is controlled by a
dashboard setting, not the API:

Dodo dashboard → **Settings → Customer Portal** → enable
**Allow Subscription Updates** (and confirm cancellation is allowed).

Until that's enabled, customers can view but not self-serve cancel — they'd
have to email support, which is friction we don't want.
