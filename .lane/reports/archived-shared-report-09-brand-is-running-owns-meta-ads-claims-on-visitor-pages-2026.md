# Brand "is running"/owns-Meta-ads claims on visitor pages (2026-08-10 lane 10) — already resolved by PRs #550 and #561

**Status: already resolved; this lane records the evidence only.**

Branch: `report/lane10-brand-owns-ads-already-resolved`
Base: `origin/main` at `f2c583ef`

## Item

- [ ] Stop telling visitors a brand "is running" / owns Meta ads when the
  cached creatives are other advertisers selling

## Verdict

No code change was warranted. The item is already landed on `origin/main`:

- PR #550 — `159edbd8` "fix(ads): brand pages stop claiming the brand
  runs/owns ads from other advertisers", merged 2026-08-09.
- PR #561 — `6f1026f3` "fix(ads): ad wall never labels an unconfirmed
  creative with the brand name", merged 2026-08-09.
- The adjacent public `/search` "right now" promise is separately gated by
  PR #567 — `5e682868`, merged 2026-08-09.

All three are ancestors of the current `main` HEAD (`5021807e`). No later
commit touches the involved files (`app/lib/brand-page.server.ts`,
`app/routes/ads.$domain.tsx`, `app/components/ads/*`).

## Evidence on current main

The root cause was that a public `/ads/:domain` page renders ONLY from the
discovery cache, and a domain-mode cache also holds creatives from OTHER
advertisers (resellers, affiliates, sellers) whose landing pages point at the
brand's site. Before the fix, the hero headline, meta title/description,
ticker tag, closer headline, closer honesty line, and ad-wall card labels
unconditionally told visitors the brand "is running" / owns every cached ad.
The merged fix attributes every claim by per-ad ownership:

- **Ownership signal** (`adIsBrandOwned` / `countBrandOwnedAds` in
  `app/lib/brand-page.server.ts`): a creative counts as the brand's own ONLY
  on `search-v2` `verified_advertiser_domain` / `verified_entity` evidence, an
  advertiser page named with the brand's registrable domain token, or an
  advertiser page named with the brand label as a whole word. Landing-page-only
  match levels (`exact_hostname`, `registrable_domain`, `verified_alias`),
  unrelated advertiser names, blank advertiser names, and text-only matches
  NEVER count — so the page never claims the brand runs creatives it cannot
  attribute.
- **Loader** (`app/routes/ads.$domain.tsx`): exposes `brandOwnedAdCount`; every
  claim surface keys off all-owned / none-owned / mixed:
  - H1 verdict: "{Brand} is running N Meta ads right now" only when EVERY
    cached creative is the brand's own; none-owned renders "{N Meta ads are}
    pointing at {domain} right now" (fresh) or "The last check found …";
    mixed renders "{Brand} is running {k} of these N Meta ads".
  - Meta title/description and the WebPage JSON-LD: "{Brand} Facebook &
    Instagram ads" only when all-owned; otherwise "Meta ads linking to
    {domain}" with the split named (see
    `tests/ads-brand-page.route.test.ts` "never claims the brand owns ads when
    the cached creatives are other advertisers'").
  - Ticker: tags the brand only when all creatives are its own, else tags the
    domain.
  - Hero subline and closer headline/honesty line: attribute to "other
    advertisers" / "the advertisers linking to {domain}" and state exactly who
    runs what in a mixed cache.
  - Change-feed reason line is advertiser-neutral ("the advertiser is testing
    which creative wins"), since a feed row may be another advertiser's ad.
- **Ad wall** (`app/components/ads/brand-ad-wall.tsx`, PR #561): every card is
  attributed to the creative's REAL advertiser as stored in the cache; an
  unconfirmed advertiser renders "Advertiser unconfirmed" — never the page's
  brand name.
- **Freshness honesty** (adjacent, PR #567 + the route's
  `freshForLiveClaim` gate): present-tense "right now"/"live" wording appears
  only while the capture is young enough for a live claim; older captures flip
  to "was running … at the last check" / "on record".

A sweep of every visitor-facing route on this tip (`ads.$domain`, `search`,
`marketing`, `compare/*`, `docs`, `changelog`, `help`, `not-found`) found no
remaining unconditional brand-ownership claim about cached creatives — the
only "is running" instances left in `ads.$domain.tsx` are inside the
all-owned / mixed branches and the none-owned branch attributes to the
advertisers.

## Regression pins (on this tip)

- `tests/ads-brand-page.signals.test.ts` — `adIsBrandOwned` /
  `countBrandOwnedAds`: label/domain-token/v2-evidence counting, landing-only
  levels never count, unrelated sellers never count, mixed-cache counts.
- `tests/ads-brand-page.route.test.ts` — loader counts only the brand's own
  creatives as brand-owned, reports zero when every cached ad is another
  advertiser's, never claims the brand owns ads in meta title/description,
  keeps "right now" only while fresh.
- `tests/ads-brand-page.render.test.tsx` — "stops telling visitors the brand
  is running ads when the creatives are other advertisers'", "names the split
  when the cache mixes the brand's own ads with other advertisers'", "never
  labels a creative with the brand name when its advertiser is unconfirmed",
  plus JSON-LD / live-claim tense flips.
- `tests/search-live-claim.test.tsx` — the /search "right now" promise is
  pinned to proven fresh-live captures only.

## Verification on this tip (origin/main `5021807e`)

- `ads-brand-page.signals.test.ts`, `ads-brand-page.route.test.ts`,
  `ads-brand-page.render.test.tsx`, `search-live-claim.test.tsx`: 4 files,
  59/59 tests pass.
- `npm run typecheck`: exit 0.

## Files

- `.lane/report.md` — evidence record only; no product code touched.

---
