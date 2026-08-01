# Lane reports

Two remediation lanes wrote evidence to this path independently. Both are kept
verbatim below.

- [MONEY silent-failure remediation](#money-silent-failure-remediation) — PR #445, branch `fix/silent-fixmoney` (landed on `main`)
- [Status-honesty remediation report](#status-honesty-remediation-report) — PR #446, branch `fix/silent-fixstatus`

---

# MONEY silent-failure remediation

## Scope

- C7: paid evidence top-ups could be read as zero when D1 queries failed.
- C9: search-selection spend admission returned before the durable, atomic claim completed.
- M3: monitoring plan lookup failures silently defaulted paying workspaces to the fastest cadence.

Only MONEY-group implementation and regression-test files were changed. No schema, lockfile, deployment configuration, provider resource, or UI copy was changed.

## Failing-first evidence

Command:

```text
flock --exclusive --wait 10800 /home/nish/.local/state/0509/deploy-window.lock \
  npm test -- tests/evidence-usage.test.ts \
  tests/plan-proof-usage-failure.test.ts \
  tests/rate-limit.server.test.ts \
  tests/monitoring-scheduled-runtime.test.ts
```

Baseline result: **5 failed, 60 passed**.

- C7 summary probe expected the top-up read to reject; it instead returned an ordinary summary with `topUpRemaining: 0`.
- C7 history probe expected the read to reject; it instead returned `[]`.
- C7 plan-summary probe expected the top-up failure to propagate; it instead returned the legacy exhausted/zero path.
- C9 probe expected spend admission to complete before returning; `waitUntil` was called once.
- M3 probe expected a plan-read failure to suppress unsafe scheduling; all 27 watchlists were eligible.

## Cause-level remediation

- C7 now distinguishes top-up read failure from a legitimate empty result with a typed error, propagates that error through proof-usage aggregation, and no longer converts a second legacy-store read failure into zero.
- C9 marks search-selection admission as an atomic claim so the existing rate-limit primitive awaits the durable write before granting spend.
- M3 now excludes only workspaces whose plan cannot be read, preserves work for healthy workspaces, and throws after fan-out so the scheduled observer records an honest failure instead of a false no-work success.

Cloudflare D1 behavior was checked against the official prepared-statement, return-object, limits, and database concurrency documentation. The fix relies on documented serial statement execution and treats query rejection as operational failure, not an empty successful result.

## Verification

| Gate | Result |
| --- | --- |
| Lock-wrapped `npm ci` | PASS — 293 packages installed; 294 audited; 0 vulnerabilities |
| Failing-first probes | PASS as evidence — 5 expected failures, 60 passes before implementation |
| Focused MONEY regression suite | PASS — 6 files, 84 tests |
| Lock-wrapped full Vitest | PASS — 385 files, 4,167 tests |
| Lock-wrapped typecheck | PASS — Wrangler type generation, React Router type generation, and `tsc -b` |
| Gate-B local release | PASS — 73/73, strict, 0 failures, 0 retries, 0 first-attempt failures, 254 artifacts |
| `sgscan --baseline-commit HEAD` | PASS — no new security findings |
| `crgate --agent --include-untracked` | `crgate: rate-limited, skipped` — free tier was 3/3; no force override |
| Greptile GitHub review | Informational — trial account has reached its 50-credit limit; no code finding produced |
| Unsolicited GitHub CodeRabbit review | One verified minor test-isolation finding addressed by restoring the `Math.random` spy in `finally`; full Vitest and typecheck re-passed |
| `bugbot-gate status` | `SKIP BUGBOT` — risk `normal`; ordinary code/content diff; use cheaper checks first |

Gate-B covers the canonical journey and content-sanity ugly states. No user-facing copy changed in this lane.

Gate-B manifest:

```text
test-results/gate-b-manifest-local-release-local-10da1228723ed4ea61d0a49b731c4477.json
candidateFingerprint: 909d390fd7c0f32776db2c363eac0d14be9cacb7a57439f1c871fd1435693c30
serverIdentity: local-10da1228723ed4ea61d0a49b731c4477
manifestSha256: f1cf6295a6533c407c861984114590733d1cd036e5f308c6e3a1870714b5516b
```

## Delivery

- Branch: `fix/silent-fixmoney`
- Pull request: https://github.com/nish3451/0509/pull/445
- Merge: not performed

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
