# 0509 Project History

Narrative records moved out of `CLAUDE.md` so per-session guidance stays operational. Entries below preserve the original wording and are organized by the date of the event.

## 2026-09-06

### #1814 main CI red — Secret Scan push trigger walked every branch (`git log --all`)

- FleetMainRed opened 2026-09-06T14:10Z with `fleet_main_ci_green[Nishfleet/0509]=0`. The failing required check was **Secret Scan (Gitleaks)** on the `push` event: the scan step ran a bare `gitleaks git .`, which is `git log --all` and walks every fetched ref, not just main's ancestry. A redaction-test fixture (`api_key=...` at `tests/release-hydration-bridge.test.ts:95`, commit `b884832f`) that lived **only on an unrelated open claim branch** (`claim/issue-1752-refresh`, PR #1810) poisoned main's required scan. Main's own 749-commit history scanned clean — 0 findings.
- The false-positive red triggered the auto-revert organ, which merged #1817 (reverting the innocent docs PR #1787) before the consecutive-commit halt (#1822, #1824) recognized the infra fault and stopped further reverts.
- Root-cause fix: PR #1826 (`orch/secret-scan-push-scope`, merged 2026-09-06T15:05:51Z, commit `1a41f0a1`) scoped the `push` and `workflow_dispatch` scans to `--full-history HEAD` (the authorized commit's full ancestry — already-merged secrets still fail) while leaving `pull_request`/`merge_group` on `base..head`. Added `tests/secret-scan-workflow.test.ts` pinning that every event sets an explicit scope, no bare `log_opts=()`, no `--all`, single gitleaks invocation receives the scope. This kills the whole cross-branch whack-a-mole class (the `.gitleaksignore` fingerprint PRs #1805/#1819/#1820 were treating symptoms).
- Collateral restore: PR #1827 (`orch/reland-1787`, merged 2026-09-06T15:08:04Z, commit `6b0e0c0c`) reverted the #1817 squash, restoring the #1787 pr-archive docs. Sequenced after #1826 so the now-scoped push scan would not re-red main and trigger a second auto-revert.
- Verification of green main (live, 2026-09-06T15:11Z): `gh api repos/Nishfleet/0509/commits/main/check-runs` — every completed check is `success` or `skipped` (auto-revert), zero failures; head `49638a83`. Gitleaks success on `1a41f0a1` (run 34041230067) and on `49638a83`. `fleet_main_ci_green{repo="Nishfleet/0509"} = 1` on the live exporter at 15:07Z; the other 8 enrolled repos were already green at issue creation and stayed green, so the fleet-wide red was 0509-only.
- This PR closes #1814. No product code, schema, route, or workflow changed by this PR — the fix landed in #1826 and the collateral restore in #1827, both already merged. This entry records the resolution in the canonical incident log so the close is attributable to a real diff, not a bare `gh issue close`.
- Rollback: none — there is no behaviour change in this PR. If main goes red again on Secret Scan, file a new issue; #1826's scope pin is the durable guard.

### #1749 capture-validity gate — duplicate of shipped #1399/#953/#1289/#1264 closeout

- #1749 asked for a capture-validity gate before any diff becomes a `watch_event`, `capture_failed` rows with a `failure_reason` enum never emitted as alerts but visible in run history, a public `/capture-rules` page, and an adversarial fixture suite covering 7 failure modes + 1 genuine change. All five acceptance criteria are already met by closed, shipped work: the gate classifier landed under #1399 (`feat(proof): capture-validity classifier gates landing_page_* events (BET 4, #1399)`, commit `63a99654`); the adversarial termination proof under #953 (commit `eecb1b3f`); `capture_failed` visibility in run history and the public reason-code vocabulary (incl. `takedown_restore`) under #1289; the `/capture-rules` public page under #1264 (commit `ab14a4ec`); and the `/search` empty-state cross-link under #1568.
- The implementation stores failed captures as `proof_capture` rows with `status = 'capture_failed'` and internal `landing_*` reason codes, translated to the public vocabulary (`bot_wall`, `cloudflare_challenge`, `cookie_banner`, `partial_load`, `error_page`, `timeout`, `takedown_restore`, `budget_skip`, `extraction_failed`) by `app/lib/capture-attempt-reason-code.ts`. Timestamp-only edits and rotating banners are suppressed at the event-evaluator layer (`app/lib/watch-event-evaluator.server.ts` churn-stable / ad-slot-stripped hashing), not the capture gate — matching the issue's intent that they produce zero events.
- Verification on `origin/main` at HEAD `b123b257` (2026-09-06): `npx vitest run --project node tests/capture-validity.test.ts tests/capture-validity-pipeline.test.ts tests/capture-validity-corroboration.test.ts tests/capture-validity-termination.test.ts tests/capture-validity-public-rules.test.ts tests/capture-rules-page.test.ts tests/capture-attempt-reason-code.test.ts tests/run-history-capture-visibility.test.ts` → 8 files, 93 tests passed. The termination suite (`tests/capture-validity-termination.test.ts`) exercises all seven adversarial fixtures (500 error page, Cloudflare challenge, cookie/consent wall, partial SPA shell, site-down/maintenance, timestamp-only edit, rotating banner) + one genuine price edit, asserting zero events from the seven and one confirmed event from the genuine edit — 17 tests passed. The D1 integration test `tests/integration/watchlist-run-capture-attempts.integration.test.ts` (real workerd, real migrations) → 5 tests passed.
- This PR closes #1749 as a duplicate. No product code, schema, or route changed.
- Rollback: none — there is no behaviour change to revert. If a real gap in the gate surfaces, file a new issue against the specific failure mode rather than reopening #1749.

## 2026-08-26

### #944 production-verification closeout (#1121)

- Re-ran the #944 acceptance check on production 2026-08-26T16:33Z: all four `/compare/{visualping,spyland,pulzifi,foreplay}` URLs return 200 and serve real compare-page bodies (~19KB each — not the 404 shell). The homepage footer lists all six compare links; count of the four target hrefs is 4. Footer bundle `marketing-footer-DqQcCRXc.js` carries all six compare paths.
- The deploy that shipped the fix is worker version `6e371cad-4d4e-41fe-aec3-413b65f7e1ac` (timestamp 2026-08-26T13:29:59Z). Repo HEAD at verification was `7d6a60e7`.
- The `agent-blocked` label on #944 is not set (removed 2026-08-26T14:54Z). Proof comments with the curl output are on #944.
- This PR closes #1121 and #944. No compare-page content was changed.
- Rollback: if any of the four URLs regress to 404 or the footer drops their links, reopen #944, re-apply `agent-blocked`, and rerun the curl block.

## 2026-08-24

### GitHub-hosted CI runners and stale PR #882 closeout

- PR #902 (merged 2026-08-23, commit 7ebe3c33) moved every workflow in this repo to GitHub-hosted `ubuntu-latest` and deleted the self-hosted runner pool and `scripts/deploy-window-lock.sh`. No self-hosted runner was still registered — the last one stopped 2026-08-23 and the ci-autoscale timer was deleted with the fleet control plane — so provider mutations now rely on the existing `0509-production-provider-mutations` concurrency group.
- PR #882 (`chore/ci-github-hosted-runners`, created 2026-08-22) was closed 2026-08-24 because its `runs-on` change was already on `main`. Rebasing it would reintroduce `scripts/deploy-window-lock.sh run --` wrappers in `ci.yml` and `cross-browser-matrix.yml` that #902 deliberately removed. The current `runs-on` on `main` for those two workflows is `ubuntu-latest`.
- No product code changed. No deploy, canary, or secret-scan workflows were moved.
- Mechanical lock: `tests/ci-hosted-runners.test.ts` rejects `self-hosted` labels, `deploy-window-lock` wrappers, and any `runs-on` other than `ubuntu-latest` in those two workflows. The same helper is drilled against a fixture that matches the stale #882 shape so the guard cannot pass vacuously.
- Verification: `gh pr view 882 --json state,mergedAt,mergeable` returns `state:CLOSED`, `mergedAt:null`, `mergeable:CONFLICTING`; `rg -n 'runs-on:' .github/workflows/ci.yml .github/workflows/cross-browser-matrix.yml` returns `ubuntu-latest` for both.
- Rollback: revert #902 to restore the self-hosted runner pool, or reopen #882 and rebase if self-hosted CI becomes mandatory again.

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
