# Owner agent memory plan

## Goal

Make safe account memory a first-class self-serve surface for paying owners, not only an API/MCP feature. Owners should be able to save durable operating context from the app, see whether future agent runs have usable context, and avoid storing credentials or delivery secrets.

## Current State

The repo already has:

- `agent_memory` persistence in `migrations/0036_agent_memory.sql`.
- API/MCP actions for `memory.upsert` and `memory.list`.
- Agent report and counter-move brief flows that load saved memory context.
- A client rooms page that lists saved memory keys but does not let owners create memory.
- A dashboard readiness model that counts memory but does not show the operating context state.

The gap is customer-facing: memory exists for agents, but owners cannot easily add or confirm the context the next run will use.

## Requirements

- R1. Add an owner UI for safe account memory without adding new persistence.
- R2. Reuse the same secret-rejection behavior as API/MCP memory writes.
- R3. Do not expose raw secrets, webhook URLs, API keys, tokens, or private delivery values in rendered app data.
- R4. Make dashboard readiness show whether the account has usable agent memory and link to the owner-controlled memory surface.
- R5. Keep memory account-scoped through `requireWorkspaceSession` and existing D1 ownership boundaries.
- R6. Keep external Slack/WhatsApp/Dodo/provider proof out of scope for this slice.

## Implementation

- Add a small server-only memory input helper for scope normalization, key/source validation, value coercion, and secret rejection.
- Update `customer-agent-actions.server.ts` to call that helper so API/MCP behavior stays aligned with the app UI.
- Extend `app.clients.tsx` with a "Save operating memory" form that writes `agent_memory` through `upsertAgentMemory`.
- Summarize saved memories for the client UI instead of returning full raw memory records where the page only needs display state.
- Extend `app.dashboard.tsx` to load recent memory summaries, add memory to the retained value loop, and link owners to `/app/clients`.
- Add focused tests for the helper, client route action/rendering, dashboard static surface, and existing customer agent memory behavior.

## Verification

- Run focused tests for memory helper, client route, customer agent actions, and dashboard static assertions.
- Run `npm run typecheck`.
- Run `npm test`.
- Run `npm run build`.
- Rerun `autoreview` on the final combined diff.
