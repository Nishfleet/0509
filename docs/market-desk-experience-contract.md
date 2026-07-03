# Market Desk Experience Contract

Date: 2026-06-30 (updated 2026-07-02 for Presence Desk pivot)

## Product Promise

Track competitor moves. See proof. Know what to do next.

Market Desk is the competitor-focused workflow inside Five to Nine. The broader product also includes **Presence Desk** — proof-backed tracking for supported market entities across declared sources (today: your brand and competitors; see `docs/presence-desk-experience-contract.md`). Competitors remain a first-class entity type in both flows.

The product should feel like:

> Paste your competitors. Wake up to the proof-backed counter-move brief.

It should not feel like separate ad search, watchlists, digests, reports, API/MCP, and settings.

## Canonical Journey

1. Customer chooses a plan.
2. Customer pastes or uploads competitors.
3. Five to Nine validates, normalizes, deduplicates, and shows plan-cap impact.
4. Customer reviews and chooses which competitors to add when over cap.
5. Five to Nine creates watchlists and source-coverage next actions.
6. Five to Nine runs or queues bounded first scans/searches.
7. Five to Nine generates an immediate Market Desk Brief.
8. Customer can review proof, save to Collection, create Report, configure Digest/Notifications, create Client room, or hand off to Developer access.
9. The dashboard keeps the daily/weekly retention loop centered on the brief.

## Market Desk Brief

A Market Desk Brief is a customer-facing derived document. It answers:

1. What changed?
2. Why does it matter?
3. How proven is it?
4. Where did it come from?
5. What should I do next?

It includes:

- one-line answer;
- top 3 competitor moves;
- proof mix;
- priority mix;
- source coverage;
- recommended actions;
- watchlist/source status;
- links to proof, report, watchlist, collection, or detail;
- all-quiet state;
- queued or pending state;
- not-enough-data state.

It does not include:

- raw provider payloads;
- internal workflow status;
- giant ad dumps;
- raw logs;
- settings before the customer sees value;
- unproven claims.

## Brief States

| State | Meaning | Customer copy posture | Next action |
| --- | --- | --- | --- |
| `ready` | At least one verified or review-worthy move exists | "We found competitor moves worth reviewing." | Review proof, create report, save to collection |
| `queued` | Setup succeeded and first scans/searches are queued | "Your Market Desk is being checked now." | Open watchlists or wait for first scan |
| `all_quiet` | A successful scan ran and no meaningful change is waiting | "All quiet. We checked the market and nothing needs action." | Schedule digest, add another competitor |
| `not_enough_data` | No watchlist, no successful scan, or too little data | "We need a competitor/source before a brief can be useful." | Add competitors or run first check |
| `no_verified_ads` | Domain search found no verified ads tied to the domain | "We could not confirm ads tied to this competitor." | Broader search, track competitor, add source |
| `source_unavailable` | Provider/source is unavailable or degraded | "This source is unavailable or partial right now." | Retry later, use available sources, contact support if blocking |
| `proof_pending` | A move was detected but proof is not ready | "We spotted a move, but proof is still pending." | Review scan-backed item; wait before client handoff |
| `plan_cap_reached` | Valid competitors exceed plan cap | "Choose which competitors to add under this plan." | Upgrade or select rows |
| `import_needs_review` | Import has invalid, duplicate, or unmapped rows | "Review rows before creating watchlists." | Fix or skip rows |
| `support_needed` | External data/provider/dashboard action is required | "This part needs owner/support action." | Show exact owner action |

## Bulk Competitor Setup

Required inputs:

- pasted multiple lines;
- CSV upload;
- domains;
- URLs;
- names;
- optional notes;
- optional tags/client.

Required review outcomes:

- valid;
- invalid;
- duplicate;
- existing watchlist;
- over cap;
- selected for creation;
- skipped by customer.

Plan caps:

- Scout: 3 competitors/watchlists.
- Starter: 10 competitors/watchlists.
- Agency: 75 competitors/watchlists when Agency is sellable or in the honest held/internal flow.

The system must not silently drop rows. Invalid competitors do not create watchlists.

## Search Answer Contract

Search still shows results, but the first result-area screen must include a synthesized answer when a query exists.

The answer can include:

- verified ads tied to the domain;
- repeated hooks/themes;
- repeated offers;
- landing-page patterns;
- active creative formats;
- newest notable ads;
- recommendations to watch or ignore;
- proof confidence;
- source coverage;
- next action.

If evidence is insufficient, the answer says so. Broader keyword-only matches are not proof.

## Dashboard Contract

Overview is the Market Desk home. The hierarchy is:

1. Market Desk Brief.
2. Top 3 moves or all-quiet heartbeat.
3. Items needing review.
4. Monitoring/source health.
5. Next recommended action.
6. Usage/plan warnings only when actionable.

Dashboard should not lead with raw setup status unless no brief can be produced.

## Agency Contract

Agency setup must support 75 competitors without one-by-one pain:

- bulk import;
- client/tag grouping;
- report/client-room suggestions;
- team invite next action;
- Developer access handoff;
- approved-action framing.

If Agency checkout is held, the UI must say so honestly and not enable purchase.

## Developer Access Contract

Customer-facing promise:

> Connect your agent to keep your competitor desk ready.

Developer access explains:

- what agents can read;
- what actions agents can request;
- what requires approval;
- key creation and revocation;
- scopes;
- examples;
- safety;
- audit history;
- rate limits;
- plan requirements.

Do not expose internal tool-call logs or unavailable actions as available.

## Metrics Contract

Use existing privacy-safe audit/event mechanisms where possible. Track non-sensitive activation/retention events only:

- competitor setup started/completed;
- competitors added count bucket;
- first Market Desk Brief generated;
- first proof viewed;
- first watchlist created;
- first Presence source next action;
- first report created;
- first client room created;
- first delivery configured;
- top-up checkout intent;
- cancellation started;
- support requested.

Do not add a new analytics provider without approval.

## Copy Rules

Use:

- Competitor
- Market Desk
- Presence Desk
- Tracked entity
- Counter-move
- Proof
- Source
- Watchlist
- Website presence
- Collection
- Digest
- Report
- Client room
- Notifications
- Developer access
- Approved actions

Avoid in customer UI unless clearly in developer docs:

- MCP agent context
- tool calls
- workflow
- queue
- fan-out
- D1
- canary
- internal workspace
- provider payload
- reconciliation
- lease
- raw operation names
