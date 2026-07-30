# Silent-failure observability remediation

Branch: `fix/silent-fixobserve`
Base: `origin/main` at `46fe111`
Pull request: https://github.com/nish3451/0509/pull/447

## Outcome

This lane closes C1, C2, M2, M4, M5, M6 and content-sanity F1–F4. C6 is
partially closed without inventing a credential: failed email pages are
recorded but never activate the successful-page throttle, so each later
failure retries. No Telegram/Hermes webhook secret or config key exists in
`AppEnv`, `wrangler.jsonc`, or the repository, so the independent secondary
channel is proposed below rather than silently simulated.

## Failing-first evidence and fixes

The confirmed verifier artifacts are the failing-first baseline, per the lane
brief. I used their source probes and defect-locking tests rather than
temporarily restoring unsafe behavior.

| Finding | Confirmed pre-fix probe | Cause-level remediation and regression proof |
|---|---|---|
| C1 | `SILENT-FAILURE-AUDIT.md:61-69`: all observation begins inside an invoked scheduled handler; the only reader was release soak. | Added a separate hourly `13 * * * *` deadline reader over `release_scheduled_observation`, with cadence-specific freshness limits and an operator-email alert. `scheduled-observation-health.server.test.ts`; heartbeat routing and rejection paging in `worker-scheduled-handler.test.ts`. |
| C2 | Audit lines 71-84 and verifier probes showed fulfilled degraded results had no active consumer; redispatch failures were absent from the fanout result. | Degraded observation results actively page, genuine monthly recap failures page while intentional no-op skips remain quiet, redispatch failures are returned/persisted, and inline/digest failures enter operational risk mail. Migration 0071 expands the metrics allowlist. `release-scheduled-observation.server.test.ts`, `monthly-recap.test.ts`, and worker tests cover the active consumers. |
| C6 | Audit lines 116-124 plus the old cron-alert test explicitly required a false email send to suppress the next attempt for six hours. | Only `operator_alert_sent` rows throttle. A failed page keeps one durable `operator_alert_not_sent` fact without increasing/throttling, and every later failure retries the channel. `cron-failure-alert.server.test.ts` proves retry and durable failure state. |
| M2 | Audit lines 166-172: the one-shot Free activation path ended in an empty catch and later scans never retried. | Later successful Free scans re-enter the existing idempotent activation claim; accepted sends remain deduplicated and failures actively page. `free-activation-observability.test.ts` plus the full monitoring suite. |
| M4 | Audit lines 182-188: the board loader catch returned an all-zero window with no degradation flag. | Loader returns `captureWindowDegraded`; populated boards show a partial-data notice rather than believable zeros. Empty boards do not get competitor-specific wording. `watchlists.route.test.ts`. |
| M5 | Audit lines 190-196: memory failures became `[]`; report-load/helper failures appeared as revoked/absent approvals, with an old test expecting `{}`. | Memory and approval-read failures are visibly labeled. Saved approvals remain in the response during transient/helper unavailability, while readiness is fail-closed as “unavailable” until refresh. `clients.route.test.ts`. |
| M6 | Audit lines 198-204: a later Meta page exception broke the loop and returned page 1 as if complete. | Retained results now carry `discoveryStatus: degraded`, an API-appropriate unavailable failure class, a partial summary and retry cursor. The resolver records the failed fetch, preserves the provider’s prior successful timestamp, and does not cache the partial response as complete. `ad-source.test.ts`. |
| F1 | `CONTENT-SANITY-SWEEP.md:25-34`; `report-view.test.ts` locked “we could not read this one” into URL/language fields. | URL absence is `none stored`; language absence is `Not detected`. Report evidence links are also real 44px phone targets after Gate B caught the undersized controls. |
| F2 | Content sweep lines 36-44: instant Before/Now appeared with no capture clocks. | Before/Now renders only with two real, valid, ordered capture timestamps, and each pane names its capture time. The evaluator now propagates proof capture clocks from the current and previous captures; synthetic/missing clocks fall back to an honest “comparison is not shown” message. `watch-event-evaluator.test.ts`, `delivery.server.test.ts`, and the email gallery cover both paths. |
| F3 | Content sweep lines 46-54: scan-trouble mail claimed retries were already running. | Copy now promises only the next scheduled check. `digest-email.test.ts`. |
| F4 | Content sweep lines 56-65: canonical D1 ad columns existed but sparse/stale `raw_json` hid linked report fields. | `listAdsByIds` selects and hydrates every canonical column, with SQL values authoritative over conflicting raw JSON and raw JSON only a fallback when a projected column is absent. `data.server.test.ts`. |

## C6 secondary-channel proposal

Add an operator-only secret named `OPERATOR_HERMES_WEBHOOK_URL`, configured
with `wrangler secret put`, and post a bounded signed event containing only the
task key, failure category, UTC time, deployment/version metadata, and a log
lookup hint. Route Hermes to Telegram. The webhook attempt needs its own
durable result and short timeout; it must not include raw exceptions, customer
data, provider responses, or the webhook value. Email and Hermes should be
attempted independently, and successful throttling should require at least one
accepted channel. Until that secret exists, this lane keeps email failures
retryable and durably visible instead of pretending a second page occurred.

## Verification

| Gate | Result |
|---|---|
| Lock-wrapped `npm ci` | Passed; 293 packages, 0 vulnerabilities |
| Focused regression suites | Passed; initial 5 files, 158/158 tests; final review-fix suite 4 files, 101/101 tests |
| Lock-wrapped full Vitest | Passed after the final review fixes; 386 files, 4,171/4,171 tests. One preceding run hit the deploy-window lock protocol test’s timing race (4,170 passed, 1 failed); that test passed 5/5 in isolation and the required complete retry passed 4,171/4,171. |
| Lock-wrapped typecheck | Passed; Wrangler typegen, React Router typegen, `tsc -b` |
| Full Gate B | Passed; 73/73, first attempt, zero retries |
| `git diff --check` | Passed |
| `sgscan` | Passed on the final diff; exit 0, no new security findings |
| CodeRabbit local | Three quota-guarded passes: initial 6 findings (5 valid fixes; broad monitoring-module extraction deferred as out of lane), then 2 valid scheduler/provider-state fixes, then 1 valid partial-cache proof assertion. All actionable findings were applied; the last change was test-only and the full deterministic gates were rerun. |
| Greptile PR review | Unavailable: `nish3451 has reached the 50-credit limit for trial accounts`; no inline or general code findings were produced |
| `bugbot-gate status` | `ALLOW BUGBOT` — `risk: high` — `reason: High-risk or critical diff. One paid Bugbot run is justified.` GitHub's automatic attempt then reported `Bugbot couldn't run - usage limit reached`; expected/non-blocking, and `bugbot-gate mark-bugbot` recorded the fingerprint |

Gate B manifest:

- path: `test-results/gate-b-manifest-local-release-local-c0a3ab7035f102aa645790c2b03ad1a9.json`
- `schemaVersion`: `3`
- `status`: `passed`
- `strict`: `true`
- `strictIssues`: `null`
- `candidateFingerprint`: `b14ed38f574c3d00b3c1989a05ae3c28b64f57ec7dab3571923a61e4d2f1ea39`
- `environment`: `local`
- `serverIdentity`: `local-c0a3ab7035f102aa645790c2b03ad1a9`
- entries: `73`
- postflight: `j6_retention_alert_count=1`, `j6_retention_alert_mismatch_count=0`, foreign-key violations `0`, scratch restore integrity `ok`, isolated persistence removed `true`

## Review dispositions and residual limits

- CodeRabbit’s valid canonical-column, empty-board copy, saved-approval, and
  rejected-heartbeat findings were fixed. Its follow-up findings were also
  fixed: heartbeat invocations retain the shared billing-email recovery drain,
  degraded Meta pagination preserves prior provider success with an
  API-appropriate failure class, and the regression explicitly proves partial
  results are not cached. Its request to split the existing 4,000+ line
  monitoring module below 800 lines is a separate architectural refactor and
  would violate this lane’s bounded ownership.
- Codex’s two inline PR findings were confirmed and fixed: proof-backed events
  now propagate real current/previous capture clocks to the F2 email renderer,
  and monthly recap distinguishes genuine failures from expected no-op skips
  so C2 pages only actionable degradation. Both received focused regressions,
  then the full Vitest, typecheck, and strict Gate B were rerun.
- Greptile could not supply the second PR-level opinion because the account's
  trial credits are exhausted. There are no unresolved Greptile threads; the
  mandatory cross-model adversarial review therefore remains a merge-time
  gate rather than a completed signal from this lane.
- The hourly heartbeat is independent of the four production workload cron
  expressions, but it still uses Cloudflare’s scheduler. It detects one or
  more missed workload triggers when the heartbeat runs; only an external
  Hermes/uptime deadman can detect a platform-wide scheduler outage.
- No Telegram/Hermes credential was found or accessed. No provider resource
  was created, no deployment was performed, and this lane must not be merged
  by the implementer.
