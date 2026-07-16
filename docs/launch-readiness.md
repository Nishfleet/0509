# Five to Nine Launch Readiness

Last checked: 2026-07-02 (historical snapshot; the 2026-07-13 backup evidence is appended below)

## Current Verdict

Current Gate A–C release readiness is **0/6**. All six journeys remain active, four frozen candidates remain blocked, and every journey subset fingerprint is historical/local-only; no current all-six exact candidate, clean review, or Gate C pass exists. The dated fixed-candidate evidence below established readiness only on its tested ops/delivery lane when **email** proof was green, health was 200, D1 backups validated, and recurring uptime monitoring was configured with owner-verified alert proof. Slack is **not offered at GA** — backend code stays dormant and launch readiness surfaces Slack only as optional advisories. Scout, Starter, and Agency self-serve checkout were released in the dated evidence; Scout/Starter monthly and annual checkout validated through live Dodo preview. Agency remains on nightly fan-out monitoring watch after dispatch proof.

The core app is real: public competitor search, authenticated workspace, watchlists, collections, digests, reports, share/export flows, operator health, Dodo-backed pricing/checkout, billing webhooks, email delivery, proof-first monitoring, workspace readiness, and narrow audited API/MCP agent actions all exist.

Remaining proof gates span repository and controlled external execution: the current candidate Gate B rerun; one Nish-owned internal Dodo plan-change/cancellation smoke; uptime alert-routing proof; future scheduled-backup observation; a remote-scratch restore; next-window operator-owned Agency scan-health monitoring; Cloudflare Email dashboard visibility; and retired-provider dashboard cleanup. The GitHub Cloudflare secrets and first successful Actions backup were completed on 2026-07-13; that dated external proof does not replace the current-candidate restore gate.

## Evidence lanes

- **Fixed-candidate / locally verified-on-fingerprint:** the dated June 27 and July 2 tests, canaries, local SQLite restore, and runtime versions listed below.
- **Review-blocked:** a candidate without immutable fingerprint, current manifest, or required scratch/postflight evidence stays blocked even when an older snapshot is green.
- **Gate B/C:** current-candidate browser, local/remote-scratch restore, migration/schema parity, and postflight evidence. This snapshot does not claim those gates are currently green.
- **Gate C / external operational proof:** provider dashboards, uptime alert receipt, scheduled workflow observation, real Agency scan completion, and retired-provider dashboard cleanup.
- **Gate D / market validation:** target-buyer comprehension, usefulness, willingness to pay, and retained use only; it never substitutes for Gate B/C execution.

The public `/status` page summarizes coarse launch posture without rendering account activity, aggregate counts, or private canary evidence. Detailed monitoring, proof-capture, digest, email, dormant-channel advisories, Dodo, and uptime proof stays in private launch checks and signed-in operational views.

## Historical Evidence From the 2026-06-27 Release and 2026-07-02 Follow-up

- `npm run typecheck` passes.
- `npm test` passes: 143 files / 1336 tests.
- `npm run build` passes.
- `npm audit --omit=dev --audit-level=moderate` passes with 0 vulnerabilities.
- `npm run canary:pricing` passes for localized Dodo preview, including monthly, annual, and top-up checkout pricing in IN, US, and GB.
- `npm run canary:billing` passes for Dodo signed-webhook plan and top-up grants.
- `npm run canary:proof` (no `--require-slack`) creates a real proof capture and sends email — **GA gate**.
- `npm run canary:prod` checks health on `0509.io`, `www.0509.io`, and `api.0509.io`, fresh-live search, and read-only ops readiness (email required; Slack surfaced as advisories).
- `npm run provider:bakeoff:launch` passes for the current live provider; optional alternate providers skip when credentials are absent.
- `node scripts/validate-d1-backup.mjs` passed through the latest repo migration available at that time; current validation must derive the latest repo migration dynamically.
- PR #251 merged to `main`, the compatible Worker deployed, and the dated remote D1 migration inspection showed no migrations to apply after `0060_remove_legacy_billing_provider.sql`.
- Fresh D1 backup/export was uploaded to R2 before `0060`; post-cleanup evidence shows retained row counts and Dodo linkage, 0 legacy billing columns, and no retired-provider webhook table.
- Follow-up ops proof created a post-cleanup backup in the private R2 backup prefix and imported it into isolated local SQLite; aggregate schema, migration-ledger, plan, Dodo linkage, and retired-provider invariants passed. Remote-scratch restore remains unverified.
- 2026-07-02 follow-up proof created a fresh owner-operated D1-to-R2 backup in the private R2 backup prefix, and `node scripts/validate-d1-backup.mjs` passed through migration `0062_dodo_plan_change_pending_target.sql`.
- 2026-07-02 follow-up canaries passed: `npm run canary:proof`, `npm run canary:presence`, and `npm run canary:prod`.
- Agency fan-out dispatch proof passed on the dated live 04:00 UTC cron: 78 jobs queued, 0 dispatch failures, and 8 max concurrency slots. Synthetic proof watchlists were deactivated after proof; real scan completion remains external watch evidence.

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
- Uptime health workflow on `https://0509.io/api/health` must stay configured; the dated scheduled runs passed on `main`, but alert-routing proof remains owner-verified (see `docs/ops-backup-uptime.md`).

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

## Dodo Billing Smoke

Dodo customer portal sessions are wired in `/app/billing`, and the live Scout/Starter monthly and annual subscription products are grouped into the Five to Nine Product Collection. Plan switching now uses Dodo's documented subscription plan-change preview/change endpoints from the in-app billing cards instead of depending on the portal subscription-update setting.

Required manual step after deploy: create or identify an internal linked paid Scout/Starter subscription, switch a Scout/Starter plan or billing cycle from `/app/billing`, confirm Dodo sends the signed webhook and the account updates, then confirm cancellation remains available from the hosted portal subscription details.

Dated blocker detail (2026-07-02): an aggregate remote D1 check found no linked Scout/Starter subscriptions, including the internal canary account. That meant there was no safe internal subscription target for the plan-change smoke at that snapshot. Monthly checkout, annual checkout, and top-ups remained live and canary-proven in the dated evidence.

## Uptime Monitoring Status

The public health endpoint is `https://0509.io/api/health`. `.github/workflows/uptime-health.yml` now checks that endpoint on an offset five-minute schedule and fails if the response is not HTTP 200 JSON with `status: "ok"` and `app: "0509"`.

Manual uptime workflow run `28540913266` passed on `main`. Scheduled runs `28548096175`, `28552452662`, and `28555610571` passed on `main` after the offset schedule landed. The notification path remains unproven until an owner/operator confirms failed-run notifications reach the right inbox. UptimeRobot remains the stronger independent external monitor if GitHub Actions notifications are not enough.

Owner verification steps (no API token): see `docs/ops-backup-uptime.md` § Uptime monitoring.

## Backup Schedule Status

`.github/workflows/d1-backup-r2.yml` now schedules `npm run backup:d1:r2` weekly at 22:17 UTC Sunday and supports manual runs. A fresh owner-operated manual backup uploaded to R2 on 2026-07-02 while the required Cloudflare repository secrets were absent on 2026-07-02. On 2026-07-13 the owner added repository secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` and dispatch run `29225583866` completed the first successful Actions backup end-to-end; this is dated external proof, while future schedule observation and remote-scratch restore remain open. D1 export blocks database requests while it runs, so keep the schedule in a low-traffic window.

## Agency Fan-Out Status (Dated Dispatch Proof)

Agency checkout was opened after the dated live dispatch proof. The proof established Workflow fan-out dispatch and concurrency control; it did not prove synthetic proof targets produce a credible completed scan or provide a current Gate B/C scan-health pass. Gate B must prove deterministic completion/recovery on isolated fixtures; Gate C must prove an operator-owned internal scan tied to the deployed version/config. Target-buyer usefulness remains Gate D.

## Pilot-Safe Offer

Use this framing for the first customer:

> Five to Nine helps growth teams turn competitor website and Meta ad checks into proof-backed monitoring. Enter a competitor, capture landing-page proof, and get email-first change reports with source status shown honestly.

## Not Ready To Claim

- Slack delivery on Starter/Agency; Slack is dormant and not part of the GA customer offer.
- Customer WhatsApp delivery unless opt-in, template readiness, provider sends, and webhook reconciliation are verified.
- SOC 2, HIPAA, GDPR compliance, zero retention, no training, or similar trust guarantees.
- Automated TikTok, Google, YouTube, LinkedIn, Pinterest ingestion, automated spend/reach/impression benchmarks, or broad public write APIs beyond the narrow audited workspace actions.

## Next Slice

Confirm the uptime health workflow's alert path or UptimeRobot on `/api/health`, complete one internal Dodo plan-change/cancellation smoke after an internal paid subscription exists, add GitHub backup secrets and observe the first scheduled backup workflow object, watch the next Agency fan-out window for dispatch failures and real scan completion, confirm Cloudflare Email dashboard logs, clean up retired provider dashboard artifacts, then rerun `npm run canary:proof` and `npm run canary:prod`.
