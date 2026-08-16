# Brand "is running"/owns-Meta-ads claims — already resolved by PRs #550 and #561

**Status: evidence record — the item is already merged to main via PRs #550 and
#561. No product code touched by this lane.**

Branch: `0509-lane1-brand-owns-ads-already-resolved`
Base: `origin/main` at `ab7b5f96` (#723)

## Item

- [ ] Stop telling visitors a brand "is running" / owns Meta ads when the
      cached creatives are other advertisers selling

## Verdict

The item is **already landed on `origin/main`**. Two resolving commits are
ancestors of the current main tip, and this lane's re-verification on that tip
finds the ownership-guard logic intact with all regression suites green:

- PR #550 — `159edbd8` "fix(ads): brand pages stop claiming the brand
  runs/owns ads from other advertisers", merged 2026-08-09.
- PR #561 — `6f1026f3` "fix(ads): ad wall never labels an unconfirmed
  creative with the brand name", merged 2026-08-09.

Verified in this worktree:

```
$ git merge-base --is-ancestor 159edbd8 HEAD && echo ancestor   # PR #550
ancestor
$ git merge-base --is-ancestor 6f1026f3 HEAD && echo ancestor   # PR #561
ancestor
```

A prior lane (2026-08-10, lane 10) already recorded evidence for the same item
in commit `588d35af`; this lane re-verifies at the current tip (`ab7b5f96`).

## Evidence on current main (acceptance mapping)

The root cause: a public `/ads/:domain` page renders ONLY from the discovery
cache, and a domain-mode cache also holds creatives from OTHER advertisers
(resellers, affiliates, sellers) whose landing pages point at the brand's site.
The merged fix attributes every claim by per-ad ownership:

- **Ownership signal** — `adIsBrandOwned` / `countBrandOwnedAds` in
  `app/lib/brand-page.server.ts`: a creative counts as the brand's own only on
  v2 advertiser evidence (`verified_advertiser_domain`, `verified_entity`) or
  when the advertiser page name carries the brand's registrable domain or
  whole-word label. Landing-page-only evidence, text-only matches, and blank
  advertiser names never count — the page never claims the brand runs a
  creative it cannot attribute.
- **Loader** — `app/routes/ads.$domain.tsx` computes `brandOwnedAdCount`;
  every copy branch keys off `allBrandOwned` / `noneBrandOwned` / mixed:
  - H1: "`{brand}` is running N Meta ads right now" only when every cached
    creative is brand-owned; otherwise "N Meta ads pointing at `{domain}`"
    (none-owned) or "`{brand}` is running N of these Meta ads" (mixed), with
    past-tense ("at the last check") outside the moments-ago window.
  - Meta title/description and WebPage JSON-LD: "{Brand} Facebook & Instagram
    ads" only when all-owned; otherwise "Meta ads linking to {domain}" with an
    honest split.
  - Ticker tag, hero subline, stat line, closer headline, and closer honesty
    line all name the brand only under `allBrandOwned`; other-advertiser
    captures are attributed to "the advertisers linking to {domain}".
- **Ad wall** — `app/components/ads/brand-ad-wall.tsx` labels every card with
  the creative's REAL stored advertiser (or "Advertiser unconfirmed" when
  blank), never the page's brand name.
- **Change feed** — `buildBrandChangeFeed` reason lines are advertiser-neutral
  ("the advertiser is testing which creative wins"), never "the brand ran this".

## Verification run (this lane)

Run on current main in this worktree (no product changes; report branch only):

```
$ npx vitest run tests/ads-brand-page.render.test.tsx tests/ads-brand-page.route.test.ts tests/ads-brand-page.signals.test.ts tests/search-live-claim.test.tsx
 Test Files  4 passed (4)
      Tests  73 passed (73)
```

- `tests/ads-brand-page.render.test.tsx` — 18 tests: every section of the
  populated page renders in briefed order, including none-owned/mixed/
  unconfirmed surfaces and JSON-LD attribution.
- `tests/ads-brand-page.route.test.ts` — 29 tests: loader counts and meta
  attribution.
- `tests/ads-brand-page.signals.test.ts` — 19 tests: ownership-signal
  predicates.
- `tests/search-live-claim.test.tsx` — 7 tests: the adjacent /search "right
  now" gate (PR #567) stays pinned.

A sweep of every visitor-facing surface found no remaining unconditional
brand-ownership claim about cached creatives.

## Why no new product PR was opened

The packet requires landing the item or reporting plainly why it cannot be
done. The item is already landed: PRs #550 and #561 are merged into main,
shipped ahead of this lane, and their behavior is test-pinned on the current
tip. A second PR re-implementing them would duplicate shipped work; the
productive action is this evidence record so the backlog item can be closed.

## Files

- `.lane/reports/0509-lane1-brand-owns-ads-already-resolved.md` — this
  evidence record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
