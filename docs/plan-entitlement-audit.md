# Plan Entitlement Audit — Final adversarial pass (2026-06-24)

Branch: `cursor/plan-entitlements-topups-no-prices-20260623` (PR #234).

## Resolved merge blockers

| Area | Final behavior |
|------|----------------|
| Monthly periods | Subscription-anchored via `evidence_entitlement_anchor` (`0053`); no UTC calendar reset |
| Top-up ledger | Immutable grants; `evidence_top_up_ledger_entry` authoritative; `quantity_remaining` cache |
| Legacy credits | One-time migration via `proof_usage_credit_migration`; no dual-count fallback |
| Top-up spend | Retained after cancel; spend requires active paid plan |
| Feature gates | `plan-feature-gate.server.ts` on API, MCP, exports, shares, reports, team, sources |
| Queue priority | Ranked eligibility before concurrency slot claim; aging prevents starvation |
| Evidence checks | Scheduled monitoring free; successful unique proof capture debits allowance |
| Prices | Unconfigured; no hardcoded monetary values in entitlements |

## Feature enforcement matrix (server)

| Feature | Scout | Starter | Agency | Enforced at |
|---------|:-----:|:-------:|:------:|-------------|
| `api_access` | — | — | ✓ | `api.v1.*`, sources API key create |
| `mcp_access` | — | — | ✓ | `api.mcp` action |
| `mcp_account_actions` | — | — | ✓ | `api.v1.actions`, MCP write tools |
| `export_csv/json/slack_ready` | — | ✓ | ✓ | `/export/*`, `/api/v1/*`, MCP read exports |
| `share_links` | — | — | ✓ | watchlists/collections/digests/reports + agent |
| `client_reports` / `pdf_reports` | — | — | ✓ | `/app/reports` |
| `slack_delivery` | — | ✓ | ✓ | sources + agent delivery actions |
| `high_priority_alerts` | — | ✓ | ✓ | delivery toggles when enabling instant |
| `team_workspace` | — | — | ✓ | `/app/team`, workspace invites |
| Watchlist/board limits | limit | limit | limit | `checkPlanLimit` |

## Not activated in this pass

- Remote D1 migrations `0049`–`0053`
- Dodo product/price configuration
- Checkout activation
- Monitoring fan-out (`MONITORING_FANOUT_MODE` remains `inline`)
