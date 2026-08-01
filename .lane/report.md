# Lane reports

Three remediation lanes wrote evidence to this path independently. All are kept
verbatim below.

- [MONEY silent-failure remediation](#money-silent-failure-remediation) — PR #445, branch `fix/silent-fixmoney` (landed on `main`)
- [Status-honesty remediation report](#status-honesty-remediation-report) — PR #446, branch `fix/silent-fixstatus` (landed on `main`)
- [Silent-failure observability remediation](#silent-failure-observability-remediation) — PR #447, branch `fix/silent-fixobserve`

---

# MONEY silent-failure remediation

**Status: remediated; terminal PR checks green; not merged.** Product findings
from the BLOCK review and the follow-up crgate pass are cause-fixed with
regressions. This report is not merge approval: Greptile credit exhaustion and
Bugbot usage limits prevented findings from those services. Do not merge from
this worktree.

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

# Status-honesty remediation report

Branch: `fix/silent-fixstatus`

## Outcome

| Finding | Status-honest behavior |
|---|---|
| C3 | Email accepted with `sent/provider_unknown` is presented as **Delivery unconfirmed**, receives explicit recovery copy, enters aged operator attention after 15 minutes, and is eligible for evidence-based reconciliation. Real failures are prioritized in the bounded ops list. Later provider rejection corrects both attempt and digest aggregate unless another recipient succeeded, while preserving the original acceptance timestamp and explaining that delivery failed after acceptance. |
| C4 | Every attempted scan-trouble notice that is not accepted fails the durable digest job and remains retryable. Intentional `disabled`, `unverified`, and `no_email` policy skips complete cleanly. A replay that finds the same notice already accepted completes without sending twice. |
| C5 | A saved support case whose operator notification failed now returns the same honest warning while persisting a `failed/support_notification_failed` agent audit. Reuse of the idempotency key atomically reclaims that failed audit and retries the idempotent notification; concurrent reclaim losers do not execute or overwrite the winner. Keys above the support store's 120-character dedupe boundary are rejected before audit or case creation. |
| C8 | Failed or unresolved customer-alert attempts finalize the watchlist run as `failed` (the schema has no `degraded` state), record accepted/attempt/failure counts, preserve `lastScannedAt`, and propagate failure into scheduled `inlineFailures`. Intentional quiet-hours deferrals remain durable deferrals, are counted separately from provider attempts, and do not fail the scan. The direct-website recovery branch has the same contract. |

No delivery/provider gate was loosened. Monitoring continues to fail rather than substitute demo data.

## Failing-first evidence

The lock-wrapped targeted baseline on `46fe111` exited 1 with **7 failures and 224 passing tests**. Full assertions are preserved in [failing-first.md](./failing-first.md).

| Finding | Red before production changes |
|---|---|
| C3 | Missing recovery message; digest history said `Email sent` / `Sent`; ops query excluded `sent/provider_unknown`. |
| C4 | A `{ sent:false }` scan-trouble result left `digestFailures: 0` and completed all four jobs. |
| C5 | Failed support notification was audited as succeeded, and the same key replayed instead of retrying. |
| C8 | A failed alert attempt left `inlineFailures: 0` and the run succeeded. |

Two subsequent review candidates were also tested before their production changes:

- first follow-up: **4 targeted failures / 140 passing**;
- final-head follow-up: **3 targeted failures / 37 passing**, covering quiet-hours deferral, preserved provider-acceptance history, and acceptance-aware recovery copy.
- final C5 follow-up: **1 targeted failure / 77 passing**, proving an oversized API/MCP key reached support persistence despite being unusable for case dedupe.

## Cause-level changes

- Delivery truth: public/customer readers distinguish provider acceptance from confirmed delivery; aged accepted/unconfirmed attempts are visible to ops and existing evidence reconciliation; later rejection preserves and explains the earlier provider acceptance.
- Durable digest truth: an attempted trouble notice must be accepted before its schedule job can complete; explicit customer/account policy skips are not delivery failures.
- Agent audit truth: resolved application-level failures can persist a failed audit, support notification retries use a conditional `failed → started` reclaim, and support keys above the case store's 120-character dedupe limit are rejected before audit or case creation.
- Monitoring truth: delivery details determine run status and counters; durable quiet-hours state is propagated as an explicit deferral, while actual unresolved/failed attempts record the durable failed state before the error is propagated.

Cloudflare Email Service semantics were checked against the current official Workers API, logs, and event-subscription documentation. The send binding returns provider acceptance, while delivery is a later state. This lane did not create or modify provider resources.

## Scope

Only the status-honesty cause paths, their data barrels, and focused tests were touched. No sibling-lane source file was needed.

## Verification

| Gate | Result |
|---|---|
| Failing-first probes | PASS as evidence: 7 red / 224 green initially; 4 red / 140 green, 3 red / 37 green, and 1 red / 77 green on review follow-ups |
| Locked `npm ci` | PASS — 293 packages, 0 vulnerabilities |
| Focused status-honesty Vitest | PASS — initial 10 files / 255 tests; first review 4 files / 145 tests; delivery review 5 files / 77 tests; final C5 API/MCP review 3 files / 120 tests |
| API/MCP route regression probes | PASS — 2 files, 42 tests |
| Locked full Vitest | PASS — 385 files, 4,174 tests |
| Locked typecheck | PASS |
| Gate-B local release | PASS — 73/73 in 4.0 minutes, journeys 1–6, strict |
| `git diff --check` | PASS |
| Secret-pattern diff scan | PASS — no matches |

Gate-B manifest:

- file: `test-results/gate-b-manifest-local-release-local-f1b57e9ff7d209ea8b91c5fb9400dcc3.json`
- `"schemaVersion": 3`
- `"candidateFingerprint": "c399faba4076a4a7b235216ef23c473d3673954772c7cd6f443d3da851952b3c"`
- `"environment": "local"`
- `"runOrigin": "http://127.0.0.1:35355"`
- `"serverIdentity": "local-f1b57e9ff7d209ea8b91c5fb9400dcc3"`
- `"status": "passed"`
- `"strict": true`
- `"entries": 73`; non-passing entries: `0`
- postflight: journeys `[1,2,3,4,5,6]`, `"integrity": "ok"`, `"foreignKeyViolations": 0`, `"scratchDatabaseRemoved": true`, `"isolatedPersistenceRemoved": true`

### Content sanity

The journey-visible change is limited to delivery wording. The full release journey was inspected at customer and operator-recovery surfaces, including failure recovery:

- `j3-digest-375x812-digest-notifications.png`
- `j3-first-brief-1440x900-first-brief-front-page.png`
- `j6-support-1440x900-support-failure-recovery.png`

No nonsensical field values or contradictory labels were observed. Known fixture identities match the repository’s content-sanity artifact.

## Four-pass review stack

| Pass | Result |
|---|---|
| `sgscan` | PASS — final staged diff scanned against `origin/HEAD`; no new security findings. |
| `crgate` | Initial local review: 4 findings, 1 fixed and 3 rejected after code verification. The automatically attached PR review later exposed status-honesty gaps that were reproduced red and fixed. The previous full-diff local review returned 0 findings. Final delta: `crgate: rate-limited, skipped` after `crgate --quota` reported 3/3 reviews used; no `--force` was used. |
| Greptile | The GitHub app returned no code findings because the account has reached its 50-credit trial limit. |
| `bugbot-gate status` | `ALLOW BUGBOT`; the automatically attached Bugbot check then hit its usage limit and completed neutral. No direct Bugbot invocation was made. |

The additional configured `autoreview --thinking high` attempt was unavailable because its OAuth session had expired; it produced no finding and consumed no review.

### CodeRabbit finding decisions

| Finding | Decision |
|---|---|
| Persisted direct-website recovery integration status omitted the later alert-delivery failure | **Fixed.** The integration observation now distinguishes discovery failure, completed website evidence, and failed customer notification, with accepted/attempt/failure metadata. A regression drives this exact fallback path. |
| Extract the 18-line scan-trouble orchestration policy into another module | **Rejected.** It is orchestration policy used only by this module; extracting a one-function module would widen the import/mock boundary without separating a reusable domain. The helper already centralizes all three callers. Revisit if another owner appears. |
| Change a valid `Asia/Kolkata` test fixture timezone to `UTC` | **Rejected.** Timezone does not participate in the duplicate-claim branch, and both values are valid IANA zones; changing it would add no guarantee. |
| Prevent failed evidence from reconciling `sent/provider_unknown` | **Rejected.** A later provider bounce/failure is exactly the evidence that must correct an accepted-but-unconfirmed email. Blocking that transition would recreate C3. Reconciliation remains evidence- and audit-gated. |

### Post-PR review decisions

| Finding | Decision |
|---|---|
| Treat `pending` customer-alert details as unsuccessful | **Fixed.** Every non-`sent` detail is now an honest failure; red/green coverage drives the direct-website fallback. |
| Do not fail digest jobs for intentional delivery opt-outs | **Fixed.** `disabled`, `unverified`, and `no_email` complete as policy skips; `duplicate`, `claim_lost`, and provider failure remain retryable failures. |
| Downgrade an accepted digest when provider evidence later rejects it | **Fixed.** Attempt and aggregate now agree; a separate successful recipient is the only preservation case, covered by SQLite/D1 tests. |
| Keep unconfirmed sends from hiding real ops failures | **Fixed.** Failed attempts sort first inside the bounded attention query. |
| Do not fail scans for intentional quiet-hours deferrals | **Fixed.** The delivery summary carries the durable deferral bit, send attempts/failures exclude it, a separate deferral count is persisted, and the scan completes successfully. |
| Preserve provider acceptance history after later rejection | **Fixed.** Failed evidence retains the original `sent_at`, and public recovery copy distinguishes rejection after acceptance from pre-acceptance failure. |
| Reject support keys above the case dedupe limit | **Fixed.** `support_case.create` rejects keys longer than 120 characters before audit or case persistence, preventing a notification retry from inserting a duplicate case. |
| Clarify “follow-up focused run” in the evidence note | **Fixed.** The sentence now says “The follow-up run passed 145/145.” |
| Redact the local repository path from the Bugbot block | **Rejected.** The mandatory lane canon requires the complete gate decision verbatim. Altering only its `repo:` line would make the evidence non-verbatim; the path contains no credential or customer data and was already supplied as the task worktree. |
| Extract duplicated action/monitoring orchestration helpers | **Rejected.** These are local policy branches with distinct inputs; extraction would widen change scope without altering correctness. |
| Centralize the two customer-facing unconfirmed classifiers | **Rejected.** The route label and recovery-message policy intentionally have different output contracts; both are directly covered. |
| Replace the pre-existing trusted reconciliation SQL builder | **Rejected.** The builder selects only internal constant scopes/qualifiers and binds runtime values. Rewriting the whole reconciliation query family is outside this bounded status lane. |
| Add 80% docstring coverage | **Rejected.** This is a repository-wide informational warning, unrelated to the diff and not a status-honesty gate. |

### Bugbot gate decision (verbatim)

```text
ALLOW BUGBOT
risk: high
reason: High-risk or critical diff. One paid Bugbot run is justified.
repo: /home/nish/workspaces/products/0509-fixstatus
branch: fix/silent-fixstatus
base: origin/main
diff: 29 files, +1312/-69
fingerprint: 2dc146764c05a9794223e93d54ab9247f486c8c37a733d83e0728902c9442d0a
signals:
- high-risk path: tests/billing-lifecycle-attempts-data.test.ts
next: paid Bugbot is justified but optional spend; ask Nish only before spending.
prompt: Bugbot is recommended for this diff. It may cost about $1. Should I run it once?
if declined: run or confirm stronger no-spend gates, including focused autoreview, then continue if clean.
after approval: run /review-bugbot once, then run `bugbot-gate mark-bugbot`.
```

The repository's canonical lane policy says to record this decision and never invoke Bugbot directly. GitHub's automatically attached Cursor Bugbot check independently attempted a review, hit its usage limit, and completed neutral.

## PR

- Non-draft PR: https://github.com/nish3451/0509/pull/446
- Gitleaks: passed.
- CI: the final-head result is tracked by the PR check. Earlier attempts that overlapped another lane failed only at shared-lock acquisition; build, test, and typecheck never started in those attempts.
- Greptile: no code review was available because its GitHub app reported the account's 50-credit trial limit reached.
- Merge: not performed.

---

# Silent-failure observability remediation

**Status: remediated; terminal PR checks green; not merged.** Product findings
from the BLOCK review and the follow-up crgate pass are cause-fixed with
regressions. This report is not merge approval: Greptile credit exhaustion and
Bugbot usage limits prevented findings from those services. Do not merge from
this worktree.

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

Gate B manifest source of truth (final remediation source):

- deterministic path: `test-results/gate-b-manifest-pr447-final.json`
- acceptance contract: `schemaVersion=3`, `status=passed`, `strict=true`,
  `strictIssues=null`, 73 passed entries, zero postflight mismatches/foreign-key
  violations, scratch restore integrity `ok`, scratch database removed, and
  isolated persistence removed
- the report intentionally does not self-embed the final fingerprint: this
  tracked report is part of the hashed candidate. The handoff prints the
  observed terminal artifact fields after the immutable run.

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

### Terminal exact-candidate and delta reviews (2 P2 + 1 P3)

| Finding | Disposition |
|---|---|
| Opaque Meta API failures still used `browser_unavailable` | **Fixed** — `provider_unavailable` is now a distinct runtime/D1 class; migration 0074 preserves old evidence and hot indexes while extending both failure-class checks |
| Partial exact-domain results retained “No verified ads found” | **Fixed** — title and zero fact explicitly say “loaded so far” while the answer remains degraded and retryable |
| Provider-neutral failures silently shortened outage cooldown | **Fixed** — an explicit `provider_unavailable` switch preserves the established five-minute backoff rather than falling through to the two-minute public-search default |

Failing-first focused evidence produced exactly 2 failures for the P2 set and
1 failure for the P3; the repaired provider/partial/migration suite passed 94/94.

### Post-push PR review (1 P2 finding)

| Finding | Disposition |
|---|---|
| Reclaimed legacy activation attempts retained `delivery_target_id=NULL` | **Fixed** — the exact-version reclaim update fills only a missing target from the resolved claim input; existing non-null target ownership is never rewritten, and the unchanged customer dispatch CAS remains the consent/readiness gate |

The integration regression failed first on the durable NULL row, then proved
the same attempt is reclaimed in place with the current target and advances
through `markInstantDeliveryDispatchStarted`. The complete run first exposed
two stale SQLite harnesses that omitted the production column; after bringing
those fixtures to schema parity, the focused claim/activation suite passed
24/24.

### Consolidated terminal CodeRabbit remediation (5 findings)

| Finding | Disposition |
|---|---|
| Migration tests did not prove invalid failure classes remain rejected in both stores | **Fixed** — both rebuilt `CHECK` constraints are exercised with rejected invalid updates |
| Positive partial results retained definitive verified/broader titles and fact labels | **Fixed** — every positive partial state now says “loaded so far,” remains degraded, and retains the retry instruction |
| Zero-ad partial results discarded broader/raw candidate counts | **Fixed** — the partial summary and fact rail preserve related candidates loaded so far without presenting a complete no-ads result |
| Migration 0074 left SQLite foreign-key enforcement disabled | **Fixed at the documented D1 cause** — the rebuild uses transaction-scoped `defer_foreign_keys` instead of unsupported migration-time enforcement toggling; the regression proves `foreign_keys=1` survives |
| Partial broader-match behavior lacked direct coverage | **Fixed** — the regression asserts degraded state, qualified title/facts, partial summary, and retry copy |

The failing-first run produced four failures: foreign-key enforcement was left
off, the zero-ad related-candidate fact was absent, and both positive verified
and broader partial titles were definitive. The repaired activation, search,
and migration suite passed 108/108 across five files.

### Terminal post-fix CodeRabbit pass (2 minor findings)

| Finding | Disposition |
|---|---|
| Successful discovery recovery did not explicitly assert stale `discoveryPartial` is cleared | **Fixed (coverage)** — the existing success-after-partial regression now requires `discoveryPartial: false` |
| Report gates should be marked incomplete because the review sandbox could not execute project binaries | **Rejected after direct verification** — the authoritative project commands resolved the binaries and passed under the lock: typecheck completed all three stages and full Vitest passed 389 files / 4205 tests |

### Historical CodeRabbit review-body audit (1 major + 4 nitpicks)

| Finding | Disposition |
|---|---|
| Alert target reuse did not check account-wide exact-address suppression | **Fixed** — digest and alert resolution now share the same suppression reader before any target reuse or provisioning; the regression failed first by returning the suppressed target, then passed with no targets |
| `ad-source.server.ts` exceeds the file-size guideline | **Accepted non-correctness residual** — extracting the existing 1,600+ line provider module is a repository refactor, not a bounded remediation of this PR’s behavior |
| Fresh partial pages intentionally bypass cache/cooldown and can retry upstream work | **Accepted deliberate tradeoff** — caching a known-incomplete page or globally cooling unrelated searches would weaken result truth; interactive depth is bounded, partial evidence is retained, and retry remains explicit |
| Partial no-verified qualification was coupled to exact title text | **Fixed by the terminal search remediation** — `qualifyPartialSearchAnswer` now dispatches on the typed answer state |
| Email-target resolution is duplicated across delivery modules | **Partially reduced without broad rewrite** — digest and alert paths now share the exact-address suppression primitive; consolidating activation/presence provisioning across modules is a separate architectural change with materially wider regression scope |

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
