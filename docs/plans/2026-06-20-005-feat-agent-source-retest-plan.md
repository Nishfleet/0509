---
title: "feat: Add agent-safe source retest"
date: "2026-06-20"
branch: "codex/0509-paid-customer-agentic-saas"
status: "implemented"
---

# feat: Add agent-safe source retest

## Goal

Let a write-enabled Agency customer API key ask Five to Nine to retest the account's saved Meta source connection without exposing, accepting, or mutating the secret token itself.

## Scope

- Add a narrow audited agent action: `source.meta.retest`.
- Keep token connection, replacement, disconnection, and secret-bearing setup app-owned.
- Return only safe connection status, summary, error code, timestamps, and coarse source label.
- Audit the action with bounded metadata.
- Surface the action in API/MCP catalogs and public/agent-readable docs through the existing catalog source of truth.

## Files

- `app/lib/agent-action-catalog.ts`
- `app/lib/customer-agent-actions.server.ts`
- `app/lib/mcp-agent-action-groups.ts`
- `app/routes/api.mcp.ts`
- `tests/customer-agent-actions.server.test.ts`
- `tests/mcp.route.test.ts`
- `tests/mcp.discovery-route.test.ts`
- `tests/api-v1.route.test.ts`
- `tests/public-markdown.test.ts`

## Verification

- Focused customer action, API docs, MCP, and public markdown tests.
- Typecheck.
- Full test suite and build if the commit hook runs them.
- Autoreview on the final branch diff before treating the branch as ready.
