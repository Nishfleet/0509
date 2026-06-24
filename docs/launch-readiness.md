# Five to Nine Launch Readiness

Last checked: 2026-06-24

## Current Verdict

Five to Nine is GA-ready on the ops/delivery lane when **email** proof is green, health is 200, D1 backups validate, and external uptime monitoring is owner-verified. Slack is **optional** — advertised on Starter and Agency but not a GA launch blocker. Scout is email-only.

The core app is real: public competitor search, authenticated workspace, watchlists, collections, digests, reports, share/export flows, operator health, Dodo-backed pricing/checkout, billing webhooks, email delivery, proof-first monitoring, workspace readiness, and narrow audited API/MCP agent actions all exist.

Remaining owner gates outside this repo: Dodo customer portal **Allow Subscription Updates**, UptimeRobot monitor confirmation (no API token in repo), and optional disposable Slack target for Starter/Agency marketing verification.

The public `/status` page summarizes coarse launch posture without rendering account activity, aggregate counts, or private canary evidence. Detailed monitoring, proof-capture, digest, email, Slack advisories, Dodo, and uptime proof stays in private launch checks and signed-in operational views.

## Evidence From 2026-06-24

- `npm run typecheck` passes.
- `npm test` passes (focused ops suites: health, launch-readiness, prod-canary).
- `npm run build` passes.
- `npm run canary:proof` (no `--require-slack`) creates a real proof capture and sends email — **GA gate**.
- `npm run canary:proof -- --require-slack` is **optional** — fails when no Slack target is configured; does not block Scout GA.
- `npm run canary:prod` checks health on `0509.io`, `www.0509.io`, and `api.0509.io`, fresh-live search, and read-only ops readiness (email required; Slack surfaced as advisories).
- Production health passes: `https://0509.io/api/health` → 200, `{"status":"ok"}`.
- `node scripts/validate-d1-backup.mjs` passes (dry-run).

## Hard Launch Gates

- `npm run typecheck` must pass.
- `npm test` must pass.
- `npm run build` must pass.
- `npm audit --omit=dev --audit-level=moderate` must pass.
- `npm run canary:billing` must pass.
- `npm run canary:prod` must pass.
- `npm run provider:bakeoff:launch` must stay green for `current_0509`.
- `CANARY_BYPASS_TOKEN` must be set locally and as a Worker secret.
- The private launch-readiness endpoint must show recent successful monitoring, proof capture, and **email** digest delivery (`no_recent_email_sent` is blocking).
- `npm run canary:proof` without `--require-slack` must exit 0 (active email delivery proof).
- WhatsApp must stay out of launch claims while provider/customer/webhook readiness is disabled.
- Public pricing display must come from Dodo local-price preview.
- Dodo checkout creation and signed webhook grant canaries must remain green.
- External uptime monitor on `https://0509.io/api/health` (owner-verified; see `docs/ops-backup-uptime.md`).

## Email Gate (required)

GA launch requires recent email delivery proof:

```bash
npm run canary:proof
```

Expected: `launch readiness proof canary: ok` with at least one email delivery attempt sent.

The read-only `/api/launch-readiness` endpoint blocks on `no_recent_email_delivery_attempt` and `no_recent_email_sent` when production has no recent email sends in the last 36 hours.

## Slack Posture (optional, not GA-blocking)

Slack is available on Starter and Agency. Production may report advisories:

- `no_slack_delivery_target`
- `no_recent_slack_sent`

These appear in the `advisories` array on `/api/launch-readiness` and do **not** fail `npm run canary:prod` or Scout GA.

To verify Slack end-to-end before claiming it as proven on paid tiers:

```bash
# After adding a Slack webhook in /app/sources for the canary workspace:
npm run canary:proof -- --require-slack
```

## WhatsApp Posture

WhatsApp is not launch-scoped until the provider/customer/webhook lane is deliberately configured. Existing unready WhatsApp recipients should stay non-claimable.

## Dodo Portal Manual Blocker

Dodo customer portal sessions are wired in `/app/billing`, but the Dodo dashboard must have Customer Portal subscription updates enabled before customers can change or cancel subscriptions without emailing support.

Required manual step: Dodo dashboard → Settings → Customer Portal → enable **Allow Subscription Updates** and confirm cancellation is available.

## External Uptime Manual Blocker

The public health endpoint is `https://0509.io/api/health`. Create an external uptime monitor that checks this endpoint every 5 minutes and alerts Nish if it stops returning `ok`.

Owner verification steps (no API token): see `docs/ops-backup-uptime.md` § Uptime monitoring.

## Pilot-Safe Offer

Use this framing for the first customer:

> Five to Nine helps growth teams turn competitor website and Meta ad checks into proof-backed monitoring. Enter a competitor, capture landing-page proof, and get email-first change reports with source status shown honestly.

## Not Ready To Claim

- Verified Slack delivery on Starter/Agency until `--require-slack` canary passes (optional ops proof).
- Customer WhatsApp delivery unless opt-in, template readiness, provider sends, and webhook reconciliation are verified.
- SOC 2, HIPAA, GDPR compliance, zero retention, no training, or similar trust guarantees.
- Automated TikTok, Google, YouTube, LinkedIn, Pinterest ingestion, automated spend/reach/impression benchmarks, or broad public write APIs beyond the narrow audited workspace actions.

## Next Slice

Confirm UptimeRobot on `/api/health`, confirm the Dodo customer portal setting, optionally add a disposable Slack webhook for Starter/Agency verification, then rerun `npm run canary:proof` and `npm run canary:prod`.
