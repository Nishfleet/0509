---
title: "feat: Add paid-customer agentic SaaS readiness"
type: "feat"
date: "2026-06-20"
---

# feat: Add paid-customer agentic SaaS readiness

## Summary

Raise 0509's paid customer surface toward a full agent-operable SaaS: customers should see workspace readiness, agent readiness, support paths, trust boundaries, and the exact live action set from one consistent product truth layer. External Slack, Dodo, and uptime blockers stay explicit, but they do not block in-repo customer-grade readiness.

---

## Problem Frame

0509 already has paid plans, Better Auth, Dodo billing, Cloudflare Email, watchlists, boards, reports, share links, readiness, memory, client rooms, and audited agent actions. The remaining in-repo gap is not "add AI"; it is making the paid customer experience feel complete: setup, agent operation, customer support, trust, and docs need to line up so a paying customer or their agent can operate the workspace without Nish explaining the system.

---

## Requirements

**Customer-grade activation**

- R1. The app must show whether the workspace has active API keys, write-enabled keys, and the next safe customer action.
- R2. The app must present the first agent workflow end to end: check readiness, create or tune watchlists, add proof, create a brief/report, save memory, and share results.
- R3. The app must keep secret-bearing setup, billing mutation, team invites, and external sends app-owned or support-owned until safe approval flows exist.

**Agent and support parity**

- R4. API route docs, MCP docs, public API docs, and app copy must use one shared action catalog instead of duplicated action-name lists.
- R5. The shared catalog must preserve the existing action identifiers expected by `/api/v1/actions` and `/api/mcp`.
- R6. Paid customer support paths must be visible for billing changes, cancellation, deletion, account access, migration, and security reports.

**Launch-safe product truth**

- R7. Public docs and agent-readable markdown must describe live audited actions without claiming broad public write APIs, unsupported-channel ingestion, or launch readiness that production canaries have not proven.
- R8. Tests must verify the app/docs show the paid-customer boundary and do not expose API secrets, webhook URLs, provider tokens, or unsupported claims.

---

## Key Technical Decisions

- KTD1. Shared catalog module: Add `app/lib/agent-action-catalog.ts` as the source of truth for action names, action groups, setup steps, support paths, and blocked capabilities.
- KTD2. App-owned setup remains central: Improve `/app/sources` because it already owns API keys, delivery targets, Meta fallback access, and integration setup.
- KTD3. Support path is product surface: Paid-customer support is not a footer-only mailto. It should be visible in the signed-in app and public help/trust docs.
- KTD4. No weaker claims: The code can become more complete while public copy stays specific, because tests already prevent stale launch labels and unproven public promises.

---

## Implementation Units

### U1. Add Shared Agent And Support Catalog

- **Goal:** Create a typed catalog for live audited action names, action groups, recommended agent flow, support paths, and non-goals.
- **Requirements:** R2, R3, R4, R5, R6, R7
- **Files:** Create `app/lib/agent-action-catalog.ts`; modify `app/lib/customer-agent-actions.server.ts`, `app/routes/api.v1.ts`, `app/routes/api.mcp.ts`.
- **Patterns to follow:** Current action arrays in `app/lib/customer-agent-actions.server.ts`, route doc shapes in `app/routes/api.v1.ts` and `app/routes/api.mcp.ts`.
- **Test scenarios:** API and MCP docs still list all live actions, route docs include the setup/support boundary, and non-goals stay explicit.
- **Verification:** `tests/api-v1.route.test.ts` and `tests/mcp.route.test.ts` pass.

### U2. Surface Paid-Customer Agent Readiness In The App

- **Goal:** Make `/app/sources` a complete owner-facing control point for agent activation and support readiness.
- **Requirements:** R1, R2, R3, R6, R8
- **Files:** Modify `app/routes/app.sources.tsx`; update `tests/sources.route.test.ts`.
- **Patterns to follow:** Existing source setup panels, API-key card rendering, and launch-safe copy.
- **Test scenarios:** Rendered route shows active key count, write-enabled key count, first workflow, live action groups, customer support paths, and blocked capabilities without showing secrets except the one-time key creation result.
- **Verification:** `tests/sources.route.test.ts` passes.

### U3. Tighten Public Help, API Docs, Trust, And Markdown

- **Goal:** Make public and agent-readable docs match the paid-customer readiness standard without overclaiming launch state.
- **Requirements:** R6, R7, R8
- **Files:** Modify `app/routes/api.docs.tsx`, `app/routes/help.tsx`, `app/routes/trust.tsx`, `app/lib/public-markdown.ts`; update `tests/public-markdown.test.ts` and public route rebuild tests if needed.
- **Patterns to follow:** Existing docs pages and public markdown truth boundaries.
- **Test scenarios:** Public docs mention audited actions, first workflow, support paths, and blocked capabilities without claiming broad write APIs or unsupported ingestion.
- **Verification:** Public route and markdown tests pass.

---

## Scope Boundaries

### Deferred to Follow-Up Work

- Live Slack proof, Dodo customer portal confirmation, and external uptime monitoring.
- Agent actions for team invites, billing changes, delivery sends, or secret-bearing setup.
- Automated customer-service ticketing until an app-owned support workflow is deliberately designed.

### Outside This Product's Identity

- Generic AI chat detached from proof-backed competitor monitoring.
- Unsupported-channel automation without verified proof capture.
- Returning or storing secrets in agent-readable outputs.

---

## Risks & Dependencies

- **Copy drift risk:** Duplicated route-local action names can become stale if new agent actions ship.
- **Launch-claim risk:** Customer-grade readiness copy must not imply broad launch readiness while Slack/Dodo/uptime blockers remain.
- **Secret exposure risk:** App and docs must explain setup without rendering API secrets, webhook URLs, provider tokens, or customer contact details.

---

## Sources / Research

- `docs/strategy/2026-06-18-agent-native-self-serve-benchmark.md`
- `docs/plans/2026-06-19-001-feat-agent-operations-sequence-plan.md`
- `app/routes/app.sources.tsx`
- `app/routes/help.tsx`
- `app/routes/trust.tsx`
- `app/routes/api.v1.ts`
- `app/routes/api.mcp.ts`
- `app/routes/api.docs.tsx`
- `app/lib/customer-agent-actions.server.ts`
- `tests/sources.route.test.ts`
- `tests/api-v1.route.test.ts`
- `tests/mcp.route.test.ts`
