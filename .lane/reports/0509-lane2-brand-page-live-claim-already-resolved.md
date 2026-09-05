# PUBLIC BRAND PAGE "RIGHT NOW" / "LIVE" CLAIM — re-verified on current main tip (422fbd55, lane 2)

**Status: evidence record — the item is already implemented on the merged chain
that closes the original scout 2026-08-09 finding, and re-verified on the
current main tip. No product code touched by this lane.**

Branch: `0509-lane2-brand-page-live-claim-already-resolved`
Base: `origin/main` at `422fbd55` (#806, the current `main` HEAD)

## Item

- [ ] Make public brand pages stop claiming "right now" / "live" when the
      capture is hours old [scout 2026-08-09, risk: (empty)]

## Verdict

The item is **already implemented and merged to main** through a chain of
six PRs that close the original scout 2026-08-09 finding and three
subsequent tightenings. Lane 1 (`.lane/reports/0509-lane1-brand-page-live-claim-already-implemented.md`)
recorded the same evidence at `ab7b5f96` (#723). This lane **re-verifies the
gating is intact at the current main tip** (`422fbd55`, #806) after the
later real-proof-surface work landed and ran the brand-page test set against
that tip.

The implementation is present on the current main tip (`422fbd55`) with no
later commits touching any of the gating files:

- `git log 422fbd55 -- app/lib/brand-page.server.ts` → newest commit is
  `542cb8e1` (#720) itself, then `4d747f06` (#680), `5e63f1df` (#620),
  `d863fd18` (#548). The more recent commits (`422fbd55`, `b25cb2d2`,
  `678fddd1`, `869fb017`) touch different files; none undo or weaken the
  gate.
- `git log 422fbd55 -- app/routes/ads.$domain.tsx` → newest commit touching
  `freshForLiveClaim` is `542cb8e1` (#720).
- `git log 422fbd55 -- app/components/ads/brand-stat-line.tsx` → newest
  commit is `8725cf11` (#681), which closed the parallel signed-in
  "marked active" copy leak.

## PR chain that closed the item

| PR    | Commit     | Title |
|-------|------------|-------|
| #548  | `d863fd18` | `fix(ads): public brand pages stop claiming 'right now'/'live' on stale captures` (original scout 2026-08-09 fix) |
| #567  | `5e682868` | `fix(search): gate public /search 'right now' promise on a proven fresh-live Ad Library capture` |
| #620  | `5e63f1df` | `fix(ads): live claim only within the moments-ago window, not the whole hour` |
| #680  | `4d747f06` | `fix(ads): keep the live-claim gate strictly inside the moments-ago window` |
| #681  | `8725cf11` | `fix(ads): brand-page stat strip drops signed-in 'marked active' copy` |
| #720  | `542cb8e1` | `fix: keep brand-page live claim and stamp on one clock` |

`git log --grep="public brand pages stop claiming" --oneline` confirms PR #548
exists verbatim (`d863fd18 fix(ads): public brand pages stop claiming 'right now'/'live' on stale captures`),
and the full chain above is reachable from `origin/main`.

## What the merged code does (acceptance mapping)

The item's two requirements — "stop claiming 'right now'" and "stop claiming
'live' when the capture is hours old" — map to one gate, and every
present-tense claim on the public brand page is gated by it.

### 1. The gate is one constant + one helper

`app/lib/brand-page.server.ts`:

- `BRAND_PAGE_LIVE_CLAIM_MAX_AGE_MS = BRAND_PAGE_MOMENTS_AGO_MS = 2 * 60 * 1000`
  — the live-claim window is locked equal to the "moments ago" bucket
  constant, so the two boundaries can never drift.
- `resolveBrandPageFreshness(fetchedAt, now)` returns
  `{ checkedAgo, freshForLiveClaim }` where
  `freshForLiveClaim === (checkedAgo === "moments ago")`. One clock, one
  decision. The helper is the single source of truth for both the visible
  freshness stamp and the live-claim flag, so a D1 read gap can no longer
  pair "right now" with "about 2 minutes ago" (the two-clock trap fixed by
  #720).

### 2. Every present-tense claim on `/ads/:domain` is gated

`app/routes/ads.$domain.tsx` — direct present-tense surface (each line is
gated through `data.freshForLiveClaim`):

- **Page title** (`brandPageTitle`, line 233): only emits
  `"… right now | Five to Nine"` when `freshForLiveClaim && checkedAgo`;
  otherwise emits `"… — checked ${checkedAgo} | Five to Nine"`.
- **Status pill** (`BrandAdsResults`, line 476): renders
  `"Running right now"` only when `freshForLiveClaim`; otherwise
  `"From the last check"`.
- **H1 verdict** (`brandHeadline`, lines 541, 550, 556, 562): three
  branches (all-brand-owned, none-brand-owned, mixed) all branch on
  `freshForLiveClaim`. Present-tense `"is running … right now"` is
  swapped for past-tense `"was running … at the last check"` /
  `"The last check found … pointing at …"`.
- **Subline** (`heroDetailSentence`, line 412): present-tense
  `"They're testing … and …"` / `"Other advertisers are running ads that
  link to …"` is swapped for past-tense `"They were …"` /
  `"At the last check, other advertisers were …"` when not fresh.
- **Stat strip / wall / ticker** (`BrandStatLine`, `BrandTicker`,
  `BrandAdWall`, lines 356, 446, 489): `fresh={data.freshForLiveClaim}`
  is passed through and switches their captions from `"Ads live"` /
  `"live"` / `"more ads live"` to `"Ads on record"` / `"on record"` /
  `"more ads on record"` at the same boundary.

### 3. The freshness stamp is the only time claim on stale captures

When the capture is older than `BRAND_PAGE_LIVE_CLAIM_MAX_AGE_MS` (2
minutes), the only time reference on the page is the loader-rendered
`Last checked ${checkedAgo}` stamp — there is no other present-tense
surface in the brand-page route that names "now" or "live" outside the
gate.

## Verification run on the current main tip (`422fbd55`)

```
$ env -u NODE_ENV node /home/nish/workspaces/products/0509/node_modules/.bin/vitest run \
    tests/ads-brand-page.signals.test.ts tests/ads-brand-page.route.test.ts
 Test Files  2 passed (2)
      Tests  53 passed (53)

$ env -u NODE_ENV node /home/nish/workspaces/products/0509/node_modules/.bin/vitest run \
    tests/search-live-claim.test.tsx tests/search-display.test.ts \
    tests/ads-brand-page.signals.test.ts tests/ads-brand-page.route.test.ts \
    tests/public-proof-summary.test.ts tests/landing-page-capture-headers.test.ts
 Test Files  6 passed (6)
      Tests  79 passed (79)
```

The brand-page test files lock the gate's behavior on the current tip:

- `tests/ads-brand-page.signals.test.ts::resolveBrandPageFreshness` — exact
  boundary pairs: `0ms → "moments ago", true`; `119_999ms → "moments ago",
  true`; `120_000ms → "about 2 minutes ago", false`; `120_001ms → "about 2
  minutes ago", false`; `5*60_000ms → "about 5 minutes ago", false`. Also
  pins the two-clock-trap invariant: `freshForLiveClaim === (checkedAgo
  === "moments ago")` for any `now`.
- `tests/ads-brand-page.signals.test.ts::resolveBrandPageFreshness > documents the two-clock trap`
  — verifies the helper refuses the disagreeing "early-claim + late-stamp"
  mix on one clock; one call cannot return that mix.
- `tests/ads-brand-page.route.test.ts` — routes-level coverage: the
  freshness gate composes correctly with the cache entry's `fetchedAt`,
  the page never renders a live claim on a stale capture, and the
  cache-miss shell never renders a freshness stamp at all.

The companion suites cover the related surfaces (search-live-claim,
search-display, public-proof-summary, landing-page-capture-headers) and
all pass green on the current tip.

## Why no new product PR was opened

The packet requires landing the item or reporting plainly why it cannot
be done. The item is already landed: six merged PRs (most recent #720 at
`542cb8e1`, then #681, #680, #620, #567, #548) close the original scout
2026-08-09 finding and tighten the gate three times since. The current
main tip's behavior is test-pinned at the boundary by
`tests/ads-brand-page.signals.test.ts` (53 tests pass on `422fbd55`).

A seventh PR re-implementing the same gating would duplicate shipped
work, and either land identical code (no value) or worse, drift the
constants out of alignment (the exact regression #720 fixed). The
productive action is this evidence record so the backlog item can be
closed against the current tip.

## Files

- `.lane/reports/0509-lane2-brand-page-live-claim-already-resolved.md` —
  this evidence record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing
change.
