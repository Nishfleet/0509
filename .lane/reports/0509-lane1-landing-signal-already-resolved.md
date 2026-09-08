# Public /search "Landing-page signal" count — already resolved by PR #553

**Status: already resolved; this lane records the evidence only.**

Branch: `report/lane1-landing-signal-already-resolved`
Base: `origin/main` at `370e5417` (#717)

## Item

- [ ] Stop counting destination URLs as captured "Landing-page signal" on
  public search (scout 2026-08-09, risk: amber).

## Verdict

No code change was warranted. The item is already landed on `origin/main` as
PR #553 — `0940c79b` "fix(search): stop counting destination URLs as captured
landing-page signals", merged 2026-08-09, and is an ancestor of the current
`main` HEAD (`370e5417`, #717). A prior lane (2026-08-10) already recorded
the same evidence; this lane re-verified on the current tip.

## Evidence on current main

- **Count source**: `buildSearchAnswer()` in `app/lib/search-answer.ts` is the
  only place that computes the "Landing-page signal X/Y" fact, and its only
  caller is the public search route (`app/routes/search.tsx`). Current main
  counts only captured snapshots:
  `ads.filter((ad) => Boolean(ad.landingPage)).length` — a destination URL
  alone (`ad.landingPageUrl`) no longer contributes. The comment pins the
  intent: "Only a captured landing-page snapshot is a 'Landing-page signal';
  the ad's destination URL alone is not evidence the page was ever captured."
- **Honest missing notes**: when the count is 0 the answer shows the fact
  value `0/N` with "Not captured yet; use the ad cards as creative signals
  only", and the summary notes say "Landing-page signals are not captured on
  these matches yet." / "Landing-page signals are missing, so treat the ad
  creative as the current signal." / "Landing-page signals are not captured
  yet." — instead of the pre-fix false `1/1`.
- **Regression pins**: `tests/search-answer.test.ts` (both added by PR #553)
  pins "does not count destination URLs alone as captured landing-page
  signals" (URL-only ad -> `Landing-page signal 0/1` + missing note) and
  "counts only captured landing-page snapshots across mixed results" (captured
  + URL-only -> `1/2`).
- **No other public-search surface overcounts**: `app/lib/search-display.ts`
  shows a captured badge only when `ad.landingPage?.capturedAt` exists;
  `app/lib/search-selection.server.ts` uses `Boolean(ad.landingPageUrl) &&
  !ad.landingPage` only to decide when a capture should run, never to count
  captured signals. The workspace-collections insight
  (`app/lib/insight-depth.ts`) labels URL-only honestly as "Destination
  tracked", not as a captured signal.

## Verification run (this lane)

Run on current main in this worktree (no product changes; report branch only):

```
$ npx vitest run tests/search-answer.test.ts
 Test Files  1 passed (1)
      Tests  18 passed (18)
```

## Files

- `.lane/reports/0509-lane1-landing-signal-already-resolved.md` — this
  evidence record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
