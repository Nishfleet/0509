# Plan — `/ads/:domain` "What changed this week" surfaces ad_new as headline (issue #1951)

Manager mode (heavy). Apply the BET 1 re-rank (issue #1897) to the public /ads surface. Reuse the existing `rerankDigestBrief` helper from `app/lib/digest-rerank.ts` so the digest and the /ads page cannot drift again. Stay in scope: `app/routes/ads.$domain.tsx`, `app/lib/brand-page.server.ts`, `app/components/ads/brand-change-timeline.tsx` plus a single new regression test. No migration, no workflow file, no verifier/deploy file touched.

## Goal
Replace the current "1 move · each with a saved screenshot" rendering — which dresses a bare `ad_new` as a headline "move" — with the BET 1 split: landing_page_* events are the headline (with before/after + screenshot), ad_new/ad_inactive collapse into a single counted footnote line, and a brand with zero landing_page_* events renders the honest "No offer changes this week; N new creatives in the wall" message with no headline card.

## Acceptance-driven phases

- [x] phase 1: shared type + helper — in `app/lib/brand-page.server.ts` add `eventType: WatchEventType` to `BrandChangeEvent`; thread `eventType: 'ad_new'` through `buildBrandChangeFeed`'s every emitted row; expose a new pure `rerankBrandChangeFeed(events)` helper that delegates to `rerankDigestBrief` from `app/lib/digest-rerank.ts` so the digest and the /ads surface cannot drift by construction. Keep the cap (`BRAND_CHANGE_FEED_MAX_ROWS = 5`) at the existing 5.
- [x] phase 2: route render — in `app/routes/ads.$domain.tsx` replace `data.changeEvents` with `rerankBrandChangeFeed(data.changeEvents)` (headlineItems / adChurnSummary / otherItems); when `headlineItems` is empty and `adChurnSummary.total === 0` hide the section (no fake card); when `headlineItems` is empty but churn > 0 render the honest "No offer changes this week; N new creatives in the wall." footnote with NO screenshot card; when `headlineItems.length > 0` render them as cards and append the churn footnote as the closing line; drop the misleading "each with a saved screenshot" meta string for the empty-headline case (use "No offer changes this week" instead). `movesThisWeek={data.changeEvents.length}` on the stat line stays unchanged.
- [x] phase 3: regression test + verify — add `tests/ads-brand-page-what-changed.test.tsx` with one fixture {ad_new x3, landing_page_offer_changed x1} that asserts (a) the single headline move is the offer change, (b) ad_new appears only as a counted line, (c) no ad_new row carries a standalone "move" screenshot card; add a second fixture {ad_new x2, zero landing_page_*} asserting (d) the section renders the "No offer changes this week" footnote with no headline card. Run `npx vitest run --configLoader runner --project node tests/ads-brand-page-what-changed.test.tsx tests/ads-brand-page.signals.test.ts tests/digest-rerank.test.ts` green; then `npx vitest run --configLoader runner --project node` (full node project) green; then the two `curl` checks from the issue's verify block (live `/ads/stockx.com` returns 0 matches for `'New ad entered rotation'`).

## Files to Modify
- `app/lib/brand-page.server.ts` — add `eventType` to `BrandChangeEvent`, thread it through `buildBrandChangeFeed`, export `rerankBrandChangeFeed`.
- `app/routes/ads.$domain.tsx` — call `rerankBrandChangeFeed`, branch the render on headlineItems vs adChurnSummary.
- `app/components/ads/brand-change-timeline.tsx` — add an optional `churn` prop so the component renders the single counted footnote line at the bottom of the timeline when churn > 0 (kept optional so the existing test surface continues to work).

## New Files
- `tests/ads-brand-page-what-changed.test.tsx` — regression test covering acceptance bullets 3 and 4 from the issue.

## Risks
- The current `data.changeEvents` is `BrandChangeEvent[]`. Adding `eventType: WatchEventType` is additive — every existing test that constructs a `BrandChangeEvent` (only `tests/ads-brand-page.signals.test.ts`'s `buildBrandChangeFeed` block) feeds through the helper which now sets the field, so existing assertions like `expect(feed[0]?.id).toEqual('today')` keep passing.
- `BrandChangeEvent` is shared between the public route and `tests/ads-brand-page.signals.test.ts`; the new field must remain optional OR be set on every code path that produces an event. Default to "always set" (server-only emit site in `buildBrandChangeFeed`) so no consumer needs an optional-handling branch.
- `BrandChangeTimeline` is rendered in two places: `app/routes/ads.$domain.tsx:1169` (live) and `app/routes/ads.$domain.tsx:1576` (example). The churn footnote is a new prop with default `null` so neither call site breaks.
- The route's headline-item cards currently lack `before` / `after` text fields — `BrandChangeEvent` already carries `move` and `why` strings. The fix uses those as the headline body. A landing_page_* event with structured before/after will use `move: "Offer moved from $X to $Y"`; the current `BrandChangeMove` templates do not produce that, but the helper accepts whatever `eventType` the route sets. The route stays data-agnostic.
- `rerankDigestBrief` is already the canonical helper — do NOT duplicate or re-implement.
- `data.changeEvents` is rebuilt on every loader call. `rerankDigestBrief` is O(N log N) with N ≤ 5 (capped), so this is free.
- No migration. No workflow. No verifier/deploy file. No `bin/fleet-*` script change.

## Out of scope (deliberately not touched)
- Adding a landing_page_* event source to the public /ads page. The current `data.changeEvents` is fed exclusively from cached Meta Ad Library results (`buildBrandChangeFeed(verifiedLinkedAds, now)`); landing_page_* watch events live in the `watch_event` table keyed by `watchlist_id`, which is per-user and not exposed publicly. Wiring a landing_page_* event stream to the public surface is a different issue (likely related to #1946).
- `app/components/ads/brand-change-timeline.tsx` row layout beyond the new `churn` prop. The existing `.f9-ads-tl-row` markup is preserved.
- `app/lib/digest-rerank.ts`. The shared helper stays as-is; this PR only consumes it.
- `tests/digest-rerank.test.ts`. The 17 existing rerank tests already cover `rerankDigestBrief` exhaustively; this PR adds a brand-page-level fixture, not a rerank-level one.
- Any change to `app/lib/brand-page.server.ts`'s offer timeline, capture failures, or aggression score helpers.

## Reviewer round (seat cursor/cursor-grok-4.6-high) — adjudication (issue #1951)

Reviewer output on `origin/main...HEAD`: **Critical: none. Warnings: none.** Every Act-on bucket is empty → no worker re-delegation needed (one-retry-per-phase rule not triggered).

- Consider — `ads.$domain.tsx` cache-miss teaching shell (exampleEvents) still visually dresses a bare ad_new as a headline "move" row ("New" badge). Pre-existing, aria-hidden, explicitly labeled "Example — this is what a watched brand looks like", not the real /ads surface. **Adjudication: Consider (not acting).** The issue's acceptance targets the real rendered surface and the regression test pins that surface. Re-routing the teaching shell is a cosmetic change to a non-shipped teaching state and would widen scope. Recorded for a possible follow-up, not re-delegated.
- Consider — `otherItems` from the shared rerank is silently dropped; no test pins a hypothetical non-headline/non-churn type vanishing. Docstring documents this honestly and every feed row today is ad_new. **Adjudication: Consider (not acting).** The promise is documented; a guard would be additive hardening, out of this issue's scope.
- Noted — `movesThisWeek={data.changeEvents.length}` stat-line cell still counts raw change events; semantically accurate (counts new creatives), not a regression.
- Noted — plan.md rewrite is normal per-lane planning churn; not a protected file.

Decisions: land the diff as-is (all critical/warning buckets empty). Follow-up candidates for new issues, not folded into #1951: (1) route the cache-miss example shell through rerankBrandChangeFeed; (2) pin the non-headline/non-churn "otherItems" handling with a one-line test.
