## BET 6 — Move read-only MCP / API access down to free + Scout

Moves the read-only MCP/API surface down to Free + Scout so a free account can
create a read-only customer API key and query its own saved evidence (offer
history, readiness, collections, watchlists, digests) from an agent. Write
scopes and account-mutation tools stay paid.

### What changed

- **`app/lib/plan-feature-gate.server.ts`** is now the single source of truth
  for the MCP tool tier gate. It owns `MCP_READ_ONLY_TOOL_NAMES`,
  `MCP_WRITE_TOOL_NAMES`, `mcpToolFeature()`, `mcpToolTierLabel()`,
  `mcpTierDeniedMessage()`, and `requireReadOrExportFeature()` (JSON reads ride
  the read-only tier; csv/slack exports ride the export features).
- **`app/lib/plan-entitlements.ts`** adds `mcp_read_access` (free + Scout +
  Starter + Agency) and `api_write_access` (Starter + Agency), and moves
  `api_access` down to free + Scout + Starter.
- **`app/routes/api.mcp.ts`** removes the top-level Agency `mcp_access` gate and
  gates per tool: read-only tools need `mcp_read_access` (free + Scout), write
  and account-mutation tools need `mcp_account_actions` (Agency). A tier-denied
  write call returns a clean 403 with the documented tier message. Discovery
  (`tools/list`) and the loader now report the per-tool tier.
- **`app/routes/app.developer-access.tsx` / `.ui.tsx`** let Free and Scout create
  read-only keys; the "Allow approved account actions" checkbox is gated on
  `api_write_access` (Starter+).
- **`app/routes/api.docs.tsx`** copy rewritten to "Read-only access on Free +
  Scout. Writes and exports on Starter+. Full agent actions on Agency." with a
  one-line per-tool tier table on the page.
- **`app/routes/api.v1.ts`**, **`api.v1.$resourceType.$resourceId.ts`**,
  **`docs.tsx`**, **`mcp.setup.tsx`** copy/gate updated to match.
- **`tests/integration/api-mcp-tier-gating.integration.test.ts`** (new) applies
  the real migrations to local D1 and exercises the actual MCP route action with
  a real customer API key: free and Scout keys get 200 on a read-only tool and a
  clean 403 on a write tool.

### Scope note

`memory.read` (`list_memory`) and `web_mentions.list` are listed in the issue's
read-only set but are implemented as write-scoped customer agent actions in the
existing `agent-action-catalog` and the `/api/v1/actions` surface. Ungating them
requires restructuring that catalog (and the api.v1 actions surface), which is
out of scope for this change. They remain Agency here; a follow-up issue covers
ungating them.

### Verification

```
$ npm run test:integration -- api-mcp-tier-gating
 Test Files  1 passed (1)
      Tests  6 passed (6)

$ npm run test:integration
 Test Files  32 passed (32)
      Tests  162 passed (162)

$ npx vitest run --configLoader runner --project node
 Test Files  599 passed (599)
      Tests  7125 passed (7125)
```

run-proof: `npm run test:integration -- api-mcp-tier-gating` → 6/6 passed against real D1; full workers project 162/162; full node project 7125/7125.

net-positive-because: ungating the read-only MCP/API surface is the BET 6 differentiator (the only read-anything-with-an-agent entry point in the category); the added lines are the tier gate, the free-tier key UI, the docs table, and the real-D1 integration test.

Closes #1275
