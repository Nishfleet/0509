# Status-honesty remediation report

Branch: `fix/silent-fixstatus`

## Outcome

| Finding | Status-honest behavior |
|---|---|
| C3 | Email accepted with `sent/provider_unknown` is presented as **Delivery unconfirmed**, receives explicit recovery copy, enters aged operator attention after 15 minutes, and is eligible for evidence-based reconciliation. Provider acceptance is no longer presented as terminal delivery. |
| C4 | Every scan-trouble-notice branch now throws on `{ sent:false }`, so the durable digest job fails and remains retryable. A replay that finds the same notice already accepted completes without sending twice. |
| C5 | A saved support case whose operator notification failed now returns the same honest warning while persisting a `failed/support_notification_failed` agent audit. Reuse of the idempotency key atomically reclaims that failed audit and retries the idempotent notification; concurrent reclaim losers do not execute or overwrite the winner. |
| C8 | Failed customer-alert attempts finalize the watchlist run as `failed` (the schema has no `degraded` state), record accepted/attempt/failure counts, preserve `lastScannedAt`, and propagate failure into scheduled `inlineFailures`. The direct-website recovery branch has the same contract. |

No delivery/provider gate was loosened. Monitoring continues to fail rather than substitute demo data.

## Failing-first evidence

The lock-wrapped targeted baseline on `46fe111` exited 1 with **7 failures and 224 passing tests**. Full assertions are preserved in [failing-first.md](./failing-first.md).

| Finding | Red before production changes |
|---|---|
| C3 | Missing recovery message; digest history said `Email sent` / `Sent`; ops query excluded `sent/provider_unknown`. |
| C4 | A `{ sent:false }` scan-trouble result left `digestFailures: 0` and completed all four jobs. |
| C5 | Failed support notification was audited as succeeded, and the same key replayed instead of retrying. |
| C8 | A failed alert attempt left `inlineFailures: 0` and the run succeeded. |

## Cause-level changes

- Delivery truth: public/customer readers distinguish provider acceptance from confirmed delivery; aged accepted/unconfirmed attempts are visible to ops and existing evidence reconciliation.
- Durable digest truth: a trouble notice must be accepted before its schedule job can complete.
- Agent audit truth: resolved application-level failures can persist a failed audit, and support notification retries use a conditional `failed → started` reclaim.
- Monitoring truth: delivery details determine run status and counters; the durable failed state is recorded before the error is propagated.

Cloudflare Email Service semantics were checked against the current official Workers API, logs, and event-subscription documentation. The send binding returns provider acceptance, while delivery is a later state. This lane did not create or modify provider resources.

## Scope

Only the status-honesty cause paths, their data barrels, and focused tests were touched. No sibling-lane source file was needed.

## Verification

| Gate | Result |
|---|---|
| Failing-first probes | PASS as evidence: expected 7 red / 224 green before implementation |
| Locked `npm ci` | PASS — 293 packages, 0 vulnerabilities |
| Focused status-honesty Vitest | PASS — 10 files, 255 tests |
| API/MCP route regression probes | PASS — 2 files, 42 tests |
| Locked full Vitest | PASS — 385 files, 4,168 tests |
| Locked typecheck | PASS |
| Gate-B local release | PASS — 73/73, journeys 1–6, strict |
| `git diff --check` | PASS |
| Secret-pattern diff scan | PASS — no matches |

Gate-B manifest:

- file: `test-results/gate-b-manifest-local-release-local-e61406fb0af0f49b83a638fa52a5d2a6.json`
- `"schemaVersion": 3`
- `"candidateFingerprint": "2a09d486355adf9e643586ce6efc93ddafb15d7213ad39ba324c19445cfb825f"`
- `"environment": "local"`
- `"runOrigin": "http://127.0.0.1:37375"`
- `"serverIdentity": "local-e61406fb0af0f49b83a638fa52a5d2a6"`
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
| `sgscan` | The final staged run still reported “No diff against origin/HEAD” and scanned the whole tree. It exited 1 on repository-wide existing warnings; the only warning in an owned file is an unchanged dynamic `RegExp` line in operator reconciliation. No ERROR or introduced match was identified. |
| `crgate` | Completed one available local review: 4 findings, 1 fixed, 3 rejected after code verification (decisions below). |
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

### Bugbot gate decision (verbatim)

```text
ALLOW BUGBOT
risk: high
reason: High-risk or critical diff. One paid Bugbot run is justified.
repo: /home/nish/workspaces/products/0509-fixstatus
branch: fix/silent-fixstatus
base: origin/main
diff: 29 files, +893/-52
fingerprint: 6562729c4a1565d81e4a258a334a189f0e36d4e998cce689c8aa1cef144f0eb6
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
- CI: pending a clean retry after the shared deployment lock is released. The initial run and first retry failed only at lock acquisition; build, test, and typecheck never started.
- Greptile: no code review was available because its GitHub app reported the account's 50-credit trial limit reached.
- Merge: not performed.
