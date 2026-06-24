# Presence Tracking Architecture (v1)

Last updated: 2026-06-24

## Goal

Track **self** (customer-owned, OAuth where applicable) and **competitor** (public-only) entities across website/blog and social surfaces with honest coverage labels.

## Coverage labels

| Label | Meaning |
|-------|---------|
| CONNECTED ACCOUNT | OAuth or customer-provided credentials for self mode |
| OFFICIAL PUBLIC API | Official platform API for public competitor data |
| VERIFIED PUBLIC FEED | RSS/Atom or verified syndication feed |
| PUBLIC WEB — BEST EFFORT | HTML/page polling without a verified feed |
| LIMITED COVERAGE | Connector gated or competitor mode unsupported |
| UNAVAILABLE | Connector disabled or target invalid |

## Data model

- `tracked_entity` — workspace-scoped brand/competitor with `tracking_mode` (`self` | `competitor`)
- `source_target` — per-entity connector target (URL, handle, metadata, coverage label)
- `source_connection` — encrypted OAuth/token storage (AES-GCM via `credential-crypto.server.ts`)
- `presence_item` — normalized content items with url/content hash dedupe and tombstones
- `presence_poll_cursor` — ETag/Last-Modified and connector cursors
- `presence_entity_link` — verified links only (no name-similarity auto-merge)
- `presence_alert_cursor` — digest/alert de-duplication per entity

Migration: `migrations/0055_presence_tracking.sql`

## Connector framework

Registry: `app/lib/presence-connector-registry.server.ts`

Contract per connector:
- `validateTarget` — SSRF-safe URL validation or handle normalization
- `poll` — fetch + normalize items; explicit unsupported failures when gated
- `healthCheck` — connection status for OAuth connectors
- `estimateCost` — budget units for scheduler

Rollout states: `disabled` | `internal` | `pilot` | `ga` (env: `PRESENCE_*_ROLLOUT`)

Access gates: `app/lib/presence-access-gates.server.ts`
- Website: no external approval; default `internal`
- X: requires `X_API_BEARER_TOKEN` + rollout ≠ disabled
- Reddit: requires credentials + `REDDIT_COMMERCIAL_ACCESS=approved`
- LinkedIn self: OAuth structure; competitor = `LIMITED_COVERAGE` / blocked

Mocks for tests: `PRESENCE_X_MOCK`, `PRESENCE_REDDIT_MOCK`, `PRESENCE_LINKEDIN_MOCK`

## Scheduling

- Batch poll on six-hourly warmup cron (`workers/app.ts`) via `runPresencePollingBatch`
- Bounded concurrency: 20 targets per tick, 40 cost units budget
- Oldest `last_polled_at` first

## Entitlements

Extended in `app/lib/plan-entitlements.ts` + `app/lib/presence-entitlements.ts`:
- `presence_competitor_tracking`, `presence_self_tracking`, `presence_website_sources`, `presence_social_connect`, `presence_digest_alerts`
- Named limits: `maxTrackedEntities`, per-mode caps, per-connector source caps
- **Evidence top-ups do not unlock presence** (`presenceUnlockedByEvidenceTopUp()` is always false)

## Delivery

Presence digests use `sendPresenceDigestEmail` in `delivery.server.ts` with idempotency keys and `delivery_attempt` records.

## Privacy & deletion

- Entity soft-delete cascades to `source_target`
- Account deletion cascades via FK on `user_id`
- `revokeSourceConnectionsForUser` marks connections revoked
- `presence_item` retention: 180 days in `retention.server.ts`

## Product UX

- `/app/presence` — setup, entity list, unified feed, connector rollout status
- `/app/presence/:entityId` — sources, poll, compare view, feed
- `/api/presence/oauth/linkedin` + callback — OAuth structure (gated until credentials)

## Reuse

- SSRF: `public-url.server.ts`, `bounded-response.server.ts`
- Token encryption: `credential-crypto.server.ts`
- Delivery: `delivery.server.ts`
- Plan gating: `plan-entitlements.ts`, `plan.server.ts`

## Rollout (v1)

| Connector | v1 state |
|-----------|----------|
| Website/blog | `internal` — fully functional without external approval |
| X | Framework + mocks; `disabled` until owner configures credentials |
| Reddit | Framework + mocks; gated on commercial access |
| LinkedIn | OAuth structure; self only; competitor pending |

## Relationship to legacy `web_mention_*`

Migration `0028` introduced watchlist-linked web mentions for agent/MCP listing. Presence v1 is the unified model going forward; `web_mention_*` remains for backward compatibility until a later migration consolidates reads.
