# MONEY silent-failure remediation

**Status: remediated; terminal PR checks green; not merged.** Product findings
from the BLOCK review and the follow-up crgate pass are cause-fixed with
regressions. This report is not merge approval: Greptile credit exhaustion and
Bugbot usage limits prevented findings from those services. Do not merge from
this worktree.

Branch: `fix/silent-fixobserve`
Base: `origin/main` at `46fe111`
Pull request: https://github.com/Nishfleet/0509/pull/447

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
| M6 | Audit lines 198-204: a later Meta page exception broke the loop and returned page 1 as if complete. | Retained results now carry `discoveryStatus: healthy` plus a distinct `discoveryPartial: true`, a provider-appropriate failure class, a partial summary and retry cursor. Opaque Meta API failures use the provider-neutral `provider_unavailable` class rather than the browser taxonomy; migration 0074 preserves both discovery evidence stores and their indexes while expanding the D1 allowlist. The new class explicitly retains the prior five-minute outage backoff instead of silently falling through to the two-minute public-search default. That distinction keeps already-fresh page-one results from being mislabeled as stale/delayed while the UI explicitly says “Fresh partial result” and announces that additional results could not load. Partial exact-domain pages also qualify definitive zero-verification headlines and facts as “loaded so far.” The resolver records the failed fetch, preserves the provider’s prior successful timestamp, does not cache the partial response, and marks provider state partial so a successful first page cannot globally cool down unrelated searches. Operator rows and provider state explicitly label partial discovery, including the later-page failure class. Launch readiness excludes partial attempts from complete-result success-rate denominators, reports their own rate, and blocks separately when that rate exceeds 5%, so partial data is neither counted as full failure nor allowed to look healthy. `ad-source.test.ts`, `discovery-failure-class-migration.test.ts`, `search-answer.test.ts`, `search-load-more.test.ts`, `meta-ads-readiness.test.ts`, and `ops.route.test.ts`. |
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
| Lock-wrapped `npm ci` | Passed on remediation tip; 291 packages added / 292 audited, 0 vulnerabilities |
| Focused regression suites | Passed; BLOCK-remediation suite 4 files, 30/30; crgate follow-up suite 8 files, 161/161; terminal provider/partial suite 3 files, 94/94; final activation/search/migration suite 5 files, 108/108; alert suppression suite 1 file, 26/26 |
| Lock-wrapped full Vitest | Passed on final remediation source; **389** files, **4205/4205** tests |
| Lock-wrapped typecheck | Passed on final remediation source; Wrangler typegen, React Router typegen, `tsc -b` |
| Full Gate B | Deterministic final artifact below is the source of truth; handoff is allowed only when its terminal fields are strict/pass with 73 passed entries |
| `git diff --check` | Passed |
| `sgscan` | Passed on the final diff; exit 0, no new security findings |
| CodeRabbit local (`crgate`) | Initial remediation tip: 8 findings (3 major / 5 minor), all actionable product findings fixed with regressions. A later 5-finding consolidated set was fixed at cause. The terminal post-fix pass produced 2 minor items: explicit stale-partial reset coverage was added, while its report warning was rejected after the actual lock-wrapped typecheck and full Vitest completed successfully (see follow-up tables). |
| CodeRabbit PR | The initial 4 actionable inline findings were verified and fixed (shared CSS, D1 NULL fallback, failed-page count zero, failure-mode-specific alert keys). A later review posted one actionable dispatch-gate diagnostic and identified the verified-account-email fallback plus health-query index outside the narrow diff range; all three were verified and fixed. The terminal review found that the operator's partial-result label hid the retained failure class; its regression failed first and the rendering now preserves both the partial status and cause. A historical outside-diff major found during the final audit was also fixed: alert target reuse now honors account-wide exact-address suppression before delivery. A post-push Codex PR review then found that reclaiming a pre-target activation failure left `delivery_target_id=NULL`; the generic reclaim CAS now attaches only a missing current target before dispatch. The docstring warning and broad client-route extraction request are repository-wide/out-of-lane maintainability work, not correctness findings in this candidate. |
| Greptile PR review | Unavailable: `nish3451 has reached the 50-credit limit for trial accounts`; no inline or general code findings were produced |
| Cross-model adversarial review | BLOCK review (`pr447-REVIEW-VERDICT.md`) findings 1–3 fixed at cause. Earlier Codex-engine passes also found valid edge cases in recap dispatch ownership, retention grace, global unsubscribe preservation, operator partial visibility, partial-result readiness denominators, workspace/watchlist delivery scope, idempotent customer-risk replays, legacy C6 count migration, the production Free-activation dispatch target, lazy-provision/unsubscribe atomicity, and fresh-partial presentation. The terminal exact-candidate pass found two further P2s: opaque Meta API errors still used a browser class, and one partial exact-domain path retained a definitive zero-verification headline. Both failed first and were fixed at cause. The follow-up delta review found one P3 backoff regression; it also failed first and the provider-neutral class now retains the established five-minute cooldown. The exact eight-file Claude pass accepted no actionable findings at 0.85, and the final alert-suppression delta passed a separate exact review at 0.90. |
| `bugbot-gate status` | `ALLOW BUGBOT` / `risk: high` for the terminal code fingerprint; one run was triggered and marked. Cursor returned its expected usage-limit result, so no Bugbot findings were produced. |

### PR CI terminal result

Historical GitHub run `30545966908` retained a Vitest worker after every test
file passed because its merge ref contained the older deploy-window shim
recursion described below. The owning lane subsequently repaired that shared
runner path. On remediation code tip `374570f`, exact-head run `30583993791`
passed install, build, full test, and typecheck in 3m3s; Gitleaks run
`30583993799` and backup-tool validation run `30583993779` also passed.

The historical merge ref included `origin/main` commit `e0ed012` (#440), which
was newer than this lane's `46fe111` base and added the deploy-window
compatibility tests. On that old CI run, `command -v flock` resolved to the
installed `/home/nish/.local/bin/flock` compatibility shim and its fd-lock
probe executed the shim as its own “real” flock indefinitely:

`deploy-window-lock.sh -> /home/nish/.local/bin/flock -> deploy-window-lock.sh`

The second historical attempt reproduced that recursion under
`tests/deploy-window-lock.test.ts`; no candidate assertion failed. This lane
correctly did not edit #440's lock/CI ownership. The green terminal run proves
the external blocker is now cleared without gate weakening or cross-lane edits.

The GitHub-installed Bugbot hook ran independently of this lane command and returned a neutral usage-limit result. The lane did not invoke Bugbot directly and followed the `bugbot-gate status` decision above.

---
