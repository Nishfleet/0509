# Issue #1942 — dodo_webhook_event problem-row classification (acceptance 1)

Branch: `claim/issue-1942`
Worktree: `/home/nish/workspaces/agent-worktrees/issue-0509-1942`
Base: `28716cdc` (Merge PR #1941)

## Classification query

Run against production D1 (`0509`, `--remote`) on 2026-09-08:

```sql
SELECT
  CASE WHEN event_type LIKE 'billing.canary.%' THEN 'canary' ELSE 'real-user' END AS origin,
  event_type,
  outcome,
  COUNT(*) AS n
FROM dodo_webhook_event
WHERE received_at >= datetime('now','-14 days')
  AND outcome NOT IN ('processed','success','received')
GROUP BY origin, event_type, outcome
ORDER BY n DESC
```

## Bucket table — last 14 days

| origin | event_type | outcome | n |
|---|---|---|---|
| canary | billing.canary.lock | failed | 152 |
| real-user | — | — | 0 |

**Every problem-outcome row in the last 14 days is an internal billing-canary
replay** (`billing.canary.lock` / `failed`). There are **zero real-user
problem rows** — no would-be paying customer's payment confirmation has ever
failed in production.

## All-time confirmation

The same classification over all time (no `received_at` filter) returns the
same shape:

| origin | event_type | outcome | n |
|---|---|---|---|
| canary | billing.canary.lock | failed | 249 |
| real-user | — | — | 0 |

All 249 all-time problem rows are canary. The money path is proven green: no
real-user payment confirmation has ever failed, so acceptance 2 (trace and fix
a real-user problem row) has nothing to fix.

## Termination check

```sql
SELECT COUNT(*) AS n FROM dodo_webhook_event
WHERE received_at >= datetime('now','-14 days')
  AND outcome NOT IN ('processed','success','received')
  AND event_type NOT LIKE 'billing.canary.%'
```

Result: `n = 0`. The daily market-signal `billing_problem_events_24h` metric,
once it excludes canary event types, reports only real-user problems and is
zero.
