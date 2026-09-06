# Public search "right now" promise — already implemented and merged (PR #567)

**Status: evidence record — the item is implemented in merged PR #567 on current
main. No product code touched by this lane.**

Branch: `0509-lane1-fresh-live-gate`
Base: `origin/main` at `542cb8e1` (#720)

## Item

- [ ] Gate public search's "right now" promise on a proven fresh-live Ad Library
      capture [scout 2026-08-09, risk: green]

## Verdict

The item is **already implemented and merged to main** by PR #567
(`fix(search): gate public /search 'right now' promise on a proven fresh-live
Ad Library capture`, commit `5e682868`, merged 2026-08-09). Verified in this
worktree with `git merge-base --is-ancestor 5e682868 origin/main` (true); the
implementation is present on the current main tip (`542cb8e1`, #720).

## What PR #567 ships (acceptance mapping)

- **`isProvenFreshLiveCapture()` in `app/lib/search-display.ts`** is the single
  gate: true only for a cache miss on a healthy, non-partial, non-demo provider
  check. It fails closed on demo, partial, delayed/degraded, unknown-discovery,
  cache-hit, and stale states. This is the only predicate under which the page
  may make a fresh/live claim.
- **`formatSearchFreshnessLabel()`** renders `Fresh live result` only under that
  gate. Cached hits say `Recent cached result`, stale entries `Older cached
  result`, delayed checks `Fresh check delayed`, partial captures
  `Fresh partial result`, and idle/demo `Freshness unavailable`.
- **`app/routes/search.tsx`** idle copy no longer promises "right now"; the
  result panel renders the gated freshness label (`formatSearchFreshnessLabel`
  at the provenance line, plus `data.resultCaptureAgeLabel` for cache-served
  snapshots). No un-gated "right now" or "running on Meta right now" wording
  remains on the public search surface.
- **`tests/search-live-claim.test.tsx`** pins the contract: unit assertions on
  the predicate and label against idle/cached/degraded/partial/demo/warming
  fixtures, plus route-render assertions proving the idle state and each
  result state carry no un-gated claim.

A later lane (2026-08-10, lane 2) already recorded evidence for the same item in
commit `40669e5b`/`cfeceefe`; this lane re-verifies at the current tip.

## Verification run (this lane)

Run on current main in this worktree (no product changes; report branch only):

```
$ npx vitest run tests/search-live-claim.test.tsx tests/search-display.test.ts tests/search-answer.test.ts
 Test Files  3 passed (3)
      Tests  33 passed (33)
```

- `tests/search-live-claim.test.tsx` — **7 tests**: predicate fixture matrix
  (fresh-live true only for miss+healthy+real provider), label honesty for
  cached/degraded/partial/demo/warming/idle, and route-render assertions that
  the idle page, cached results, and cached_degraded results render no
  "right now"/"Fresh live result" claim, with the fresh-live fixture being the
  ONLY rendered state allowed fresh/live language.
- `tests/search-display.test.ts` — **8 tests**, `tests/search-answer.test.ts` —
  **18 tests**, all green.

## Why no new product PR was opened

The packet requires landing the item or reporting plainly why it cannot be done.
The item is already landed: PR #567 is merged into main, shipped ahead of this
lane, and its behavior is test-pinned on the current tip. A second PR
re-implementing it would duplicate shipped work; the productive action is this
evidence record so the backlog item can be closed.

## Files

- `.lane/reports/0509-lane1-fresh-live-gate.md` — this evidence record (the
  only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
