# Launch Owner Actions

Items below were **not completed by the launch-hardening code run**. They require owner decisions, dashboard access, or external services outside this repository.

## GA ops gates (required)

### Email proof canary

**Status:** CODE + OPS — run after each deploy that touches delivery

1. From a machine with `CANARY_BYPASS_TOKEN` and production access: `npm run canary:proof` (no `--require-slack`).
2. Confirm exit 0 and at least one email delivery attempt with `status = sent`.
3. Re-run `npm run canary:prod` — read-only ops readiness should pass when monitoring, proof, and email signals are fresh.

### External uptime monitoring

**Status:** REPO CONFIGURED — FIRST RUN / ALERT PROOF STILL OWNER-VERIFIED

1. `.github/workflows/uptime-health.yml` checks `https://0509.io/api/health` on an offset five-minute schedule without secrets.
2. Done: manual run `28540913266` passed on `main`.
3. Confirm scheduled runs appear on `main`.
4. Confirm failed-run notifications reach the intended inbox.
5. If a separate external service is required, create an UptimeRobot (or equivalent) HTTP monitor for `https://0509.io/api/health`: 5 minute interval, keyword check `ok`, alert Nish on non-200 or missing `{ "status": "ok" }`.
6. Record verification date in `docs/ga-launch-scorecard.md`.

## Dormant delivery channels

### Slack

**Status:** NOT PUBLIC GA

Slack setup is hidden from normal customer surfaces and should not be configured as a launch proof item. Existing stored Slack configuration is preserved behind product gates. Reintroduce Slack only through a separate verified product decision that updates UI, API/MCP discovery, canaries, support copy, and owner actions together.

Slack advisories may appear on private readiness views, but they are not GA blockers while Slack is outside the customer offer.

## Billing and portal

### Enable Dodo customer subscription updates / portal

**Status:** PARTIAL — PRODUCT COLLECTION CONFIGURED; DASHBOARD TOGGLE STILL NEEDS CONFIRMATION

1. Open the Dodo Payments dashboard for the live 0509 brand.
2. Done: the live Scout/Starter monthly and annual subscription products are grouped in the Five to Nine Product Collection.
3. Enable **Allow Subscription Updates** under subscription settings.
4. Confirm `/app/billing` → **Open billing portal** loads, plan changes are allowed between that Product Collection, and cancellation is available from subscription details.

## Data and observability

### Review orphaned WhatsApp targets

**Status:** NOT COMPLETED BY THIS CODE RUN

1. Query production delivery targets with `channel = whatsapp`.
2. Hide or remove targets that are not backed by a configured Meta WhatsApp provider.
3. Keep WhatsApp out of public marketing until Meta-side setup is complete (`docs/whatsapp-setup.md`).

### Decide on public “beta” positioning

**Status:** NOT COMPLETED BY THIS CODE RUN

1. Review current copy on `/status`, pricing, and product surfaces.
2. Decide whether to remove beta labels or keep them with explicit scope boundaries.

### Decide whether Scout should be publicly marketed

**Status:** NOT COMPLETED BY THIS CODE RUN

1. Review Scout plan visibility in Dodo catalog and on-site pricing.
2. Decide whether Scout remains a hidden/downgrade tier or becomes a public entry plan.

### Enable cloud D1 backup schedule and secrets

**Status:** NOT COMPLETED BY THIS CODE RUN

1. Review `.github/workflows/d1-backup-validate.yml` (repository validation only).
2. If moving off the Mac launchd job, configure Cloudflare/API credentials as GitHub Actions secrets.
3. Schedule a weekly workflow that runs `npm run backup:d1:r2` with production auth.
4. Confirm an object appears under `backups/d1/` in the R2 bucket.

### Configure external error monitoring / log export

**Status:** NOT COMPLETED BY THIS CODE RUN

1. Decide on a log sink (Cloudflare Logpush, Sentry, etc.).
2. Wire Workers production logs without exporting secrets or raw auth payloads.
3. The app emits structured JSON logs from `app/lib/log.server.ts` on critical paths — point the sink at Workers logs.

### Perform a real restore drill

**Status:** NOT COMPLETED BY THIS CODE RUN

1. Download a recent `backups/d1/*.sql` export.
2. Restore into an isolated D1 database or local SQLite using the documented procedure in `docs/ops-backup-uptime.md`.
3. Spot-check `user`, `watchlist`, and `user_plan` row counts against production.

### Evaluate email bounce/suppression provider

**Status:** NOT COMPLETED BY THIS CODE RUN

1. Cloudflare Email Service does not expose bounce webhooks in-app.
2. If compliance requires list hygiene beyond dashboard review, evaluate a provider with bounce/suppression events.
3. Document the decision before changing `delivery.server.ts`.

## Monitoring capacity note (product honesty)

**Status:** PARTIALLY ADDRESSED IN CODE — WORKFLOW FAN-OUT STILL DEFERRED

- Agency allows **75** active watchlists per workspace, but the nightly cron still runs **inline** with a **12-minute** global budget when browser scraping is active.
- Skipped watchlists now receive at most **one** `watchlist_run` row per nightly window (`idempotency_key` on `watchlist_run`, migration `0046`), with `status = skipped` and `error_code = capacity_budget`, surfaced in `/app/watchlists` as **Delayed — capacity limit**.
- Full Agency-scale nightly coverage still requires reviving `MonitoringWorkflow` fan-out without bypassing digest-before-scan ordering. Track as a post-hardening infrastructure project.

## Dodo webhook processing (operator note)

**Status:** HARDENED IN CODE — REMOTE MIGRATION `0046` REQUIRED AFTER DEPLOY

1. Deploy the Worker build that includes `beginDodoWebhookEventProcessing` and atomic `db.batch()` application.
2. Run `npx wrangler d1 migrations list 0509 --remote`, then `npx wrangler d1 migrations apply 0509 --remote` to apply `0045` (if pending) and `0046`.
3. `0046` adds `dodo_webhook_event.processing_started_at` (5-minute reclaim lease) and `watchlist_run.idempotency_key`.
4. Redelivered webhooks stuck in `failed` or stale `processing` are retried safely; `processed` events are deduped without reapplying grants.
5. No dashboard change required beyond existing Dodo webhook subscription (all 8 handled events).
