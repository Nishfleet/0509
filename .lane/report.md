# Silent-failure observability remediation

**Status: remediated, not merge-ready.** Product findings from the BLOCK
review and the follow-up crgate pass are cause-fixed with regressions. This
report is not merge approval: external PR CI (`codex-node-checks` lock/flock
recursion owned by #440), Greptile credit exhaustion, and Bugbot usage limits
remain outside this lane. Do not merge from this worktree.

Branch: `fix/silent-fixobserve`
Base: `origin/main` at `46fe111`
Pull request: https://github.com/nish3451/0509/pull/447

## Outcome

This lane remediates C1, C2, M2, M4, M5, M6 and content-sanity F1–F4. C6 is
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
| C1 | `SILENT-FAILURE-AUDIT.md:61-69`: all observation begins inside an invoked scheduled handler; the only reader was release soak. | Added a separate hourly `13 * * * *` deadline reader over `release_scheduled_observation`, with cadence-specific freshness limits and an operator-email alert. Migration 0072 stores an allowlisted per-cron activation baseline, so a newly enabled schedule gets one honest cadence before “never” becomes overdue; an unavailable baseline fails the health read instead of looking healthy. Once established, that baseline is never renewed merely because observation retention removed the last row, so a cron cannot silently regain grace by remaining absent. The migration also indexes `(cron, scheduled_at)` for the freshness aggregate, and its schema test proves all configured deadlines are accepted while unsupported crons are rejected. A separate regression asserts every configured workload cron has a deadline, excluding only the heartbeat. The heartbeat still drains billing-email recovery without passing its unsupported cron into release-soak observation. `scheduled-observation-health.server.test.ts`; heartbeat routing and rejection paging in `worker-scheduled-handler.test.ts`. |
| C2 | Audit lines 71-84 and verifier probes showed fulfilled degraded results had no active consumer; redispatch failures were absent from the fanout result. | Degraded observation results actively page, genuine monthly recap failures page while intentional no-op skips and concurrent `claim_lost` outcomes are tracked separately, redispatch failures are returned/persisted, and inline/digest failures enter the dedicated operational risk mail without a second generic scheduled-monitoring page. Monthly recap reuses the existing lazy delivery-target provisioner, so a paid user with a verified account email is not silently skipped merely because no workspace target row exists yet. The resolver checks exact-address suppression across every target scope before provisioning, treats unusable workspace targets as authoritative, and does not mistake a watchlist target for workspace-digest authorization. A recap dispatch-gate rejection is classified as `claim_lost` only when its durable delivery attempt proves another owner advanced; otherwise it remains a failed recipient, logs a bounded diagnostic, and pages. Expected duplicate scheduled claims are `no_work`; weekly and customer-risk email replays are `no_work` only when their durable attempts prove prior acceptance, while delivery/state-lookup failures remain degraded. Mixed budget, dispatch, inline, and digest failures retain every active category in their idempotency key. Degraded-page delivery failure is logged separately and cannot relabel an already-persisted observation failure. Migration 0071 expands the metrics allowlist. `release-scheduled-observation.server.test.ts`, `monthly-recap.test.ts`, `delivery.server.test.ts`, `scheduled-observation-health.server.test.ts`, and worker tests cover the active consumers. |
| C6 | Audit lines 116-124 plus the old cron-alert test explicitly required a false email send to suppress the next attempt for six hours. | Only `operator_alert_sent` rows throttle and increment the successful-page count. A first failed page keeps one durable `operator_alert_not_sent` fact with `alert_count=0`, does not throttle, and every later failure retries the channel. If a rejected page follows an earlier accepted page, migration 0073 preserves the accepted `last_alerted_at`/`alert_count` throttle evidence while `last_failed_at`/`failed_count` record the newer channel failure; the diagnostic failure counter saturates at 1,000,000 instead of growing without bound. The migration moves counts from legacy `operator_alert_not_sent` rows into failure evidence and resets their false accepted-page count; runtime conflict handling enforces the same invariant. `cron-failure-alert.server.test.ts`, `cron-failure-alert-migration.test.ts`, and the strict release fixture prove upgrade, retry, and both orderings. |
| M2 | Audit lines 166-172: the one-shot Free activation path ended in an empty catch and later scans never retried. | Later successful Free scans re-enter the existing idempotent activation claim; accepted sends remain deduplicated and failures actively page. Before claiming, the sender resolves or lazily provisions a validated, opted-in workspace target for the verified account email, preserves account-wide suppression, and attaches that target ID so the production customer dispatch gate can advance. Provisioning uses one D1 `INSERT … SELECT … WHERE NOT EXISTS` statement over account-wide exact-address suppression; an unsubscribe that wins blocks the insert, while an unsubscribe that follows suppresses the inserted row before the unchanged dispatch CAS can advance. Digest, alert, presence-digest, and activation lazy provisioning all use that atomic primitive. Target lookup/provisioning failure fails closed and pages instead of calling the provider. `data.server.test.ts`, `free-activation-observability.test.ts`, `welcome-activation-emails.test.ts`, and the full monitoring/delivery suite. |
| M4 | Audit lines 182-188: the board loader catch returned an all-zero window with no degradation flag. | Loader returns `captureWindowDegraded`; populated boards show a partial-data notice rather than believable zeros. Empty boards do not get competitor-specific wording. `watchlists.route.test.ts`. |
| M5 | Audit lines 190-196: memory failures became `[]`; report-load/helper failures appeared as revoked/absent approvals, with an old test expecting `{}`. | Memory and approval-read failures are visibly labeled. Saved approvals remain in the response during transient/helper unavailability, while readiness is fail-closed as “unavailable” until refresh. `clients.route.test.ts`. |
| M6 | Audit lines 198-204: a later Meta page exception broke the loop and returned page 1 as if complete. | Retained results now carry `discoveryStatus: healthy` plus a distinct `discoveryPartial: true`, an API-appropriate unavailable failure class, a partial summary and retry cursor. That distinction keeps already-fresh page-one results from being mislabeled as stale/delayed while the UI explicitly says “Fresh partial result” and announces that additional results could not load. The resolver records the failed fetch, preserves the provider’s prior successful timestamp, does not cache the partial response, and marks provider state partial so a successful first page cannot globally cool down unrelated searches. Operator rows and provider state explicitly label partial discovery, including the later-page failure class. Launch readiness excludes partial attempts from complete-result success-rate denominators, reports their own rate, and blocks separately when that rate exceeds 5%, so partial data is neither counted as full failure nor allowed to look healthy. `ad-source.test.ts`, `search-load-more.test.ts`, `meta-ads-readiness.test.ts`, and `ops.route.test.ts`. |
| F1 | `CONTENT-SANITY-SWEEP.md:25-34`; `report-view.test.ts` locked “we could not read this one” into URL/language fields. | URL absence is `none stored`; language absence is `Not detected`; malformed and non-HTTP landing values are treated as missing rather than leaked as raw text. Report evidence links are real 44px phone targets implemented through the repository’s shared CSS layer. |
| F2 | Content sweep lines 36-44: instant Before/Now appeared with no capture clocks. | Before/Now renders only with two real, valid, ordered capture timestamps, and each pane names its capture time. The evaluator now propagates proof capture clocks from the current and previous captures; missing, unparsable, or non-chronological clocks fall back to a complete honest “comparison is not shown because capture times were unavailable or invalid” sentence in both HTML and text-only delivery copy. `watch-event-evaluator.test.ts`, `delivery.server.test.ts`, and the email gallery cover both paths. |
| F3 | Content sweep lines 46-54: scan-trouble mail claimed retries were already running. | Copy now promises only the next scheduled check. `digest-email.test.ts`. |
| F4 | Content sweep lines 56-65: canonical D1 ad columns existed but sparse/stale `raw_json` hid linked report fields. | `listAdsByIds` selects and hydrates every canonical column, with non-null SQL values authoritative over conflicting raw JSON and raw JSON retained when a legacy nullable D1 column is `NULL` or absent, including secondary body and first/last-seen clocks. `data.server.test.ts` covers both directions. |

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
| Focused regression suites | Passed; initial 5 files, 158/158 tests; late-review suite 8 files, 229/229; corrected Gate-B contract 2 files, 21/21; final proof checks 2 files, 17/17; final PR-thread suite 4 files, 42/42; broader scheduler/migration suite 8 files, 62/62; mixed alert-key suite 2 files, 9/9; accepted→rejected alert evidence suite 3 files, 13/13; final degradation/text/claim suite 4 files, 47/47; first adversarial-review suite 4 files, 27/27; verified-email fallback and health-index suite 4 files, 39/39; account suppression and partial-visibility suite 4 files, 133/133; direct-address/partial-denominator suite 2 files, 30/30; explicit partial-rate suite 1 file, 7/7; workspace digest-scope suite 2 files, 25/25; final delivery/data/readiness/operator suite 4 files, 162/162; PR failure-class visibility suite 1 file, 22/22; consolidated F2/F4/M6 review suite 3 files, 156/156; customer-risk replay suite 2 files, 39/39; legacy C6 alert-evidence suite 2 files, 13/13; activation dispatch-target suite 2 files, 6/6; atomic-provision/partial-freshness suite 4 files, 200/200; delivery harness compatibility suite 5 files, 48/48 |
| Lock-wrapped full Vitest | Passed after all review fixes; 387 files, 4,193/4,193 tests. One earlier run hit the deploy-window lock protocol test’s timing race (4,170 passed, 1 failed); that test passed 5/5 in isolation and subsequent complete runs passed. The final pre-green run failed 20 tests because full-module test doubles lacked the new atomic data export; the repaired harnesses exercise the new contract and the next complete run passed. |
| Lock-wrapped typecheck | Passed; Wrangler typegen, React Router typegen, `tsc -b` |
| Full Gate B | Passed; 73/73, first attempt, zero retries |
| `git diff --check` | Passed |
| `sgscan` | Passed on the final diff; exit 0, no new security findings |
| CodeRabbit local | Quota-guarded passes fixed the initial valid findings, scheduler/provider-state issues, partial-cache proof, heartbeat-config/NULL-safe proof, mixed-mode alert-key collision, accepted→rejected throttle evidence ordering, malformed landing handling, bounded channel-failure counts, and partial-result consumers. Stale claims that the health helper lacked `setRows` and broad module-extraction requests were verified against the code and not applied. A proposed removal of the cron allowlist constraint was rejected as gate weakening; migration/config parity tests prove the allowlist stays synchronized. One pass emitted only a report-only request to repeat stale pre-install `npm run build`/`npm test` failures; it was not applied because lock-wrapped install/full Vitest/typecheck and strict Gate B were green. The last permitted pass found two valid existing-lane gaps—F2 fallback wording for invalid clocks and F4 raw fallback for three nullable canonical fields. Both failed first and were fixed in one consolidated remediation; the hourly 3/3 quota then prevented a redundant rerun. |
| CodeRabbit PR | The initial 4 actionable inline findings were verified and fixed (shared CSS, D1 NULL fallback, failed-page count zero, failure-mode-specific alert keys). A later review posted one actionable dispatch-gate diagnostic and identified the verified-account-email fallback plus health-query index outside the narrow diff range; all three were verified and fixed. The terminal review found that the operator's partial-result label hid the retained failure class; its regression failed first and the rendering now preserves both the partial status and cause. The docstring warning and broad client-route extraction request are repository-wide/out-of-lane maintainability work, not correctness findings in this candidate. |
| Greptile PR review | Unavailable: `nish3451 has reached the 50-credit limit for trial accounts`; no inline or general code findings were produced |
| Cross-model adversarial review | Iterative high-thinking Codex-engine passes found valid edge cases in recap dispatch ownership, retention grace, global unsubscribe preservation, operator partial visibility, partial-result readiness denominators, workspace/watchlist delivery scope, idempotent customer-risk replays, legacy C6 count migration, the production Free-activation dispatch target, lazy-provision/unsubscribe atomicity, and fresh-partial presentation. Every accepted finding received a failing-first regression and cause-level fix. The terminal exact-candidate rerun remains required before push. The default Claude-backed command could not authenticate, so it contributed no signal. |
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

- path: `test-results/gate-b-manifest-local-release-local-03d8f8d62304c9fdb4310b9dbe898845.json`
- `schemaVersion`: `3`
- `status`: `passed`
- `strict`: `true`
- `candidateFingerprint`: `69a021f51de2301d66b708cac82019559d51e70a506d9d4a984976940661f366`
- `environment`: `local`
- `serverIdentity`: `local-03d8f8d62304c9fdb4310b9dbe898845`
- entries: `73`
- retries: `0`
- postflight: `j6_retention_alert_count=1`, `j6_retention_alert_mismatch_count=0`, foreign-key violations `0`, scratch restore integrity `ok`, scratch foreign-key violations `0`, scratch database removed `true`, isolated persistence removed `true`, migrations `67`

## Remediation for `pr447-REVIEW-VERDICT.md` (VERDICT: BLOCK)

Cross-model gate blocked at tip `59f590f`. Cause-level remediations below are on
the current candidate; none park or weaken gates.

| Finding | Verdict class | Disposition | Cause-level fix | Regression |
|---|---|---|---|---|
| 1. C2 dual-page `scheduled_monitoring` | **BLOCK** | **Fixed** | Generic `reportDegraded` now suppresses `scheduled_monitoring` the same way it already suppresses `retention_sweep`. Dedicated `sendCustomerAtRiskAlert` remains the sole operator page for budget/dispatch/inline/digest degradation, with failure-mode-specific idempotency keys. | `release-scheduled-observation.server.test.ts` asserts `reportDegraded` is not called for `inlineFailures > 0`. `worker-scheduled-handler.test.ts` asserts exactly one `sendCustomerAtRiskAlert` and no `scheduled_monitoring_degraded` page. |
| 2. Idempotent / no-work outcomes page as degraded | **BLOCK** | **Fixed** | `sendWeeklyBusinessNumbers` returns a reason discriminator; durable accepted attempt → `reason: "duplicate"` classified `no_work`. `duplicates`-only monitoring is `no_work` (pages only on inline/budget/dispatch/digest failure classes). Customer-risk accepted replays follow the same durable-evidence rule. | Classifier cases in `release-scheduled-observation.server.test.ts`; weekly/risk replay coverage in monitoring/workspace suites. |
| 3. Heartbeat “never” grace | **FINDING** | **Fixed** | Migration `0072` + `scheduled_observation_health_state` stores an allowlisted per-cron activation baseline. Absent observation uses baseline, not immediate overdue. Baseline is never renewed merely because retention deleted the last row; unavailable baseline fails the health read. | `scheduled-observation-health.server.test.ts` (one cadence before paging; retention does not renew grace); migration parity suite. |
| 4. Lane report under-states late Codex batch | **FINDING (process)** | **Fixed** | This remediation table + dispositions replace the earlier “two Codex findings” understatement. Early Codex (capture clocks + monthly recap) and late Codex (dual-page, grace, idempotent replay) are both recorded. | Report-only; no product code. |
| 5. Residuals (C6 partial, email-only deadman, CodeRabbit extract, Greptile/Bugbot limits, BEHIND main) | Residual | **Accepted as stated** | Unchanged honest limits from the BLOCK review. No gate weakening. Rebase onto `origin/main` (`e0ed012` lock isolation) remains a land-time merge step, not a product block. | N/A |

GitHub Codex inline threads for findings 1–3 are answered by the fixes above and
should be resolved on the remediation push.

### Follow-up crgate on remediation tip (8 findings)

| Finding | Class | Disposition |
|---|---|---|
| Report “closes” vs merge readiness | major/process | **Fixed** — top status is `remediated, not merge-ready` |
| Non-empty `discoveryPartial` looked complete | major | **Fixed** — answer stays factful but `state: degraded` + partial notice |
| Activation `unsubscribed` overloaded for paused/unvalidated | major | **Fixed** — `target_not_ready`; only true suppression stays quiet |
| Ops partial copy overstated retained evidence | minor | **Fixed** — “Any first-page results…” wording |
| Partial announcement ignored `addedCount` / zero | minor | **Fixed** — count-aware partial announcements |
| Meta API outer catch used browser failure class | minor | **Fixed** — `resolveMetaApiFailureClass` on top-level catch |
| Report omitted build line | minor/process | Noted; lock-wrapped typecheck + full Vitest remain the gate record |
| Dead paused-watchlist fixture data | minor | **Fixed** — fixture trimmed to the workspace-scoped path under test |

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
- Codex’s **early** two inline PR findings were confirmed and fixed: proof-backed
  events now propagate real current/previous capture clocks to the F2 email
  renderer, and monthly recap distinguishes genuine failures from expected no-op
  skips so C2 pages only actionable degradation. Both received focused
  regressions, then the full Vitest, typecheck, and strict Gate B were rerun.
- Codex’s **late** three PR findings (the BLOCK review’s findings 1–3) were also
  confirmed and fixed: scheduled monitoring no longer double-pages through both
  the generic observer and its dedicated risk mail; idempotent scheduled/weekly
  replays are separated from real delivery failure using durable accepted-attempt
  evidence; and a new/reset cron gets one full cadence of durable D1 activation
  grace. See the remediation table above. CodeRabbit’s later mixed-mode
  idempotency finding was valid and fixed so a same-day budget or dispatch page
  cannot suppress a concurrent inline/digest failure. Its claim that the health
  test helper lacked `setRows` was stale; the method and passing reset regression
  were already present. A subsequent accepted→rejected ordering finding was
  valid: migration 0073 now keeps the accepted throttle fact and the later
  channel-failure fact independently instead of allowing either to erase the
  other. The final quota-guarded pass also found and fixed three valid edge
  cases: degraded-page failure now logs on its own path, text-only missing-clock
  copy is a complete sentence, and monthly recap `claim_lost` outcomes no longer
  inflate recipient delivery failures.
- The final high-thinking adversarial pass found two more confirmed edge
  cases. Monthly recap now treats a dispatch-gate rejection as `claim_lost`
  only when the durable attempt proves another owner advanced; an unexplained
  rejection remains a failure. Scheduled-observation retention can no longer
  renew a missing cron's activation baseline. Both failed first, passed their
  focused 27-test suite after repair, and the final adversarial rerun was clean.
- The terminal PR review then caught one legacy paid-user edge: monthly recap
  had bypassed the established lazy email-target provisioner and could skip a
  verified account with no target row. Its failing-first regression sent zero
  recaps; after reusing the opt-out-aware resolver it sends through the durable
  target. The same follow-up makes unexplained dispatch-gate rejection explicit
  in bounded logs and adds the exact health-query index plus migration parity
  proof. Focused tests, full Vitest, typecheck, strict Gate B, and a final
  high-thinking adversarial review all passed afterward.
- The final adversarial loop then proved that lazy provisioning also had to
  preserve account-wide exact-address suppression while keeping workspace
  digest targets distinct from watchlist targets. It also proved that retained
  partial Meta pages must be explicit in both operator rows and readiness:
  partial attempts now have their own rate and blocker rather than distorting
  complete-result success. The failing-first scope/denominator regressions and
  the final 162-test focused suite passed; the terminal high-thinking review
  reported no actionable defects.
- The terminal PR review found one remaining presentation gap in that same M6
  path: the operator-facing partial-result heading displaced the retained
  later-page failure class. Its focused assertion failed first; the repaired
  item now shows both facts, and the final full Vitest, typecheck, and strict
  Gate B all passed.
- The final permitted local review found two further bounded truth gaps. F2's
  fail-closed branch also covers invalid and reversed clocks, so its copy now
  says capture times were unavailable or invalid. F4 now preserves raw
  secondary body and first/last-seen values when their nullable canonical
  columns are `NULL`. Both assertions failed first; the consolidated focused
  suite, full Vitest, typecheck, and strict Gate B passed after repair.
- The exact-candidate adversarial review then found that a same-day
  customer-risk alert replay could be falsely paged as degradation. The
  failing-first proof produced two failures: the durable accepted replay
  lacked a `duplicate` reason and the observer classified it `degraded`.
  Customer-risk alerts now distinguish durable accepted replays from actual
  delivery/state-lookup failures, and the repaired 39-test suite passed.
- The next exact-candidate review found that pre-0073 rejected-email rows had
  already inflated `alert_count`. Its in-memory upgrade proof failed with
  `alert_count=4`, `failed_count=0`, and no failure timestamp. Migration 0073
  now transfers that legacy evidence and resets accepted count to zero; the
  runtime conflict path preserves the invariant. The repaired 13-test suite,
  full Vitest, typecheck, and strict Gate B passed.
- The following exact-candidate review found a P1 in M2: the activation sender
  claimed a customer attempt without a target ID, so production's unchanged
  consent/validation CAS could never advance. Three assertions failed first
  (existing target attachment, lazy provisioning, and account-wide
  suppression). The sender now attaches a validated opted-in target before
  claiming and fails closed when it cannot; the repaired activation suite,
  full Vitest, typecheck, and strict Gate B passed.
- The latest exact-candidate review found two final cause-level gaps. Lazy
  email provisioning still separated suppression read from target upsert, so
  an unsubscribe could race that check; the new D1 primitive makes the
  suppression predicate and insert atomic and every lazy account-email caller
  now uses it. Retained first-page Meta results also inherited the generic
  degraded freshness label; they now carry a distinct fresh-partial flag and
  explicit retry copy. The initial focused run failed three assertions, the
  repaired focused suites passed 200/200 and 48/48, and the final full Vitest,
  typecheck, and strict Gate B passed.
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
