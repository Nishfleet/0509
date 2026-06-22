---
title: "feat: Add agent-operable competitor desk sequence"
type: "feat"
date: "2026-06-19"
---

# feat: Add agent-operable competitor desk sequence

## Summary

Build the unblocked Five to Nine product gaps in a sequential code path: ship shared workspace readiness, add safe agent actions, add action/audit evidence, package counter-move briefs, store account memory, strengthen agency/client rooms, and surface lifecycle retention nudges. External Slack proof, Dodo portal settings, external uptime monitoring, WhatsApp, and unsupported-channel ingestion remain logged blockers, not work loops.

---

## Problem Frame

Five to Nine already has public search, authenticated monitoring, watchlists, collections, reports, share links, Dodo billing, Cloudflare Email, Slack setup, API exports, and read-only MCP. The current gap is action parity: humans can operate the workspace, while agents can mostly read exports. This plan turns the existing primitives into a proof-backed competitor operations desk that an agent can inspect and operate under explicit safety rules.

---

## Requirements

- R1. Workspace readiness must be one shared account-scoped object used by the dashboard, customer API, and MCP.
- R2. Agent-facing writes must be owner/admin scoped, idempotent where repeat calls are likely, and recorded in an audit log.
- R3. Agent tools may write safe workspace state such as watchlists, collections, proof links, reports, share links, and memory, but must not expose secrets or mutate billing, team invites, or external sends.
- R4. Delivery and launch blockers must stay honest: Slack proof, Dodo portal confirmation, uptime monitoring, WhatsApp, and unsupported-channel ingestion remain non-claimable until separately verified.
- R5. Counter-move briefs must carry source proof, confidence, recommended response, owner/channel context, and expiry without inventing spend or unsupported ingestion.
- R6. Agent/customer memory must be scoped to the account and optionally to a watchlist or client room.
- R7. Agency/client rooms must group watchlists, boards, reports, and share links around client context without changing the current Better Auth/D1 workspace ownership model.
- R8. Lifecycle nudges must be tied to product truth: first competitor, first proof, digest, delivery proof, API/MCP readiness, memory, and client-room readiness.
- R9. Verification must cover API/MCP contracts, account scoping, no-secret output, audit persistence, and unchanged launch-claim boundaries.

---

## Key Technical Decisions

- **KTD1. Start from current `origin/main` and reuse the existing readiness branch:** `codex/0509-workspace-readiness` already contains a focused readiness slice. Reconcile it first instead of rebuilding the same object.
- **KTD2. Shared service layer for agent actions:** Put action validation and audit recording behind server modules so API, MCP, and future UI reuse the same account-scoped behavior.
- **KTD3. Read-write MCP stays beta and narrow:** Add write tools only for safe workspace operations. Billing, team invites, delivery sends, and secret-bearing setup stay app-owned.
- **KTD4. Audit log is append-only:** Agent writes should create durable rows with action name, resource type, resource id, idempotency key, status, and safe metadata. Secrets and raw API keys never enter the log.
- **KTD5. Counter-move briefs derive from existing watch events and report data:** The first slice packages current signals instead of adding new crawling or unsupported-channel ingestion.
- **KTD6. Client rooms are account-owned grouping objects:** They layer over existing watchlists, collections, and share links instead of changing workspace membership or auth scoping.
- **KTD7. Lifecycle nudges are presentation and API state first:** Use existing readiness and activity signals before adding outbound automation.

---

## High-Level Technical Design

```mermaid
flowchart TB
  ApiKey[Customer API key] --> Mcp[/api/mcp]
  ApiKey --> Api[/api/v1]
  Mcp --> AgentActions[agent-actions.server.ts]
  Api --> AgentActions
  Dashboard[/app dashboard] --> Readiness[workspace-readiness.server.ts]
  AgentActions --> Data[data.server.ts]
  AgentActions --> Audit[agent_action_audit]
  Data --> Briefs[counter-move briefs]
  Data --> Memory[workspace memory]
  Data --> Rooms[client rooms]
  Readiness --> Dashboard
  Readiness --> Api
  Readiness --> Mcp
```

The core invariant is one account-scoped truth layer. API and MCP endpoints authenticate with the existing customer API key, call the same server modules, and receive safe structured results. The app remains the place for secret setup, billing, team invites, and external delivery sends.

---

## Implementation Units

### U1. Reconcile Workspace Readiness

- **Goal:** Bring the existing readiness branch onto this work branch and verify it still matches current `origin/main`.
- **Requirements:** R1, R4, R8, R9
- **Dependencies:** None
- **Files:** `app/lib/workspace-readiness.server.ts`, `app/routes/app.dashboard.tsx`, `app/routes/api.v1.ts`, `app/routes/api.v1.workspace-readiness.ts`, `app/routes/api.mcp.ts`, `app/routes.ts`, `tests/workspace-readiness.server.test.ts`, `tests/api-v1.route.test.ts`, `tests/mcp.route.test.ts`, `tests/app-rebuild.test.ts`
- **Approach:** Merge or cherry-pick the already-built readiness slice, resolve against the retained-value dashboard on `origin/main`, and keep the endpoint read-only.
- **Patterns to follow:** `codex/0509-workspace-readiness`, `tests/api-v1.route.test.ts`, `tests/mcp.route.test.ts`
- **Test scenarios:** Valid API key returns account readiness. MCP exposes `get_workspace_readiness` as read-only. Slack configured-without-proof returns a proof-needed state. Serialized output omits API key material, webhook URLs, customer tokens, and auth config.
- **Verification:** Focused readiness, API v1, MCP, dashboard, and data tests pass.

### U2. Add Agent Action Audit Envelope

- **Goal:** Create the persistent audit and idempotency envelope for all safe agent writes.
- **Requirements:** R2, R3, R9
- **Dependencies:** U1
- **Files:** `migrations/0035_agent_action_audit.sql`, `app/lib/types.ts`, `app/lib/agent-actions.server.ts`, `app/lib/data.server.ts`, `tests/agent-actions.server.test.ts`, `tests/data.server.test.ts`
- **Approach:** Add an append-only audit table plus data helpers. Normalize action names, safe metadata, idempotency keys, statuses, and resource pointers. Return prior successful results for repeated idempotent requests where practical.
- **Patterns to follow:** `app/lib/api-keys.server.ts`, `app/lib/data.server.ts`, `migrations/0020_dodo_webhook_events.sql`
- **Test scenarios:** Audit writes are account-scoped. Reusing an idempotency key for the same action returns the prior result. Reusing it for a different action fails. Safe metadata strips secret-like fields. Failed validation writes a failed audit record without mutating the target resource.
- **Verification:** New agent action and data tests pass.

### U3. Add Watchlist Agent Actions

- **Goal:** Let agents list, create, update, pause, resume, and refresh watchlists through API/MCP with the same plan and ownership constraints as the app.
- **Requirements:** R2, R3, R4, R9
- **Dependencies:** U2
- **Files:** `app/lib/agent-actions.server.ts`, `app/routes/api.mcp.ts`, `app/routes/api.v1.ts`, `app/routes/api.v1.agent-actions.ts`, `tests/mcp.route.test.ts`, `tests/api-v1.route.test.ts`, `tests/agent-actions.server.test.ts`
- **Approach:** Reuse existing watchlist helpers, plan-limit checks, target fingerprinting, and manual refresh gates. Require idempotency keys for creates and refreshes. Return the same safe confirmation shape the UI would show.
- **Patterns to follow:** `app/routes/app.watchlists.tsx`, `app/lib/monitoring.server.ts`, `app/lib/competitor-website.ts`, `app/lib/plan.server.ts`
- **Test scenarios:** Create validates target and plan capacity. Update preserves duplicate-target guard. Pause frees a slot. Resume enforces plan limits. Refresh rejects free plans and recently-running watchlists. All calls create audit rows and return no secret material.
- **Verification:** Focused agent action, MCP, API v1, watchlist route, and plan-limit tests pass.

### U4. Add Proof, Report, And Share Agent Actions

- **Goal:** Let agents create boards, add external proof links, create report snapshots, and create share links for account-owned resources.
- **Requirements:** R2, R3, R5, R9
- **Dependencies:** U2
- **Files:** `app/lib/agent-actions.server.ts`, `app/routes/api.mcp.ts`, `app/routes/api.v1.agent-actions.ts`, `tests/agent-actions.server.test.ts`, `tests/mcp.route.test.ts`, `tests/api-v1.route.test.ts`, `tests/share-links.test.ts`
- **Approach:** Reuse collection, external proof, report-builder, and share-link helpers. Keep external proof as user-supplied proof, not automated non-Meta ingestion. Snapshot report shares should use existing report builders.
- **Patterns to follow:** `app/routes/app.collections.tsx`, `app/routes/app.reports.tsx`, `app/lib/report-builder.server.ts`, `app/lib/resource-export.ts`
- **Test scenarios:** Create board respects collection limits. Add external proof requires an owned board and a URL. Create share link rejects unowned resources. Report snapshot contains proof and source status. Audit rows identify resource type and id.
- **Verification:** Focused agent action, export, report, share-link, MCP, and API tests pass.

### U5. Add Counter-Move Briefs

- **Goal:** Package watch events and digest/report signals into reusable counter-move briefs.
- **Requirements:** R5, R8, R9
- **Dependencies:** U1
- **Files:** `app/lib/counter-move-brief.server.ts`, `app/lib/resource-export.ts`, `app/components/report-view.tsx`, `tests/counter-move-brief.server.test.ts`, `tests/export.route.test.ts`, `tests/report-view.test.ts`
- **Approach:** Derive briefs from confirmed watch events, digest item metadata, proof trail, importance score, and current report content. Include recommended response, confidence, proof trail, suggested owner/channel, and expiry.
- **Patterns to follow:** `app/lib/change-intelligence.ts`, `app/lib/report-builder.server.ts`, `app/components/digest-intelligence.tsx`
- **Test scenarios:** High-priority events produce a brief with proof and next action. Missing proof yields a lower-confidence brief with honest source status. Exports include briefs without changing existing CSV contracts. Report view renders briefs without hiding raw evidence.
- **Verification:** Focused brief, export, and report tests pass.

### U6. Add Agent/Customer Memory

- **Goal:** Store account-scoped context that agents and the app can use for tracked competitors and clients.
- **Requirements:** R2, R3, R6, R8, R9
- **Dependencies:** U2
- **Files:** `migrations/0036_workspace_memory.sql`, `app/lib/workspace-memory.server.ts`, `app/lib/types.ts`, `app/routes/api.mcp.ts`, `app/routes/api.v1.ts`, `app/routes/api.v1.workspace-memory.ts`, `tests/workspace-memory.server.test.ts`, `tests/mcp.route.test.ts`, `tests/api-v1.route.test.ts`
- **Approach:** Add memory entries keyed by user, optional watchlist, optional client room, category, title, body, and safe metadata. Expose list/upsert through API/MCP with audit rows and no secret storage.
- **Patterns to follow:** `app/lib/workspace.server.ts`, `app/lib/api-keys.server.ts`, `app/lib/data.server.ts`
- **Test scenarios:** Memory is account-scoped. Watchlist-linked memory rejects another user's watchlist. Upsert with idempotency returns stable results. MCP lists memory for agent context. Secret-like metadata is stripped.
- **Verification:** Workspace-memory, API, MCP, and audit tests pass.

### U7. Add Agency Client Rooms

- **Goal:** Create client rooms that group watchlists, boards, reports, share links, and memory for agency workflows.
- **Requirements:** R6, R7, R8, R9
- **Dependencies:** U2, U6
- **Files:** `migrations/0037_client_rooms.sql`, `app/lib/client-rooms.server.ts`, `app/routes/app.clients.tsx`, `app/routes.ts`, `app/components/report-view.tsx`, `tests/client-rooms.server.test.ts`, `tests/app-rebuild.test.ts`, `tests/plan-limits.route.test.ts`
- **Approach:** Add a room table plus join tables for watchlists and collections. Keep rooms account-owned under the current workspace user. Render a compact app page that shows room context, linked resources, memory, and readiness.
- **Patterns to follow:** `app/routes/app.collections.tsx`, `app/routes/app.team.tsx`, `app/lib/workspace.server.ts`, `app/lib/workspace-readiness.server.ts`
- **Test scenarios:** Agency and non-agency accounts can create room metadata, but team-seat behavior stays unchanged. Linking rejects unowned resources. Room readiness reflects missing watchlists, proof, reports, memory, or share links. App route is registered and visible from app navigation.
- **Verification:** Client-room, app route, and rebuild tests pass.

### U8. Surface Lifecycle Retention Nudges

- **Goal:** Use readiness, briefs, memory, and client-room state to show the next unblocked retained-value action.
- **Requirements:** R4, R8, R9
- **Dependencies:** U1, U5, U6, U7
- **Files:** `app/lib/lifecycle-nudges.server.ts`, `app/routes/app.dashboard.tsx`, `app/routes/app.onboard.tsx`, `tests/lifecycle-nudges.server.test.ts`, `tests/app-rebuild.test.ts`, `tests/onboarding.route.test.ts`
- **Approach:** Build a small ordered nudge list from existing product truth. Do not send outbound lifecycle messages in this slice.
- **Patterns to follow:** `app/routes/app.dashboard.tsx`, `docs/brainstorms/2026-06-17-0509-retention-value-loop-requirements.md`
- **Test scenarios:** Empty workspace prompts first competitor. Active watchlist without proof prompts refresh/proof. Digest without Slack proof prompts delivery setup without claiming launch readiness. Missing API/MCP key prompts agent setup. Client room without memory prompts context capture.
- **Verification:** Lifecycle nudge, dashboard, onboarding, and app rebuild tests pass.

### U9. Documentation, Review, And Merge Gate

- **Goal:** Update docs/copy for the new safe beta boundary and complete the required review/merge path.
- **Requirements:** R3, R4, R9
- **Dependencies:** U1, U2, U3, U4, U5, U6, U7, U8
- **Files:** `README.md`, `docs/launch-readiness.md`, `app/lib/public-markdown.ts`, `tests/public-markdown.test.ts`
- **Approach:** Document read-write agent beta capabilities as safe workspace actions only. Keep external blockers and not-live-yet claims unchanged. Run focused tests, then broader verification, then CE review, then `autoreview`, then merge only if both review gates are clean.
- **Patterns to follow:** Existing public API/MCP copy and launch-readiness wording.
- **Test scenarios:** Public docs mention safe agent actions without claiming billing, team invite, external sends, WhatsApp, or unsupported-channel ingestion. Public markdown preserves launch blockers. Review gates run against the exact final diff.
- **Verification:** Focused docs tests pass. Broader typecheck/test/build run as feasible. `ce-code-review` has no actionable findings. `autoreview` exits clean before merge.

---

## Scope Boundaries

### Deferred to Follow-Up Work

- Slack production proof, because it requires a real external Slack target.
- Dodo customer portal subscription-update confirmation, because it is external-dashboard work.
- External uptime monitor creation, because it depends on the chosen monitoring service/account.
- Outbound lifecycle emails or Slack nudges beyond existing delivery flows.
- Full public write API positioning after the beta has live usage and review.

### Outside This Product's Identity

- Generic AI chat detached from proof-backed monitoring.
- Automated TikTok, Google, YouTube, LinkedIn, Pinterest ingestion without verified providers.
- SOC 2, HIPAA, GDPR, zero-retention, no-training, or unsupported trust claims.
- Agent access to secrets, billing mutation, team invites, or external sends without app-owned approval.

---

## System-Wide Impact

This work touches exported API and MCP contracts, account-scoped persistent data, report payloads, dashboard/onboarding UX, and public launch claims. The implementation must preserve D1 parameter binding, current Better Auth/D1 workspace scoping, no-secret output, and the existing launch-gate posture.

---

## Risks & Dependencies

- **Auth scoping risk:** API-key requests must always use the authenticated key's user id, not caller-supplied ownership fields.
- **Secret exposure risk:** Agent-readable readiness, audit, memory, and delivery details must strip webhook URLs, raw API keys, customer tokens, and auth config.
- **Plan-limit risk:** Agent-created watchlists and boards must reuse existing plan-limit gates.
- **Refresh cost risk:** Manual watchlist refresh is a paid-plan live scan and must keep the existing free-plan and cooldown guards.
- **Launch-claim risk:** Read-write agent beta must not become a public broad-launch claim while Slack/Dodo/uptime blockers remain.
- **Migration risk:** New tables are append-only or grouping layers. Any risky remote migration should be preceded by a D1 backup before deploy, per README operations guidance.

---

## Sources / Research

- `AGENTS.md`
- `MEMORY.md`
- `README.md`
- `docs/launch-readiness.md`
- `docs/brainstorms/2026-06-17-0509-retention-value-loop-requirements.md`
- `docs/plans/2026-06-17-001-feat-retention-value-loop-plan.md`
- `app/routes/api.mcp.ts`
- `app/routes/api.v1.ts`
- `app/routes/app.watchlists.tsx`
- `app/routes/app.collections.tsx`
- `app/routes/app.reports.tsx`
- `app/lib/data.server.ts`
- `app/lib/workspace.server.ts`
- `migrations/0028_tracking_roles_and_web_mentions.sql`
- Existing branch `codex/0509-workspace-readiness`
