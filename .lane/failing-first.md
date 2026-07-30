# Failing-first evidence

Command (lock-wrapped):

`npx vitest run tests/delivery-attempt-public.test.ts tests/digest-route-presentation.test.ts tests/data.server.test.ts tests/digest-strategy-budget.test.ts tests/agent-actions.server.test.ts tests/customer-agent-actions.server.test.ts tests/monitoring-reliability.test.ts`

Baseline result on `46fe111`: **7 targeted failures, 224 passing**.

| Finding | Failing assertion before implementation |
|---|---|
| C3 | `sent/provider_unknown` returned no recovery message; digest history rendered `Email sent` and `Sent`; ops SQL omitted `status = 'sent'`. |
| C4 | `{ sent: false }` left `digestFailures: 0` and completed all four durable jobs. |
| C5 | failed audit replay threw `AgentActionReplayUnavailableError`; notification failure still returned audit status `succeeded`. |
| C8 | failed alert attempt left `inlineFailures: 0` instead of failing the watchlist run. |

Vitest exited `1` on 2026-07-30 before any production-code changes.

## Post-PR review probes

Command (lock-wrapped):

`npm test -- tests/digest-strategy-budget.test.ts tests/operator-delivery-reconciliation.test.ts tests/plan-monitoring.test.ts tests/data.server.test.ts`

Result against the first remediation candidate, before follow-up production changes:
**4 targeted failures, 140 passing**.

| Review gap | Failing assertion before follow-up |
|---|---|
| C3 ops attention | Accepted/unconfirmed rows were not ordered behind real failures and could consume the eight-row limit. |
| C3 reconciliation | Provider rejection changed an accepted attempt to failed while `digest_delivery` remained `sent`. |
| C4 policy skip | Intentional `disabled` delivery produced four durable job failures instead of four clean completions. |
| C8 unresolved attempt | A `pending` alert detail resolved the run successfully instead of failing it honestly. |

The follow-up focused run passed **145/145**, including a complementary case proving
that a different successful recipient keeps the digest aggregate sent.
