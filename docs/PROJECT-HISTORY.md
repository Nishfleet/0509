# 0509 Project History

Narrative records moved out of `CLAUDE.md` so per-session guidance stays operational. Entries below preserve the original wording and are organized by the date of the event.

## 2026-08-26

### #944 production-verification closeout (#1121)

- Re-ran the #944 acceptance check on production 2026-08-26T16:33Z: all four `/compare/{visualping,spyland,pulzifi,foreplay}` URLs return 200 and serve real compare-page bodies (~19KB each — not the 404 shell). The homepage footer lists all six compare links; count of the four target hrefs is 4. Footer bundle `marketing-footer-DqQcCRXc.js` carries all six compare paths.
- The deploy that shipped the fix is worker version `6e371cad-4d4e-41fe-aec3-413b65f7e1ac` (timestamp 2026-08-26T13:29:59Z). Repo HEAD at verification was `7d6a60e7`.
- The `agent-blocked` label on #944 is not set (removed 2026-08-26T14:54Z). Proof comments with the curl output are on #944.
- This PR closes #1121 and #944. No compare-page content was changed.
- Rollback: if any of the four URLs regress to 404 or the footer drops their links, reopen #944, re-apply `agent-blocked`, and rerun the curl block.

## 2026-08-12

### Meta ads beta graduation

- Meta ads discovery reliability graduated from beta: the production canary for the live worker `24e18f13-f932-4b23-a6c1-d0eb218747f0` is green (post-deploy Gate-C canary passed 2026-08-09, run 31319791367, `{"passed":true,"errors":[]}`; re-verified live 2026-08-11 during the stale `codex:prod-canary` triage; worker still live 2026-08-12 with no regression). Public `/search` serves honest fresh/recent/sample labels with `isProvenFreshLiveCapture()` since #567.
- Customer-facing changes: the MagicBrief compare page no longer says Meta ads tracking is "labeled beta" — it states tracking is live and gated by a production canary; the served marketing hero keeps its Meta ads claim (now honest) with freshness labeling intact; `app/lib/plan-entitlements.ts` `metaSourceStatus` values renamed `beta_limited`/`beta_priority` → `limited`/`priority`; README and the GA positioning/scorecard/customer-journey audit docs record the graduation.
- Rollback: if the production canary turns red (launch-readiness `meta_ads_beta:*` blockers, Gate C failing, or fresh-live probe degradation), restore the beta caveat in `app/routes/compare.magicbrief.tsx`, `README.md`, and `docs/ga-positioning.md` before any customer-facing Meta claim.

## 2026-08-11

### Stale codex:prod-canary issue triage

- Closed the last two open `codex:prod-canary` issues (#19, #27), deferred from the 2026-08-06 triage pending a live-canary truth check. Both are stale: every probe in their evidence targets the retired `0509.in` domain (now 308-redirect-only; `0509.io` is the canonical primary domain per `CLAUDE.md` and `workers/primary-domain.ts`), and both track the pre-#567 silent cached-degraded discovery behavior — public `/search` overpromising "right now" while serving cached inventory — which PR #567 (merged 2026-08-09) resolved by gating fresh/live wording on `isProvenFreshLiveCapture()` and labeling cached results honestly. The Post Merge Guard automation that filed #27 was removed in #150 (2026-06-12), so no new evidence can arrive on either issue. Live truth check 2026-08-11: `0509.io`, `www.0509.io`, and `api.0509.io` each return health 200 with app `0509` on the post-#567 worker version `24e18f13-f932-4b23-a6c1-d0eb218747f0` (search rollout `shadow`); the post-deploy Gate-C canary for that version passed (`{"passed":true,"errors":[]}`, run 31319791367, 2026-08-09). Each issue got a one-line resolution comment and was closed (not deleted). Rollback: reopen the issue.

## 2026-08-06

### Stale codex:rollback issue triage

- Closed **42** open `codex:rollback` issues (#57, #63, #65, #68, #74–#90 even, #93–#149 odd) that had sat since May–June 2026 as post-merge-guard noise: GitHub Actions prepared a rollback branch but could not open the PR (workflow permissions). None had comments, linked open PRs, or still-live work; each got a one-line resolution comment and was closed (not deleted). Rollback: reopen the issue.
- Verification (`gh issue list --state open`): **3** open issues remain — #491 (closeout landing order), #27 (`codex:prod-canary`), #19 (`codex:prod-canary` / discovery cached-degraded). Zero open `codex:rollback` issues.
- Out of scope for this pass: #27 and #19 are a different automation class and need a separate live-canary truth check before close.

## 2026-06-11

### Billing and webhook state recorded during launch hardening

- **billing IS live via Dodo Payments**: `api.billing.dodo.checkout.ts` (303 to hosted checkout) + `api.webhooks.dodo.ts` (signed, idempotent). `payment.succeeded` grants plans/credits; `subscription.cancelled/expired/failed/on_hold` revoke to free with the same monotonic-timestamp ordering (2026-06-11). The Dodo dashboard webhook must have subscription events enabled (including refund events). As of 2026-06-12: `subscription.failed/on_hold` are a dunning grace state (plan kept, `dodo_status` flagged, banner shown) — only `cancelled/expired` revoke; `refund.succeeded` revokes plan + expires credits; a `dodo_webhook_event` ledger dedupes redeliveries; a ±5min replay window is enforced; `/app/billing` shows plan/usage/cancel guidance; checkout blocks double-subscriptions. Do not describe billing as "not live."

### Launch audit and hardening program

- a full launch audit (security, code, architecture, DB, business) was completed 2026-06-11 and a 13-PR hardening program (#138-#158) landed 2026-06-12 resolving: SSRF in creative-text, open redirect on auth `redirectTo`, D1 100-param crashes, missing indexes (0022) + retention sweep, share-link expiry/revocation (+ `/app/shares`), password reset, billing page + double-subscription guard, dunning grace + refund handling + Dodo event ledger, digests-before-scans + cron deadline guard, digest-only Mondays, scraper advertiser/CTA honesty, instant-alert retry + quiet-hours flush, watchlist pause/resume + collection delete + send-test-email, cost gates. CURRENT GA POSTURE: Email is the verified delivery lane; WhatsApp and Slack are dormant/non-GA customer channels; Workflow-based monitoring fan-out is live in prod (`MONITORING_FANOUT_MODE=fanout`, max 8 in-flight).

### Last local verification

Last local verification on 2026-06-11:

- `npm test` passed (`74` files / `502` tests)
- `npm run build` passed
- remote D1 migration state checked via `wrangler d1 migrations list 0509 --remote`

### Resolved migration-ledger incident

- Prod schema changes go through ONE door: a numbered file in `migrations/` applied with `npx wrangler d1 migrations apply 0509 --remote`. Never run DDL via `wrangler d1 execute --remote`. `npm run deploy` enforces this via `scripts/check-d1-migrations-synced.mjs`, which fails the deploy while remote D1 is behind `migrations/` except for an explicitly allowlisted post-deploy cleanup migration (`POST_DEPLOY_CLEANUP_MIGRATIONS` in `scripts/d1-migration-sync-check.lib.mjs` — currently empty after `0060` completed). (Lesson from the 0019_slack_delivery drift incident, 2026-06-11: schema was changed out-of-band, the migration ledger lied, and the next apply crashed on it.)

## 2026-06-12

### Retention audit and 12-PR program

- a retention audit (first-week experience, signal quality, promise-vs-delivery, churn lifecycle) followed on 2026-06-12 and a 12-PR program (#160-#172) landed the same day: Dodo subscription grants fixed for real payloads (subscription payments carry NO product_cart — grants come from checkout metadata; subscription.active/renewed handled; migration 0023 rebuilt user_plan absorbing remote drift and added subscription/customer/next-billing linkage), first scan on watchlist creation, all-quiet heartbeat digests, baseline event instead of first-scan ad_new flood, canonical-URL diffing + 48h per-field suppression + stale-cache-honest scans, paused-watchlist visibility + auto-resume on grant, per-plan daily proof caps (agency math now reachable), Dodo customer portal + cancel-at-period-end guard, scan-failure notices + nightly customer-at-risk operator email, before/now diffs + links in alert emails, /app/account (password/email/sessions/delete), honest cadence copy, hidden-value pricing bullets + agency scan priority. A live-mode Dodo API key lives at ~/.config/dodo/claude-api-key. RESOLVED 2026-06-12 (verified via Dodo API): the production webhook ep_3DyWwxkqJjUoAInxV07esfVvUDb subscribes to all 8 handled events (payment.succeeded, refund.succeeded, subscription.active/renewed/cancelled/expired/failed/on_hold) — filter_types match the handler exactly.

### Round-3 audit waves

- a round-3 audit program (waves A/B/C + ops) landed 2026-06-12 as PRs #176-#186: scan-reliability interaction fixes (deletion guard, operator-alert FK, email-change target migration, paused_reason, in-flight scan guard with lazy scan thunks, soft-failure classification, capacity staleness signals), pending states + first-scan live pulse, tab titles/favicon/PNG og-image, the GLOBAL-FIRST pass (see Conventions; migrations 0024-0025), email dark-mode hardening, dashboard wake-up greeting, creative thumbnails (creativeImageUrl on AdRecord raw_json), Boards rename + ad-longevity badges, weekly business-numbers operator email (Monday cron), D1→R2 weekly backups (npm run backup:d1:r2 + scheduled task on Nish's Mac; docs/ops-backup-uptime.md), and agency report branding (migration 0026, /app/account, plan-gated). Remote D1 migrations applied through 0026. PENDING NISH (see docs/ops-backup-uptime.md): UptimeRobot monitor on /api/health, Dodo dashboard customer-portal "Allow Subscription Updates" toggle, WhatsApp Meta-side setup.

## 2026-07-13

### Resolved local/CI deploy collision

- **Deploys go through CI, not your terminal.** Every push to `main` auto-deploys via `.github/workflows/deploy-production.yml` (the Cloudflare deploy token lives in the GitHub `production` environment). That workflow runs typecheck → full tests → materializes private remote-restore evidence → `npm run deploy` → verifies the release evidence set. `npm run deploy` executes `scripts/deploy-production-plan.mjs`: D1 migration-sync blocks; `launch:readiness:predeploy` (typecheck, tests, build, audit, and `e2e:local:release`) plus `verify-deploy-readiness.mjs` require a strict first-attempt Chromium `local-release` 66-entry Gate-B proof and block release; `cross_browser_risk_proof` (`scripts/run-cross-browser-risk-proof.mjs`) is a non-blocking diagnostic (`nonBlockingDiagnostic: true`); `remote_restore_evidence` (`scripts/verify-remote-restore-evidence.mjs`) blocks under policy `fresh-exact-24h` for migration-bearing deploys and `verified-ledger-7d` otherwise; post-deploy steps include rollback-target verification, launch-readiness canary cycle, version-bound release canary, Gate-C soak start, live public truth, and `e2e:prod:public` smoke. Do NOT also run `npm run deploy` locally for routine ships — on 2026-07-13 a local deploy interleaved with CI deploys, hashed asset names flip-flopped between versions, and live sessions (including the owner mid-sign-in) got unstyled pages and root error boundaries. Local deploy is break-glass only, when Actions is down and after checking no CI deploy run is in flight.

## 2026-07-19

### Product-readiness operating-model recap

Three roles, kept separate — this split shipped the 2026-07-19 product-readiness stack and Nish endorsed it as the standing model:

Every substantial builder stack gets an independent review pass before merge — the 2026-07-19 stack had 3 blockers and 6 customer-facing email bugs caught this way. Deploy-gate e2e (Gate-B journeys, restore-evidence) is Codex-owned; product changes that alter public copy/states require the gate specs to be updated in the same landing sequence.
