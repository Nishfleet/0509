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
| C1 | `SILENT-FAILURE-AUDIT.md:61-69`: all observation begins inside an invoked scheduled handler; the only reader was release soak. | Added a separate hourly `13 * * * *` deadline reader over `release_scheduled_observation`, with cadence-specific freshness limits and an operator-email alert. A regression asserts every configured workload cron has a deadline, excluding only the heartbeat. The heartbeat still drains billing-email recovery without passing its unsupported cron into release-soak observation. `scheduled-observation-health.server.test.ts`; heartbeat routing and rejection paging in `worker-scheduled-handler.test.ts`. |
| C2 | Audit lines 71-84 and verifier probes showed fulfilled degraded results had no active consumer; redispatch failures were absent from the fanout result. | Degraded observation results actively page, genuine monthly recap failures page while intentional no-op skips remain quiet, redispatch failures are returned/persisted, and inline/digest failures enter operational risk mail. Inline and digest degradation use distinct idempotency keys, so one mode cannot suppress the other. Migration 0071 expands the metrics allowlist. `release-scheduled-observation.server.test.ts`, `monthly-recap.test.ts`, and worker tests cover the active consumers. |
| C6 | Audit lines 116-124 plus the old cron-alert test explicitly required a false email send to suppress the next attempt for six hours. | Only `operator_alert_sent` rows throttle and increment the successful-page count. A failed page keeps one durable `operator_alert_not_sent` fact with `alert_count=0`, does not throttle, and every later failure retries the channel. `cron-failure-alert.server.test.ts` and the strict release fixture prove retry and durable failure state. |
| M2 | Audit lines 166-172: the one-shot Free activation path ended in an empty catch and later scans never retried. | Later successful Free scans re-enter the existing idempotent activation claim; accepted sends remain deduplicated and failures actively page. `free-activation-observability.test.ts` plus the full monitoring suite. |
| M4 | Audit lines 182-188: the board loader catch returned an all-zero window with no degradation flag. | Loader returns `captureWindowDegraded`; populated boards show a partial-data notice rather than believable zeros. Empty boards do not get competitor-specific wording. `watchlists.route.test.ts`. |
| M5 | Audit lines 190-196: memory failures became `[]`; report-load/helper failures appeared as revoked/absent approvals, with an old test expecting `{}`. | Memory and approval-read failures are visibly labeled. Saved approvals remain in the response during transient/helper unavailability, while readiness is fail-closed as “unavailable” until refresh. `clients.route.test.ts`. |
| M6 | Audit lines 198-204: a later Meta page exception broke the loop and returned page 1 as if complete. | Retained results now carry `discoveryStatus: degraded`, an API-appropriate unavailable failure class, a partial summary and retry cursor. The resolver records the failed fetch, preserves the provider’s prior successful timestamp, does not cache the partial response, and marks the state partial so a successful first page cannot globally cool down unrelated searches. `ad-source.test.ts`. |
| F1 | `CONTENT-SANITY-SWEEP.md:25-34`; `report-view.test.ts` locked “we could not read this one” into URL/language fields. | URL absence is `none stored`; language absence is `Not detected`. Report evidence links are real 44px phone targets implemented through the repository’s shared CSS layer. |
| F2 | Content sweep lines 36-44: instant Before/Now appeared with no capture clocks. | Before/Now renders only with two real, valid, ordered capture timestamps, and each pane names its capture time. The evaluator now propagates proof capture clocks from the current and previous captures; synthetic/missing clocks fall back to an honest “comparison is not shown” message. `watch-event-evaluator.test.ts`, `delivery.server.test.ts`, and the email gallery cover both paths. |
| F3 | Content sweep lines 46-54: scan-trouble mail claimed retries were already running. | Copy now promises only the next scheduled check. `digest-email.test.ts`. |
| F4 | Content sweep lines 56-65: canonical D1 ad columns existed but sparse/stale `raw_json` hid linked report fields. | `listAdsByIds` selects and hydrates every canonical column, with non-null SQL values authoritative over conflicting raw JSON and raw JSON retained when a legacy nullable D1 column is `NULL` or absent. `data.server.test.ts` covers both directions. |

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
| Focused regression suites | Passed; initial 5 files, 158/158 tests; late-review suite 8 files, 229/229; corrected Gate-B contract 2 files, 21/21; final proof checks 2 files, 17/17 |
| Lock-wrapped full Vitest | Passed after all review fixes; 386 files, 4,174/4,174 tests. One earlier run hit the deploy-window lock protocol test’s timing race (4,170 passed, 1 failed); that test passed 5/5 in isolation and subsequent complete runs passed. |
| Lock-wrapped typecheck | Passed; Wrangler typegen, React Router typegen, `tsc -b` |
| Full Gate B | Passed; 73/73, first attempt, zero retries |
| `git diff --check` | Passed |
| `sgscan` | Passed on the final diff; exit 0, no new security findings |
| CodeRabbit local | Four quota-guarded passes: initial 6 findings (5 valid fixes; broad monitoring-module extraction deferred as out of lane), then 2 valid scheduler/provider-state fixes, then 1 valid partial-cache proof assertion, and finally 2 valid proof hardenings (explicit heartbeat-config assertion and NULL-safe fixture comparison). All actionable local findings were applied. |
| CodeRabbit PR | Passed after posting 4 actionable inline findings; all four were verified and fixed (shared CSS, D1 NULL fallback, failed-page count zero, failure-mode-specific alert keys). The docstring warning and broad client-route extraction request are repository-wide/out-of-lane maintainability work, not correctness findings in this candidate. |
| Greptile PR review | Unavailable: `nish3451 has reached the 50-credit limit for trial accounts`; no inline or general code findings were produced |
| `bugbot-gate status` | `ALLOW BUGBOT` — `risk: high` — `reason: High-risk or critical diff. One paid Bugbot run is justified.` GitHub's automatic attempt then reported `Bugbot couldn't run - usage limit reached`; expected/non-blocking, and `bugbot-gate mark-bugbot` recorded the fingerprint |

### PR CI merge-ref blocker

GitHub run `30545966908`, job `codex-node-checks`, is not green. The first
attempt logged every test file as passing, then retained a Vitest worker until
GitHub canceled the operation. A single authorized failed-job rerun reproduced
the same non-terminating process and was canceled to release the shared
self-hosted runner once the cause was proven.

The PR merge ref includes `origin/main` commit `e0ed012` (#440), which is newer
than this lane's `46fe111` base and added the deploy-window compatibility
tests. On CI, that test calculates `realFlock` with `command -v flock`; PATH
resolves it to the installed `/home/nish/.local/bin/flock` compatibility shim.
The test exports that same path as `FLOCK_COMPAT_REAL`. Its fd-lock probe then
executes the shim as its own "real" flock indefinitely:

`deploy-window-lock.sh -> /home/nish/.local/bin/flock -> deploy-window-lock.sh`

The second attempt's process tree reproduced that exact recursion under
`tests/deploy-window-lock.test.ts`; no candidate test assertion failed.
Fixing `scripts/flock-compat.sh`, `scripts/deploy-window-lock.sh`, their tests,
or the installed runner shim belongs to #440's lock/CI ownership and would
violate this lane's coordinate-by-avoidance boundary. The check must remain
failed/canceled until that owning lane fixes the real-flock resolution, after
which this PR's failed job should be rerun.

Gate B manifest:

- path: `test-results/gate-b-manifest-local-release-local-7bae353159bd4ea847529a3ff4d73c47.json`
- `schemaVersion`: `3`
- `status`: `passed`
- `strict`: `true`
- `strictIssues`: `null`
- `candidateFingerprint`: `fbbdca57fa5943f95769f0b86967d30bc9c82920f5c60a0743fd976c080b3baa`
- `environment`: `local`
- `serverIdentity`: `local-7bae353159bd4ea847529a3ff4d73c47`
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
- The final PR review batch was also remediated: partial Meta pagination no
  longer activates global cooldown, heartbeat recovery no longer records an
  unsupported cron, nullable D1 fields preserve raw evidence, unaccepted pages
  retain a zero success count, and inline/digest pages cannot dedupe each other.
  The strict Gate B initially and correctly rejected its stale retention
  fixture expectation (`alert_count=1`); the harness was updated to require the
  honest zero count while retaining the durable failure row, then the full
  suite and Gate B passed.
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
