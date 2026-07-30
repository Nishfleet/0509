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
