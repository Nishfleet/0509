# Ops: Backups, Uptime, Billing Portal

## D1 backup posture

- `npm run backup:d1:r2` is the owner-operated backup command. It exports the remote D1 database (`0509`) to `backups/d1/<timestamp>.sql` and uploads it to the R2 bucket under `backups/d1/` when production auth is available.
- The repository validation gate is `node scripts/validate-d1-backup.mjs`. It dry-runs backup-script prerequisites, the D1 binding, and the current migration chain through the latest migration; it does not prove that a fresh production R2 object exists.
- Automated R2 scheduling is **not verified active from this repository**. Keep public trust copy limited to dry-run validation, migration-chain coverage, and owner-operated backup/restore procedures until a schedule and restore drill are proven.
- Manual run any time: `npm run backup:d1:r2` from the repo root (wrangler OAuth session and R2 access must be available).

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

## Dodo customer portal — product collection and subscription updates (needs Nish)

The customer portal button on `/app/billing` opens Dodo's hosted portal.
Whether customers can change subscriptions there is controlled by Dodo product
collection setup and a dashboard setting, not the API:

1. Add the live Scout and Starter subscription products to the same Dodo Product Collection.
2. Dodo dashboard → **Settings → Subscriptions** → enable **Allow Subscription Updates**.
3. Open a test/internal customer portal session and confirm plan changes appear only between products in that collection.
4. Separately confirm cancellation remains available from subscription details.

Until those are verified, customers can use the hosted portal for card/invoice
tasks, while plan changes and cancellation stay support-assisted in product copy.
