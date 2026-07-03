# Presence Desk Experience Contract

Date: 2026-07-02

## Product Promise

Track your brand and competitors today. See what changed, with proof. Know what to do next.

The north-star direction is broader market-entity tracking, but the current implementation only represents `self` and `competitor` modes. Client, product, creator, founder, campaign, and category kinds require the planned entity-kind metadata slice before they can be promised in product copy.

The product should feel like:

> Add your brand or a competitor. See proof-backed changes from declared sources — not a generic internet scan.

It should not feel like hidden scraping, fabricated proof, or platform coverage that is not enabled.

## Relationship to Market Desk

- **Presence Desk** is the proof-backed entity tracking layer: websites, blogs, and gated social sources through Presence Tracking.
- **Market Desk** remains the competitor-focused ad monitoring workflow (watchlists, ad discovery, counter-move briefs).
- Competitors are one tracked entity type inside the broader product — not a removed path.

## Canonical Journey

1. Customer opens Presence Desk (`/app/presence`).
2. Customer adds a supported tracked entity: their brand or a competitor.
3. Customer reviews the source coverage matrix — which sources are active, available, gated, planned, manual-only, or unavailable.
4. Customer adds website/open-web sources first (the GA source).
5. Five to Nine polls safely (robots, SSRF guard, bounded fetch) and writes normalized `presence_item` records.
6. Entity brief shows changes, proof strength, source confidence, and next action.
7. Customer can compare entities, configure digests when rolled out, or return to Market Desk for ad monitoring.

## Entity Brief

A Presence entity brief is a customer-facing derived document. It answers:

1. What changed?
2. How proven is it?
3. Where did it come from?
4. What is the source coverage state?
5. What should I do next?

It includes:

- brief state (`ready`, `queued`, `all_quiet`, `not_enough_data`, `source_unavailable`, `manual_proof_needed`, `degraded`);
- headline and summary;
- proof strength label;
- source confidence label;
- recent proof-backed changes (website/open-web in the first slice);
- source coverage entries from the centralized policy;
- last poll and last change timestamps;
- explicit next action.

It does not include:

- fabricated items when polls fail;
- active claims for YouTube, Amazon, X, Reddit, LinkedIn, or Context.dev unless provider gates are satisfied;
- active claims for client, product, creator, founder, campaign, or category entity kinds before entity-kind metadata ships;
- raw provider payloads or internal rollout codes in customer copy.

## Source Coverage Matrix

| Source | Production status | Customer posture |
| --- | --- | --- |
| Website / open web | Active (GA for entitled workspaces) | Add public URLs; coverage depends on robots and accessibility |
| X | Unavailable | Gated — paid API credentials and rollout required |
| Reddit | Unavailable | Gated — commercial API access and credentials required |
| LinkedIn | Unavailable | Gated — self-brand OAuth only when rolled out; competitor limited |
| YouTube | Planned | Not active — API key, quota, and approval required |
| Amazon marketplace | Manual proof only | No automated generic scraping; manual proof or approved affiliate API |
| Context.dev | Planned | Optional backend open-web provider; not a platform bypass |

Statuses shown in UI: `active`, `available`, `connected`, `gated`, `planned`, `manual_only`, `limited`, `unavailable`, `degraded`.

## Copy Rules

Use:

- Presence Desk
- Tracked entity
- Market entity
- Proof-backed
- Source coverage
- Website / open web
- Next action
- Competitor (as one entity type)

Avoid:

- "Scan the whole internet"
- Active YouTube/Amazon/X/Reddit claims before gates pass
- Client/product/creator entity-kind claims before entity-kind metadata ships
- Context.dev as required architecture
- Internal connector rollout names in customer UI
