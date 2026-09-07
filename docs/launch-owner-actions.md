# Launch Owner Actions

Items below are a dated owner-action ledger, not a current Gate B/C or Gate D pass. Several were **not completed by the launch-hardening code run** and require owner decisions, dashboard access, or external services outside this repository; later dated completions are called out inline.

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
3. Dated scheduled runs `28548096175`, `28552452662`, and `28555610571` later passed on `main`.
4. Confirm failed-run notifications reach the intended inbox; this remains Gate C external operational proof.
5. If a separate external service is required, create an UptimeRobot (or equivalent) HTTP monitor for `https://0509.io/api/health`: 5 minute interval, keyword check `ok`, alert Nish on non-200 or missing `{ "status": "ok" }`.
6. Record verification date in `docs/ga-launch-scorecard.md`.

## Dormant delivery channels

### Slack

**Status:** NOT PUBLIC GA

Slack setup is hidden from normal customer surfaces and should not be configured as a launch proof item. Existing stored Slack configuration is preserved behind product gates. Reintroduce Slack only through a separate verified product decision that updates UI, API/MCP discovery, canaries, support copy, and owner actions together.

Slack advisories may appear on private readiness views, but they are not GA blockers while Slack is outside the customer offer.

## Billing and portal

### Verify Dodo plan switching and portal cancellation

**Status:** REPO CONFIGURED — INTERNAL PROVIDER SMOKE STILL NEEDED

1. Open the Dodo Payments dashboard for the live 0509 brand.
2. Done: the live Scout/Starter monthly and annual subscription products are grouped in the Five to Nine Product Collection.
3. After deploy, use an internal linked paid subscription to switch a Scout/Starter plan or billing cycle from `/app/billing`.
4. Confirm the signed Dodo webhook updates the account, then confirm cancellation is available from hosted portal subscription details.

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

### Enable cloud D1 backup schedule and secrets (historical action; now partially completed)

**Status:** SCHEDULED BACKUP PROVEN 2026-07-13 / FUTURE OBSERVATION AND RESTORE OPEN

1. Review `.github/workflows/d1-backup-validate.yml` (repository validation only).
2. **Completed 2026-07-13:** configure Cloudflare/API credentials as GitHub Actions secrets.
3. **Completed 2026-07-13:** dispatch the weekly workflow; run `29225583866` completed validation, export, and upload.
4. Observe a future scheduled run and retain the private artifact evidence; complete the separate remote-scratch restore before calling restore production-like.

### Configure external error monitoring / log export

**Status:** NOT COMPLETED BY THIS CODE RUN

1. Decide on a log sink (Cloudflare Logpush, Sentry, etc.).
2. Wire Workers production logs without exporting secrets or raw auth payloads.
3. The app emits structured JSON logs from `app/lib/log.server.ts` on critical paths — point the sink at Workers logs.

### Perform a real restore drill (Gate B/C; external scratch still required)

**Status:** LOCALLY VERIFIED ON DATED FINGERPRINT / REMOTE SCRATCH UNVERIFIED

1. Download a recent `backups/d1/*.sql` export and preserve its private SHA256/source identity.
2. Restore into local SQLite using the documented transform procedure in `docs/ops-backup-uptime.md`; the dated local import passed aggregate schema, migration-ledger, plan, Dodo-linkage, and retired-provider checks.
3. Complete an explicitly authorized disposable remote-D1 scratch import, including the transformed statement bound, `SQLITE_TOOBIG` regression, row-count/key-ID parity, `PRAGMA foreign_key_check`, migration/schema parity, Dodo linkage, cleanup, and failure evidence. Never target production `0509`.

### Evaluate email bounce/suppression provider

**Status:** NOT COMPLETED BY THIS CODE RUN

1. Cloudflare Email Service does not expose bounce webhooks in-app.
2. If compliance requires list hygiene beyond dashboard review, evaluate a provider with bounce/suppression events.
3. Document the decision before changing `delivery.server.ts`.

## Monitoring capacity note (product honesty)

**Status:** FIXED-CANDIDATE DISPATCH PROOF 2026-06-28 — REAL SCAN HEALTH REMAINS EXTERNAL WATCH

- Agency allows **75** active watchlists per workspace, but the nightly cron still runs **inline** with a **12-minute** global budget when browser scraping is active.
- Skipped watchlists now receive at most **one** `watchlist_run` row per nightly window (`idempotency_key` on `watchlist_run`, migration `0046`), with `status = skipped` and `error_code = capacity_budget`, surfaced in `/app/watchlists` as **Delayed — capacity limit**.
- The dated Agency-scale dispatch proof superseded the old “fan-out deferred” wording: 78 jobs queued with 0 dispatch failures and 8 max concurrency slots. It did not prove customer-quality scan completion; keep nightly dispatch and real scan health as external Gate C operational watch items. Gate D remains target-buyer market validation.

## Dodo webhook processing (operator note)

**Status:** HARDENED IN CODE — DATED OPERATOR NOTE; CHECK CURRENT MIGRATION LEDGER BEFORE APPLYING

1. Deploy the Worker build that includes `beginDodoWebhookEventProcessing` and atomic `db.batch()` application.
2. Run `npx wrangler d1 migrations list 0509 --remote`; apply `0045`/`0046` only if the current ledger actually reports them pending. Do not infer pending work from this historical note.
3. `0046` adds `dodo_webhook_event.processing_started_at` (5-minute reclaim lease) and `watchlist_run.idempotency_key`.
4. Redelivered webhooks stuck in `failed` or stale `processing` are retried safely; `processed` events are deduped without reapplying grants.
5. No dashboard change required beyond existing Dodo webhook subscription (all 8 handled events).
