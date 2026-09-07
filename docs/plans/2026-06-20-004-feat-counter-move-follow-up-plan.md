---
title: "feat: Surface counter-move follow-up workflow"
type: "feat"
date: "2026-06-20"
---

# feat: Surface counter-move follow-up workflow

## Summary

Counter-move briefs already exist as proof-backed agent actions, but they are not visible as recurring customer work. This plan makes each brief carry owner, channel, expiry, and follow-up state, then surfaces recent brief follow-ups on the dashboard from the existing audit log.

---

## Problem Frame

The current self-serve strategy says counter-move briefs are the bridge from monitoring to retained weekly use. The agent can create the brief, but the product does not show whether the brief is still open, when it expires, or where the owner should pick it up next.

---

## Requirements

**Brief workflow state**

- R1. Each generated counter-move brief includes follow-up workflow metadata with owner, channel, status, expiry, and per-move follow-up state.
- R2. Quiet briefs do not pretend there is work to do; they return a quiet or closed state with no open follow-up items.
- R3. Workflow metadata stays safe for API/MCP and audit persistence, with no secrets or delivery target values.

**Customer surface**

- R4. The dashboard shows recent counter-move follow-ups for the signed-in workspace without adding a new manual workflow.
- R5. Dashboard summaries must tolerate legacy audit results that do not yet include workflow metadata.

---

## Key Technical Decisions

- **Use the existing audit log first:** `agent_action_audit.result_json` already stores successful `counter_move_brief.create` results. Reading recent successful audits avoids a migration and keeps the first slice tied to the actual agent action.
- **Treat follow-up state as generated workflow metadata:** The brief result should say what is open now, when it expires, and where it belongs. It should not try to model assignments, comments, or recurring delivery state before the app has real usage pressure.
- **Keep the channel coarse:** Use safe labels such as `app`, `email`, `slack`, or `client_room`, not target addresses or webhook URLs.

---

## Scope Boundaries

- No new delivery sends, Slack posts, or webhook setup in this slice.
- No new table for follow-up tasks yet; audit-backed surfacing is enough to make the workflow visible and testable.
- No billing, team invite, or Meta reconnection work.

---

## Implementation Units

### U1. Add workflow metadata to counter-move briefs

- **Goal:** Extend the counter-move brief shape so every generated brief has owner, channel, expiry, status, and per-move follow-up items.
- **Requirements:** R1, R2, R3.
- **Dependencies:** None.
- **Files:** Modify `app/lib/counter-move-brief.server.ts`; test `tests/counter-move-brief.test.ts`.
- **Approach:** Add a small workflow object to `CounterMoveBrief`. Default owner to the workspace owner label, default channel to `app`, set open status only when moves exist, and derive expiry from the generated time. Keep fields primitive and public-safe.
- **Patterns to follow:** `buildChangeIntelligenceSummary` in `app/lib/change-intelligence.ts`; current `CounterMoveBrief` and `CounterMove` object construction.
- **Test scenarios:** A proof-backed move produces one open follow-up with the event id, recommended action, owner label, app channel, and expiry. A quiet brief produces no open follow-up items and a quiet status.
- **Verification:** The brief builder returns stable workflow metadata without changing move prioritization.

### U2. Carry workflow controls through the agent action

- **Goal:** Let the agent action provide safe workflow hints and persist the generated state in the audited result.
- **Requirements:** R1, R3.
- **Dependencies:** U1.
- **Files:** Modify `app/lib/customer-agent-actions.server.ts`; test `tests/customer-agent-actions.server.test.ts`.
- **Approach:** Read optional safe fields such as `ownerLabel`, `channel`, and expiry days from action input. Clamp expiry to a bounded range, allow only safe channel names, and include follow-up summary counts in audit metadata.
- **Patterns to follow:** Existing input readers and action metadata in `app/lib/customer-agent-actions.server.ts`; existing audit replay boundaries in `app/lib/agent-actions.server.ts`.
- **Test scenarios:** `counter_move_brief.create` returns workflow metadata for a valid owned watchlist. Invalid or secret-looking channel/owner inputs are rejected or normalized without persistence. Audit metadata includes non-secret workflow summary fields.
- **Verification:** API/MCP callers get the same workflow state the audit stores, and invalid hints cannot create secret-bearing audit data.

### U3. Surface recent follow-ups on the dashboard

- **Goal:** Show recent counter-move follow-up state on the customer dashboard using successful agent action audits.
- **Requirements:** R4, R5.
- **Dependencies:** U1, U2.
- **Files:** Modify `app/lib/data.server.ts`, `app/routes/app.dashboard.tsx`; test `tests/data.server.test.ts`, `tests/dashboard.route.test.ts`.
- **Approach:** Add a bounded query for recent successful agent audits by action name. Map legacy and current results into safe dashboard summaries, then render a compact follow-up section near the existing brief/agent readiness area.
- **Patterns to follow:** Existing bounded list queries in `app/lib/data.server.ts`; existing dashboard loader summary mapping; existing dashboard render tests.
- **Test scenarios:** The data query filters by user, action name, succeeded status, and limit. The dashboard renders an open follow-up from a modern audit result. A legacy audit result without workflow metadata does not crash or expose raw JSON.
- **Verification:** Dashboard output gives owners a visible follow-up loop without requiring a new external delivery target.

---

## Sources

- `docs/strategy/2026-06-18-agent-native-self-serve-benchmark.md`
- `app/lib/counter-move-brief.server.ts`
- `app/lib/customer-agent-actions.server.ts`
- `app/routes/app.dashboard.tsx`
- `app/lib/data.server.ts`
