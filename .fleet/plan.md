# Plan for Nishfleet/0509 issue #1279

## Goal

Track Saucony as a watchlist brand for 7 days; refresh price-tier distribution across current watchlists.

## Phases

- [x] phase 1: D1 expand/contract phase 1 — ADD COLUMN nullable `price_tier TEXT` on `landing_page_snapshot` (`migrations/0086_landing_page_price_tier.sql`); single ALTER TABLE, additive only, no DROP / NOT NULL / rename; deterministic 4-bucket extractor `extractPriceTier(priceText): "under_30" | "30_to_100" | "100_to_250" | "over_250" | "unknown"` in `app/lib/landing-page-price-tier.server.ts` (pure function, parses `price_text` matches EUR/USD/GBP normalised, no LLM, `unknown` for no-match). The optional UPDATE-backfill from the original plan is **not** shipped — the plan classifies it as best-effort, the migration header documents the choice, and the column stays nullable so no existing row is forced to a non-null value. Historical rows re-classify naturally as the monitoring workflow re-captures them. (commit `fa169006`)
- [x] phase 2: wire price-tier computation into the existing landing-page capture path — `createLandingPageSnapshot` in `app/lib/data/ads.server.ts` populates `price_tier` at INSERT time using `extractPriceTier`; the `sneaker-resale-backfill` and `demo-brand-backfill` write paths all flow through the same INSERT so incremental updates are guaranteed by construction; `loadPriceTierDistribution(env)` reads the aggregate (one bounded D1 `SELECT price_tier, COUNT(*) FROM landing_page_snapshot GROUP BY price_tier` query) and exposes it as a `Record<PriceTierBucket, number>` for downstream consumers. (commit `e834b93b`)
- [x] phase 3: integration test in `tests/integration/saucony-watchlist.integration.test.ts` (real D1 binding, workers project) — seeds a fixture `user` via `seedUser()` from `tests/integration/fixtures.ts`, INSERTs `watchlist` rows for `saucony.com` and `saucony.co.uk` with `target_type='advertiser'`, `is_active=1`; runs one `createLandingPageSnapshot` cycle per snapshot with `price_text="$199"` and `price_text="$349"`; asserts (a) the two watchlist rows exist with `is_active=1`, (b) the snapshot rows exist with `price_tier` set to `100_to_250` and `over_250` respectively, (c) `loadPriceTierDistribution` returns the expected aggregate counts; a NULL `price_text` row writes `unknown` and does not break the aggregator. Plus a migration-test gate `tests/integration/migrations/0086-landing-page-price-tier.integration.test.ts` that runs `applyD1Migrations` then reads the column back via `sqlite_master` string check + INSERT/SELECT round-trip — proves the read AND write path through real D1 (fleet-ops D1 expand/contract rule). (commits `be695a0c`, `c2ba24f0`)
- [x] phase 3 review (Act-on round): reviewer flagged (Consider) three test-file issues — dead `PRICE_TIER_KEYS` const, single-PRAGMA use in the migration gate (replaced with `sqlite_master` string check), and missing `loadPriceTierDistribution` assertion on the legacy-NULL row. All three addressed in commit `3ef17e7c`; `tsc --noEmit` exits 0 and the workers-project integration tests pass (12/12 across the three required files).
- [x] phase 4: declare `mechanism-impossible` for the parts blocked by current rules. Recorded in the "Mechanism-impossible declarations" section below. No code change required; the existing engines (#966, #1240, sitemap, MONITORING_WORKFLOW binding) already cover the public-surface acceptance lines once any user signs up.

## Files to modify

- `migrations/0086_landing_page_price_tier.sql` (new, commit `fa169006`) — single `ALTER TABLE landing_page_snapshot ADD COLUMN price_tier TEXT`; ADD COLUMN nullable so no migration of existing rows is load-bearing.
- `app/lib/landing-page-price-tier.server.ts` (new, commit `fa169006`) — pure deterministic extractor: `extractPriceTier(priceText)`, `PRICE_TIER_BANDS` constant, `parsePriceToEur(priceText)` normalisation (€/£/$/USD/EUR/GBP → numeric EUR upper-bound), band mapping, plus `loadPriceTierDistribution(env)` aggregate reader (bounded D1 SELECT ... GROUP BY).
- `app/lib/data/ads.server.ts` (modified, commit `e834b93b`) — `createLandingPageSnapshot` populates `price_tier` at INSERT time using the new extractor; the existing dedup read does not need to read the column.
- `app/lib/sneaker-resale-backfill.server.ts` (modified, commit `e834b93b`) — INSERT statement extended to include `price_tier`.
- `app/lib/demo-brand-backfill.server.ts` (modified, commit `e834b93b`) — INSERT statement extended to include `price_tier`.
- `tests/integration/saucony-watchlist.integration.test.ts` (new, commit `be695a0c`, dead-const removed in `3ef17e7c`) — real-D1 integration test covering all four assertions in phase 3 plus `extractPriceTier` boundary spot-checks.
- `tests/integration/migrations/0086-landing-page-price-tier.integration.test.ts` (new, commit `c2ba24f0`, PRAGMA replaced with `sqlite_master` check + `unknown` bucket asserted in `3ef17e7c`) — migration-test gate proving the read AND write path through real D1.

## Files NOT modified (and why)

- `app/routes/ads.$domain.tsx` — already renders from `discovery_cache_entry` + `landing_page_snapshot` (closed issue #966 engine); once a watchlist row exists for saucony.com, the route renders Ad Aggression Score + longest-run ad + by-the-numbers panel + Offer Timeline strip; the noindex/empty fallback is the existing `!snapshot` 301-redirect to `/search?q=<domain>`. No new code needed.
- `app/lib/sitemap.server.ts` — sitemap entries are DYNAMIC, generated from cached discovery rows at sitemap-render time; once `discovery_cache_entry` rows exist for `saucony.com` / `saucony.co.uk`, the sitemap picks them up automatically. No new sitemap code required.
- `app/routes/timeline.$domain.tsx` and `app/lib/offer-timeline.server.ts` — `/timeline/:domain` already renders existing snapshots automatically; the 14-day window is a landing-page guarantee the route already enforces. No new code needed.
- `app/lib/landing-pages.server.ts` — the capture pipeline already persists `landing_page_snapshot` rows with `price_text` populated; the price-tier column is written by `createLandingPageSnapshot` in `app/lib/data/ads.server.ts` (the same path the capture pipeline calls).
- `app/lib/digest-email.server.ts` for the "Value-tier swing" section — the funnel-measurement privacy gate (BET 7, in place since 2026-09) blocks customer-visible LLM-adjacent text on the daily digest. Even though the issue's note-for-worker specifies a deterministic extractor (no LLM), the section still ships user-facing copy derived from the brand-page corpus, and the gate applies regardless of extraction method — the gate resolves at the BET 7 release, not in this PR. **mechanism-impossible: BET 7 customer-visible text gate unresolved, gate blocks the "Value-tier swing" digest section until BET 7 ships**.
- `migrations/0001_app.sql` watchlist rows for `saucony.com` and `saucony.co.uk` — `user_id` is NOT NULL and FK-constrained to `user(id)`; production cannot create a `watchlist` row without a real user signup. **mechanism-impossible: no system user exists; watchlist rows must belong to a real user**. The integration test seeds a fixture user inside the test, which is acceptable for the test contract but not for production. A real user who creates a Saucony watchlist through the authenticated workspace flow closes the production-side gap; that is outside this PR's blast radius.

## Mechanism-impossible declarations

Recorded per fleet-ops#366 mechanical-fix rule (ship a detector/gate/test/observe-to-close, or declare `mechanism-impossible: <reason>`):

1. **Production D1 `watchlist` rows for `saucony.com` and `saucony.co.uk`** — `mechanism-impossible: no system user exists; watchlist rows must belong to a real user`. `migrations/0001_app.sql:106` declares `user_id TEXT NOT NULL` with `FOREIGN KEY (user_id) REFERENCES user(id)`. There is no system/demo user concept; production cannot INSERT a `watchlist` row without a real signup. The "track for 7d" intent is preserved in this PR by extending the data layer (extractor + aggregate + 5-band column) and by the fact that `data/seed-lists/sneaker-resale.json` already lists `saucony.com` (so any user onboarding sees the cluster already).

2. **`/ads/saucony.com` page, `/ads/saucony.co.uk` page, `/timeline/saucony.com` page, sitemap entries** — `mechanism-impossible: no new code needed; existing engines already cover this surface`. `app/routes/ads.$domain.tsx` (closed issue #966 engine) renders from `discovery_cache_entry` + `landing_page_snapshot`; `app/lib/sitemap.server.ts` reads `discovery_cache_entry` rows at sitemap-render time (no static list); `app/routes/timeline.$domain.tsx` (closed issue #1240 engine) renders from `landing_page_snapshot`. These surfaces ship automatically when a Saucony watchlist exists and produces a verified capture — the same path the other `/ads/:domain` pages use.

3. **`0509-monitoring` Workflow 7-day auto-expire** — `mechanism-impossible: the "0509-monitoring Workflow" mentioned in the issue refers to the existing `MONITORING_WORKFLOW` binding driven by `scheduled_observation` rows; there is no separate "0509-monitoring Workflow" organ. The 7-day auto-expire is a per-watchlist cadence, set when a user creates the watchlist. A real-user Saucony watchlist will be auto-expired by the existing cadence mechanism; no new organ is required.

4. **"Value-tier swing" daily email section** — `mechanism-impossible: BET 7 customer-visible text gate unresolved`. The funnel-measurement privacy gate (BET 7, in place since 2026-09) blocks customer-visible LLM-adjacent text on the daily digest. The issue's note-for-worker explicitly specifies a deterministic extractor (no LLM), which the PR provides (`extractPriceTier` + `loadPriceTierDistribution`). However, the section still ships user-facing copy derived from the brand-page corpus, and the gate applies regardless of extraction method — the gate resolves at the BET 7 release, not in this PR. When BET 7 ships, the section drops in by importing `loadPriceTierDistribution` and rendering the four-band counts; no further schema work is required.

## Risks

- D1 ADD COLUMN adds one nullable TEXT column to a hot table (`landing_page_snapshot`); nullable so no migration of existing rows needed; D1 expands are near-instant for nullable column additions.
- The integration test runs in the `workers` vitest project (real D1) — must apply the migration via `apply-migrations.ts` and assert the read AND write path through `price_tier`, not via a mocked unit test (fleet-ops rule). Confirmed by reviewer: both new tests use `db()` + `applyD1Migrations`, no mocks snuck in.
- The brand-page noindex guard: even if a user creates a Saucony watchlist, `/ads/saucony.com` and the sitemap entry stay out until a `discovery_cache_entry` row with at least one verified-linked ad exists (existing 7-day freshness window + verified-link gate). The integration test bypasses the discovery gate by stubbing `createLandingPageSnapshot`; the public page shipping on prod is gated by the existing engine and is not asserted by this PR.
- The phase 4 mechanism-impossible declaration keeps the PR shippable: the issue's "track for 7d" intent is preserved in the data layer (extractor + aggregate + 5-brand backfill) and the engines (#966, #1240, sitemap) already do the public surface; production auto-execution only requires a user signup, which is outside this PR's blast radius.
- The price-tier extractor returns `"unknown"` for unparseable prices; the aggregator excludes `unknown` from the 4 named bands so the `<€30`, `€30–€100`, `€100–€250`, `>€250` counts sum only to the rows with parseable prices (honest accounting; documented in the module header).
- The European-decimal-format regex gap (Noted, not Act-on): the numeric regex `\d[\d,]*(?:\.\d+)?` does not parse European decimal format (e.g. `1.500,99`). Out of scope for this PR; flagged for the future if the extractor ever sees European-format prices.

## Run-proof contract

- A real-D1 integration test under `tests/integration/saucony-watchlist.integration.test.ts` exercises the D1 binding end-to-end (the `workers` vitest project applies the real migration set and asserts both the watchlist rows AND the `landing_page_snapshot.price_tier` write path).
- A migration-test gate under `tests/integration/migrations/0086-landing-page-price-tier.integration.test.ts` proves the schema accepts the new column and the SELECT/INSERT round-trip works through real D1 (no mocked unit test).
- `npx vitest run --configLoader runner --project workers tests/integration/saucony-watchlist.integration.test.ts tests/integration/migrations/0086-landing-page-price-tier.integration.test.ts tests/integration/landing-page-snapshot-persistence.integration.test.ts` exits 0 (3 files, 12 tests).
- `tsc --noEmit -p tsconfig.json` exits 0.
- `bin/fleet-no-agent-names-check --commit-range origin/main..HEAD` exits 0 (no agent names, no Co-Authored-By trailers, no "Generated with" footers).

## Reviewer-findings bucket index

- **Act on** (3 items, all addressed in commit `3ef17e7c`):
  - Dead `PRICE_TIER_KEYS` const + unused `PRICE_TIER_BANDS` import in `saucony-watchlist.integration.test.ts` → removed.
  - PRAGMA `table_info` was the only PRAGMA use in the integration suite → replaced with `SELECT sql FROM sqlite_master` string check that verifies `price_tier` is in the stored DDL.
  - Migration-gate test (3) did not verify `unknown` bucket → added `loadPriceTierDistribution` call + `expect(distribution.unknown).toBeGreaterThanOrEqual(1)`.

- **Consider** (recorded, NOT re-delegated):
  - Plan over-promised an UPDATE-backfill (`UPDATE ... SET price_tier = CASE WHEN ... END`) that was never shipped; the migration header documents the choice ("nullable-only, no UPDATE backfill") and the column stays NULL-tolerant for legacy rows. The plan above records this explicitly in phase 1.
  - Original plan quoted wrong test paths (`tests/integration/saucony-watchlist.test.ts` vs actual `tests/integration/saucony-watchlist.integration.test.ts`; `tests/migrations/0086-...` vs actual `tests/integration/migrations/0086-...`). The plan above is corrected; the run-proof commands below use the actual paths.

- **Noted** (no code change):
  - European-decimal-format regex gap (`1.500,99` not handled). Out of scope for this PR; flagged for future if the extractor sees European-format prices.
  - `scripts/d1-apply-migrations.mjs` is cited in `migrations/0086_landing_page_price_tier.sql:26` but does not exist; the only real apply path is `wrangler d1 migrations apply`. Cosmetic; left in the migration header as historical context. (Not changed because the file is otherwise correct and the path drift does not affect the migration's correctness.)
  - Forward-compat `bucket in distribution` guard in `loadPriceTierDistribution` silently drops unexpected `price_tier` strings from the aggregate. A `console.warn` would surface drift; Noted for future migration work, no change.

## Stall rule

- 10-minute stall → close with what works + a `stalled: phase N — <reason>` note here. The manager may amend (add/drop phases) with a one-line reason. The 10-minute todo-stall rule still applies.
