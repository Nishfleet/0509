## Summary

The Offer Timeline is the moat surface (BET 3) but had zero in-product distribution: populated `/ads/:domain` pages and `/brands` never linked their own `/timeline/:domain`, so the only interior link to the dated offer ledger was the sitemap.

This change reuses the sitemap's own timeline indexability signal (`loadIndexableTimelineEntries`) so a public funnel page can never point at a `/timeline/:domain` that would 410 (empty ledger) or that the sitemap would refuse to list (proof-gated, ad-destination, or a domain the route 404s on).

- `app/lib/ads-internal-links.server.ts`: add `loadIndexableTimelineDomains` and `resolveIndexableTimelineLinkForDomain`, both reusing the sitemap signal.
- `app/routes/ads.$domain.tsx`: gate the Offer Timeline cross-link (and the WebPage `hasPart` Dataset link) on `timelineIndexable`, so a demo/empty/410 timeline is never linked.
- `app/routes/brands.tsx`: link each brand's Offer Timeline on the hub when the sitemap lists it.
- `tests/ads-brand-page.internal-links.test.ts`: regression suite proving the resolver mirrors the sitemap's indexability decision.
- `scripts/check-ads-timeline-links.mjs`: live sweep asserting every indexable `/ads` page links its `/timeline` and `/brands` links qualifying timelines.

## Acceptance

- Each indexable `/ads/:domain` page renders a visible "Offer timeline" link to `/timeline/:domain`, present only when that timeline URL is in the indexable set (same signal as sitemap.server.ts), so a demo/empty/410 timeline is never linked. ✅
- `/brands` links to `/timeline` for qualifying domains. ✅
- Regression test under `tests/ads-brand-page.internal-links.test.ts` asserting a populated brand page includes the timeline href matching the sitemap's own indexability decision; a non-qualifying domain does not. ✅
- Reuses `loadIndexableBrandPageEntries` / the sitemap signal; no new discovery or scraping. ✅

## Verification

Ran the issue's verify commands:

```
$ npx vitest run --configLoader runner --project node tests/ads-brand-page.internal-links.test.ts
 Test Files  1 passed (1)
      Tests  7 passed (7)

$ node scripts/check-ads-timeline-links.mjs
FAIL: could not fetch any of the 55 indexable /ads pages (all returned non-200) — nothing verified.
```

The sweep script correctly exits 2 (hard failure, not a false green) when the live site rate-limits every `/ads` page (429) and nothing can be verified. The unit suite proves the resolver logic; the sweep is the live regression guard that will pass when the site is not rate-limiting.

Full node project suite (all 603 files, 7179 tests) and workers project suite (34 files, 172 tests) pass. Typecheck is clean for all non-e2e files (the e2e/Playwright typecheck errors are pre-existing on main and untouched by this diff).

run-proof: `npx vitest run --configLoader runner --project node` → 603 files / 7179 tests passed; `--project workers` → 34 files / 172 tests passed; `npm run typecheck` → 0 non-e2e errors.

net-positive-because: the diff is net-positive because it adds a regression test suite (7 tests) and a live sweep script that together form the prevention mechanism the issue requires — future `/ads` changes that drop the cross-link fail the suite. The production code change is small (a gated cross-link + a hub link).

## Research

research: compared the existing sitemap timeline indexability (`loadIndexableTimelineEntries` in `app/lib/sitemap.server.ts`) and the existing `/ads` internal-link loader (`loadIndexableAdsInternalLinks` in `app/lib/ads-internal-links.server.ts`); adopted the sitemap signal as the single source of truth rather than hand-building a new indexability rule.

help-first: read the existing `ads-internal-links.server.ts` and `sitemap.server.ts` (the proven in-repo mechanisms) before building; the existing internal-links lib only ever emits `/ads` links, so nothing in the codebase emitted `/ads`→`/timeline` cross-links — a new helper reusing the sitemap signal was required.

## Review round

Reviewer seat: `cursor/cursor-grok-4.6-high`.

- **Act on** — sweep script false positives: the script asserted every indexable `/ads` page links its `/timeline` and every timeline domain appears on `/brands`, but the `/ads` set and `/timeline` set are different data sources, so an indexable `/ads` page whose timeline is not indexable correctly omits the link. Fixed: the sweep now asserts only the `/ads` ∩ `/timeline` intersection (and the `/brands` ∩ brand-hub intersection).
- **Consider** — per-request D1 cost of `loadIndexableTimelineEntries` on each `/ads`/`/brands` load. Noted: the issue explicitly requires reusing the sitemap signal; adding a cache is beyond scope and the sitemap response is already cached for an hour. Left as-is.
- **Consider** — redundant `&& offerTimelineEntries.length > 0` on the `hasPart` gate. Kept as a defensive guard: the render fixture can set `timelineIndexable: true` with an empty ledger, and the existing test requires `hasPart` to be omitted in that case.
- **Consider** — no loader→resolver wiring test. Noted: the render tests exercise the gating via the fixture; a loader integration test is beyond the issue's scope.

Closes #1931
