# Five to Nine Launch Readiness

Last checked: 2026-06-28

## Current Verdict

Five to Nine is GA-ready on the ops/delivery lane when **email** proof is green, health is 200, D1 backups validate, and external uptime monitoring is owner-verified. Slack is **not offered at GA** — backend code stays dormant and launch readiness surfaces Slack only as optional advisories. Scout and Starter are email-only at GA.

The core app is real: public competitor search, authenticated workspace, watchlists, collections, digests, reports, share/export flows, operator health, Dodo-backed pricing/checkout, billing webhooks, email delivery, proof-first monitoring, workspace readiness, and narrow audited API/MCP agent actions all exist.

Remaining owner gates outside this repo: Dodo Product Collection membership plus **Allow Subscription Updates**, UptimeRobot monitor confirmation (no API token in repo), GitHub Cloudflare secrets plus first scheduled backup run, Presence local workspace smoke, Agency fan-out proof, and Cloudflare Email dashboard visibility.

The public `/status` page summarizes coarse launch posture without rendering account activity, aggregate counts, or private canary evidence. Detailed monitoring, proof-capture, digest, email, dormant-channel advisories, Dodo, and uptime proof stays in private launch checks and signed-in operational views.

## Evidence From 2026-06-27 Release

- `npm run typecheck` passes.
- `npm test` passes: 143 files / 1336 tests.
- `npm run build` passes.
- `npm audit --omit=dev --audit-level=moderate` passes with 0 vulnerabilities.
- `npm run canary:pricing` passes for localized Dodo preview.
- `npm run canary:billing` passes for Dodo signed-webhook plan and top-up grants.
- `npm run canary:proof` (no `--require-slack`) creates a real proof capture and sends email — **GA gate**.
- `npm run canary:prod` checks health on `0509.io`, `www.0509.io`, and `api.0509.io`, fresh-live search, and read-only ops readiness (email required; Slack surfaced as advisories).
- `npm run provider:bakeoff:launch` passes for the current live provider; optional alternate providers skip when credentials are absent.
- `node scripts/validate-d1-backup.mjs` passes through the latest repo migration.
- PR #251 merged to `main`, the compatible Worker deployed, and remote D1 migration inspection shows no migrations to apply after `0060_remove_legacy_billing_provider.sql`.
- Fresh D1 backup/export was uploaded to R2 before `0060`; post-cleanup evidence shows retained row counts and Dodo linkage, 0 legacy billing columns, and no retired-provider webhook table.
- Follow-up ops proof created a post-cleanup backup in the private R2 backup prefix and imported it into isolated local SQLite; aggregate schema, migration-ledger, plan, Dodo linkage, and retired-provider invariants passed.

## Hard Launch Gates

- `npm run typecheck` must pass.
- `npm test` must pass.
- `npm run build` must pass.
- `npm audit --omit=dev --audit-level=moderate` must pass.
- `npm run canary:pricing` must pass.
- `npm run canary:billing` must pass.
- `npm run canary:proof` without `--require-slack` must exit 0 (active email delivery proof).
- `npm run canary:prod` must pass.
- `npm run provider:bakeoff:launch` must stay green for `current_0509`.
- `CANARY_BYPASS_TOKEN` must be set locally and as a Worker secret.
- The private launch-readiness endpoint must show recent successful monitoring, proof capture, and **email** digest delivery (`no_recent_email_sent` is blocking).
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

## Slack Posture (dormant at GA)

Slack delivery is not part of the GA customer offer. Production may still report advisories for future verification:

- `no_slack_delivery_target`
- `no_recent_slack_sent`

These appear in the `advisories` array on `/api/launch-readiness` and do **not** fail `npm run canary:prod` or Scout GA.

Do not add Slack smoke targets for GA. Re-enable Slack only through a separate verified product decision that updates UI, API/MCP discovery, support copy, and launch canaries together.

## WhatsApp Posture

WhatsApp is not launch-scoped until the provider/customer/webhook lane is deliberately configured. Aggregate review found stored but not validated WhatsApp target/config rows; preserve them unless owner approves a backup-backed anonymization or cleanup, and keep them non-claimable.

## Dodo Portal Manual Blocker

Dodo customer portal sessions are wired in `/app/billing`, but Dodo must have the relevant subscription products grouped into a Product Collection and **Allow Subscription Updates** enabled before customers can change plans without emailing support. Cancellation also needs a separate portal check from subscription details.

Required manual step: Dodo dashboard → Product Collections → group the live Scout/Starter subscription products; then Settings → Subscriptions → enable **Allow Subscription Updates**; then confirm plan changes and cancellation in an internal customer portal session.

## External Uptime Manual Blocker

The public health endpoint is `https://0509.io/api/health`. Create an external uptime monitor that checks this endpoint every 5 minutes and alerts Nish if it stops returning `ok`.

Owner verification steps (no API token): see `docs/ops-backup-uptime.md` § Uptime monitoring.

## Backup Schedule Status

`.github/workflows/d1-backup-r2.yml` now schedules `npm run backup:d1:r2` weekly at 22:17 UTC Sunday and supports manual runs. It is not proven active until GitHub repository secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` exist, a run completes, and a new R2 object appears under `backups/d1/`. D1 export blocks database requests while it runs, so keep the schedule in a low-traffic window.

## Pilot-Safe Offer

Use this framing for the first customer:

> Five to Nine helps growth teams turn competitor website and Meta ad checks into proof-backed monitoring. Enter a competitor, capture landing-page proof, and get email-first change reports with source status shown honestly.

## Not Ready To Claim

- Slack delivery on Starter/Agency; Slack is dormant and not part of the GA customer offer.
- Customer WhatsApp delivery unless opt-in, template readiness, provider sends, and webhook reconciliation are verified.
- SOC 2, HIPAA, GDPR compliance, zero retention, no training, or similar trust guarantees.
- Automated TikTok, Google, YouTube, LinkedIn, Pinterest ingestion, automated spend/reach/impression benchmarks, or broad public write APIs beyond the narrow audited workspace actions.

## Next Slice

Confirm UptimeRobot on `/api/health`, confirm the Dodo customer portal setting, add GitHub backup secrets and observe the first scheduled backup object, complete the Presence internal smoke, keep Agency held until fan-out proof passes, confirm Cloudflare Email dashboard logs, then rerun `npm run canary:proof` and `npm run canary:prod`.
