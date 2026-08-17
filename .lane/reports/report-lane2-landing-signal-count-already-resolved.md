# Public /search "Landing-page signal" count (2026-08-17 lane 2) — already resolved by PR #553, re-verified on current main

**Status: already resolved; this lane re-verifies on the current tip and records evidence only.**

Branch: `report/lane2-landing-signal-already-resolved-20260817`
Base: `origin/main` at `6d4fcd2d` (#765)

## Item

- [ ] Stop counting destination URLs as captured "Landing-page signal" on
  public search [scout 2026-08-09, risk: amber]

## Verdict

No code change was warranted. The item landed on `origin/main` as PR #553 —
`0940c79b` "fix(search): stop counting destination URLs as captured
landing-page signals", merged 2026-08-09 — and remains fully in force on the
current `main` HEAD (`6d4fcd2d`). Two prior re-verify lanes (2026-08-10 lane 2,
commit `7476d4a7` on branch `report/lane2-landing-signal-count-already-resolved`;
2026-08-12 lane 8, branch `report/lane8-landing-signal-count-already-resolved`;
and the 2026-08-17 lane 1 re-verify on branch
`report/lane1-landing-signal-already-resolved`) already recorded the same
verdict at older main tips. This lane re-verified it against the latest tip
after the three merges since the last lane-2 re-verify
(`e6610a69` LP noise-filter, `3b2629b2` LP churn-stable CTA, `fdb97b84`
per-branch report path). None of them touches the count.

## Evidence re-verified on current main (6d4fcd2d)

- **Only the fact source** computes the count: `buildSearchAnswer()` in
  `app/lib/search-answer.ts` is the one place that builds the
  `"Landing-page signal X/Y"` fact, and its only caller is the public /search
  route (`app/routes/search.tsx`, `buildSearchAnswer({ result: visibleResult,
  ... })`). It counts only captured snapshots:
  `ads.filter((ad) => Boolean(ad.landingPage)).length` — a destination URL
  alone (`ad.landingPageUrl`) cannot contribute.
  - Code comment in `search-answer.ts:43-44` pins the contract:
    "Only a captured landing-page snapshot is a 'Landing-page signal'; the
    ad's destination URL alone is not evidence the page was ever captured."
- **`landingPage` is never fabricated from a URL**:
  - `app/lib/ad-persistence.server.ts` merges `storedAd.landingPage` only
    from what was actually persisted (a real capture).
  - `app/lib/search-selection.server.ts` uses
    `Boolean(ad.landingPageUrl) && !ad.landingPage` solely to decide when a
    capture should run, never to count captured signals.
  - `app/lib/search-display.ts:234` shows the captured badge only when
    `ad.landingPage?.capturedAt` exists; URL-only ads fall through to
    `ad.landingPageUrl` for the destination link and never a captured badge.
- **Honest missing notes** still render: when `landingPageCount === 0` the
  answer shows the fact value `0/N` with "Not captured yet; use the ad cards
  as creative signals only", and the summary notes read
  "Landing-page signals are not captured on these matches yet." /
  "Landing-page signals are missing, so treat the ad creative as the current
  signal." / "Landing-page signals are not captured yet." — instead of the
  pre-fix false `1/1`.
- **No regressions in the three merges since the last lane-2 re-verify on
  branch `7476d4a7`**: `git log 7476d4a7..6d4fcd2d -- app/lib/search-answer.ts`
  is empty; the same range against `app/lib/landing-page-signals.server.ts`
  shows only `e6610a69` "noise-filter landing-page changes — ad-slot
  suppression" which adds `stripAdSlotRegions` and never affects how a captured
  signal is counted; `3b2629b2` "churn-stable CTA/offer" is in
  `app/lib/change-intelligence.ts` / `app/lib/proof-classification.ts`,
  unrelated to the count; `fdb97b84` "per-branch report path" only renames
  evidence files.
- **Regression pins still cover the contract** (`tests/search-answer.test.ts`):
  - "does not count destination URLs alone as captured landing-page signals":
    URL-only ad → fact value `0/1`, detail "Not captured yet; use the ad cards
    as creative signals only", summary note "Landing-page signals are missing,
    so treat the ad creative as the current signal."
  - "counts only captured landing-page snapshots across mixed results":
    captured + URL-only → fact value `1/2`.
  - "warns when returned ads do not include landing-page signals":
    `landingPageUrl: null`, `landingPage: null` → fact value `0/1` and missing
    note.
- **No other public-search surface overcounts**:
  - `app/lib/search-display.ts` renders a captured badge only when
    `ad.landingPage?.capturedAt` exists.
  - `app/lib/insight-depth.ts` (workspace collections) labels URL-only as
    "Destination tracked", never as a captured signal.

## Verification on this tip (origin/main `6d4fcd2d`)

- `tests/search-answer.test.ts`: 1 file, 18/18 passed (same cases as prior
  re-verifies — URL-only → `0/1`, mixed → `1/2`).
- `tests/search-display.test.ts`: 1 file, captured-badge-gated by
  `ad.landingPage?.capturedAt`.
- `tests/landing-page-signals.test.ts`: 1 file, captures CTA / price / form
  detection from a real fetched landing page.
- `tests/search-live-claim.test.tsx`: 1 file, keeps the /search "right now"
  claim pinned to fresh live captures.

## Files

- `.lane/reports/report-lane2-landing-signal-count-already-resolved.md` —
  this evidence record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
