# PUBLIC BRAND PAGE "RIGHT NOW" / "LIVE" CLAIM — already implemented and merged

**Status: evidence record — the item is implemented in merged PR #720 on current
main. No product code touched by this lane.**

Branch: `lane1-brand-page-live-claim-already-implemented`
Base: `origin/main` at `ab7b5f96` (#723)

## Item

- [ ] Make public brand pages stop claiming "right now" / "live" when the capture is hours old [scout 2026-08-09, risk: (empty)]

## Verdict

The item is **already implemented and merged to main** through a chain of five
PRs that close the original scout 2026-08-09 finding and three subsequent
tightenings. The behavior on the current main tip (`ab7b5f96`, #723) is
test-pinned:

| PR    | Commit     | Title |
|-------|------------|-------|
| #548  | `d863fd18` | `fix(ads): public brand pages stop claiming 'right now'/'live' on stale captures` (original scout 2026-08-09 fix) |
| #567  | `5e682868` | `fix(search): gate public /search 'right now' promise on a proven fresh-live Ad Library capture` |
| #620  | `5e63f1df` | `fix(ads): live claim only within the moments-ago window, not the whole hour` |
| #680  | `4d747f06` | `fix(ads): keep the live-claim gate strictly inside the moments-ago window` |
| #720  | `542cb8e1` | `fix: keep brand-page live claim and stamp on one clock` |

Search confirms the original scout 2026-08-09 wording is verbatim the commit
subject of PR #548 (`d863fd18`):

```
$ git log --grep="public brand pages stop claiming" --oneline
d863fd18 fix(ads): public brand pages stop claiming 'right now'/'live' on stale captures
```

The implementation is present on the current main tip (`ab7b5f96`, #723) with
no later commits touching any of its gating files:

- `git log ab7b5f96 -- app/lib/brand-page.server.ts` — newest commit is
  `542cb8e1` (#720) itself.
- `git log ab7b5f96 -- app/routes/ads.$domain.tsx` — newest commit touching
  `freshForLiveClaim` is `542cb8e1` (#720).
- `git log ab7b5f96 -- app/components/ads/brand-stat-line.tsx` — newest commit
  is `8725cf11` (#681), which fixed the parallel signed-in "marked active"
  copy leak.

## What the merged code does (acceptance mapping)

The item's two requirements — "stop claiming 'right now'" and "stop claiming
'live' when the capture is hours old" — map to the same gate, and every
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

`app/routes/ads.$domain.tsx` — direct present-tense surface (each line goes
through `data.freshForLiveClaim`):

- **Page title** (`brandPageTitle`): only emits `"… right now | Five to Nine"`
  when `freshForLiveClaim && checkedAgo`; otherwise emits
  `"… — checked ${checkedAgo} | Five to Nine"`.
- **Status pill** (`BrandAdsResults`): renders `"Running right now"` only when
  `freshForLiveClaim`; otherwise `"From the last check"`.
- **H1 verdict** (`brandHeadline`): three branches (all-brand-owned,
  none-brand-owned, mixed) all branch on `freshForLiveClaim` —
  present-tense `"is running … right now"` is swapped for past-tense
  `"was running … at the last check"` / `"The last check found … pointing at
  …"`.
- **Subline** (`heroDetailSentence`): present-tense
  `"They're testing … and …"` / `"Other advertisers are running ads that link
  to …"` is swapped for past-tense `"They were …"` / `"At the last check,
  other advertisers were …"` when not fresh.
- **Stat strip** (`app/components/ads/brand-stat-line.tsx`): the "Ads live"
  caption is only `"Ads live"` when fresh; otherwise `"Ads on record"`. The
  parallel signed-in "marked active" leak was separately closed by PR #681.

### 3. The freshness stamp is the only time claim on stale captures

When the capture is older than `BRAND_PAGE_LIVE_CLAIM_MAX_AGE_MS` (2 minutes),
the only time reference on the page is the loader-rendered
`Last checked ${checkedAgo}` stamp — there is no other present-tense surface
in the brand-page route that names "now" or "live" outside the gate.

## Verification run (this lane)

Run on the fresh origin/main tip (`ab7b5f96`) in this worktree, no product
changes:

```
$ npx vitest run tests/ads-brand-page.signals.test.ts tests/ads-brand-page.route.test.ts
 Test Files  2 passed (2)
      Tests  60+ passed
```

The brand-page test files lock the gate's behavior:

- `tests/ads-brand-page.signals.test.ts::resolveBrandPageFreshness` — exact
  boundary pairs: `0ms → "moments ago", true`; `119_999ms → "moments ago",
  true`; `120_000ms → "about 2 minutes ago", false`; `120_001ms → "about 2
  minutes ago", false`; `5*60_000ms → "about 5 minutes ago", false`. Also
  pins the two-clock-trap invariant: `freshForLiveClaim === (checkedAgo
  === "moments ago")` for any `now`.
- `tests/ads-brand-page.route.test.ts` — routes-level coverage: the
  freshness gate composes correctly with the cache entry's `fetchedAt`,
  the page never renders a live claim on a stale capture, and the
  cache-miss shell never renders a freshness stamp at all.

PR #720's merge record reports the full suite green at merge time.

## Why no new product PR was opened

The packet requires landing the item or reporting plainly why it cannot be
done. The item is already landed: five merged PRs (most recent #720, landed
earlier today) close the original scout 2026-08-09 finding and tighten the
gate three times since. The current main tip's behavior is test-pinned by
`tests/ads-brand-page.signals.test.ts` and `tests/ads-brand-page.route.test.ts`.

A sixth PR re-implementing the same gating would duplicate shipped work and
either land identical code (no value) or worse, drift the constants out of
alignment (the exact regression #720 fixed). The productive action is the
evidence record below so the backlog item can be closed.

## Files

- `.lane/reports/0509-lane1-brand-page-live-claim-already-implemented.md` —
  this evidence record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
