# Presence Tracking Architecture (v1)

Last updated: 2026-07-02

## Goal

Track **market entities** — self (customer-owned), competitors, and future kinds (client, product, creator, campaign) — across declared sources with honest coverage labels. Presence Desk is the customer-facing embodiment; Market Desk remains the competitor ad-monitoring workflow.

## Product positioning

- **Presence Desk**: proof-backed entity tracking across website/open-web (GA) and gated social sources.
- **Market Desk**: competitor ad monitoring, watchlists, and counter-move briefs.
- Source coverage is centralized in `app/lib/presence-source-coverage.server.ts` and must not be hand-written in UI, docs, or API copy.
- Entity briefs are built in `app/lib/presence-entity-brief.server.ts` from real poll results and `presence_item` records — never fabricated on failure.

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
- `presence_oauth_transaction` — one-time HMAC-signed OAuth state + PKCE verifier (migration `0056`)

Migrations: `migrations/0055_presence_tracking.sql`, `migrations/0056_presence_oauth_transaction.sql`

## Connector framework

Registry: `app/lib/presence-connector-registry.server.ts`

Contract per connector:
- `validateTarget` — SSRF-safe URL validation or handle normalization
- `poll` — fetch + normalize items; explicit unsupported failures when gated
- `healthCheck` — connection status for OAuth connectors
- `estimateCost` — budget units for scheduler

Rollout states: `disabled` | `internal` | `pilot` | `ga` (env: `PRESENCE_*_ROLLOUT`)

Access gates: `app/lib/presence-access-gates.server.ts` + `app/lib/presence-internal-access.server.ts`
- Website: default `disabled`; `internal` requires `PRESENCE_INTERNAL_WORKSPACE_ID` match (fail closed)
- X: requires `X_API_BEARER_TOKEN` + rollout ≠ disabled
- Reddit: requires credentials + `REDDIT_COMMERCIAL_ACCESS=approved`
- LinkedIn self: OAuth with HMAC transactions; competitor = `LIMITED_COVERAGE` / blocked

Mocks for tests: `PRESENCE_X_MOCK`, `PRESENCE_REDDIT_MOCK`, `PRESENCE_LINKEDIN_MOCK`

## OAuth security

Module: `app/lib/presence-oauth-transaction.server.ts`

- `PRESENCE_OAUTH_STATE_SECRET` (32+ bytes) required — fail closed when missing
- One-time transaction row: user, workspace, connector, callback URI, return path, PKCE verifier, ~10min expiry
- State param: `{transactionId}.{hmac-sha256}` — constant-time verify, atomic consume
- Callback verifies user/workspace/connector/redirect match before token exchange
- Tokens encrypted at rest; state/tokens never logged (`redactOAuthStateForLogs`)

Routes: `/api/presence/oauth/linkedin` + callback

## Robots & safe fetch

Module: `app/lib/presence-robots.server.ts`

- Product token: `FiveToNinePresenceBot/1.0 (+https://0509.io/bots/presence)`
- RFC 9309-style parser: groups, Allow/Disallow, `*` wildcards, `$` end anchor, longest match, 500KiB cap
- Fetch policy: 2xx parse+obey; 4xx unavailable (disallow); 5xx/network/timeout failed (disallow); never auto-allow on failure
- Cache per scheme+authority, max 24h
- Applied **before** feed discovery, sitemaps, pages, and redirects
- `robots_disallowed` / `robots_unavailable` / `robots_fetch_failed` recorded in poll cursor metadata

SSRF: `presenceSafeFetch` + `public-url.server.ts` + `bounded-response.server.ts`

## Scheduling

- Batch poll on six-hourly warmup cron (`workers/app.ts`) via `runPresencePollingBatch`
- Bounded concurrency: 20 targets per tick, 40 cost units budget
- Oldest `last_polled_at` first
- No polling when rollout `disabled` or workspace not on internal allowlist

## Entitlements

Extended in `app/lib/plan-entitlements.ts` + `app/lib/presence-entitlements.ts`:
- `presence_competitor_tracking`, `presence_self_tracking`, `presence_website_sources`, `presence_social_connect`, `presence_digest_alerts`
- Named limits: `maxTrackedEntities`, per-mode caps, per-connector source caps
- **Evidence top-ups do not unlock presence** (`presenceUnlockedByEvidenceTopUp()` is always false)

## Delivery

Presence digests use `sendPresenceDigestEmail` in `delivery.server.ts` with idempotency keys and `delivery_attempt` records. Internal canary does not trigger customer delivery.

## Privacy & deletion

- Entity soft-delete cascades to `source_target`
- Account deletion cascades via FK on `user_id`
- `revokeSourceConnectionsForUser` marks connections revoked
- `presence_item` retention: 180 days in `retention.server.ts`

## Product UX

- `/app/presence` — Presence Desk: tracked entities, source coverage matrix, entity brief summaries, unified feed (nav hidden unless workspace allowed)
- `/app/presence/:entityId` — entity detail: sources, entity brief, poll, compare view, feed
- Social Connect UI hidden while X/Reddit/LinkedIn rollout = `disabled`
- YouTube, Amazon, and Context.dev appear in coverage as planned/manual-only — not active scan sources until provider gates pass

Experience contracts: `docs/presence-desk-experience-contract.md`, `docs/market-desk-experience-contract.md`

## Reuse

- SSRF: `public-url.server.ts`, `bounded-response.server.ts`, `presence-robots.server.ts`
- Token encryption: `credential-crypto.server.ts`
- Delivery: `delivery.server.ts`
- Plan gating: `plan-entitlements.ts`, `plan.server.ts`

## Current production rollout

`wrangler.jsonc` currently sets `PRESENCE_WEBSITE_ROLLOUT=generally_available` and keeps
`PRESENCE_DIGEST_ROLLOUT`, `PRESENCE_X_ROLLOUT`, `PRESENCE_REDDIT_ROLLOUT`, and
`PRESENCE_LINKEDIN_ROLLOUT` disabled. Website/blog Presence is the GA connector for
entitled workspaces. Social connectors remain unavailable until credentials, policy
approval, and a separate rollout decision are verified.

## Historical rollout path

| Connector | Production default | Next step |
|-----------|-------------------|-----------|
| Website/blog | `generally_available` (2026-06-24) | Keep GA only for entitled workspaces |
| X | `disabled` | credentials + rollout decision |
| Reddit | `disabled` | commercial access, credentials, and rollout decision |
| LinkedIn | `disabled` | OAuth secret, credentials, and rollout decision; self only |

### Pilot allowlist

- Migration `0057_presence_pilot_workspace.sql` — stores `workspace_id_hash` (SHA-256), never raw ids
- Module: `app/lib/presence-pilot-access.server.ts`
- Rollout `pilot`: D1 allowlist required; fail closed when not enrolled. Production has since moved the website/blog connector to GA for entitled workspaces.
- Digest delivery: `PRESENCE_DIGEST_ROLLOUT=disabled` by default

Internal canary: `npm run canary:presence`
Pilot canary: `npm run canary:presence-pilot`
Runbooks: `docs/presence-pilot-runbook.md`, `docs/presence-incident-runbook.md`
Coordinator tracker: `docs/presence-pilot-master-progress.md`

## Owner secrets (never commit values)

- `PRESENCE_OAUTH_STATE_SECRET` — wrangler secret
- `PRESENCE_INTERNAL_WORKSPACE_ID` — wrangler secret

## Relationship to legacy `web_mention_*`

Migration `0028` introduced watchlist-linked web mentions for agent/MCP listing. Presence v1 is the unified model going forward; `web_mention_*` remains for backward compatibility until a later migration consolidates reads.
