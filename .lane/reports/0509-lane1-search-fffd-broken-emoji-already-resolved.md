# Public /search broken emoji (U+FFFD) — already resolved (2026-08-21 lane 1)

**Status: resolved; stale premise — evidence record only, no product code touched.**

Branch: `0509-lane1-search-fffd-broken-emoji-already-resolved`
Base: `origin/main` at `422fbd55`

## Item

- [ ] The public /search page renders a broken emoji — U+FFFD replacement
  character — in the Nykaa "French Pharmacy coll…

## Verdict

Stale premise. The exact defect named in the item was fixed and merged on
2026-08-12 by commit `419d0937` (PR #691, "fix(search): never render U+FFFD
broken emoji in ad copy on /search"), which is an ancestor of current
`origin/main` (`git merge-base --is-ancestor 419d0937 HEAD` → true). The
display-side guard is live in the public /search render path today.

## What the fix does (commit 419d0937)

Root cause: ad-copy truncation used `String.prototype.slice`, which counts
UTF-16 code units, so a cut at an emoji's surrogate-pair boundary left a lone
surrogate behind. A lone surrogate cannot be encoded as UTF-8, so persisting
it (D1) or serializing it into the page silently becomes U+FFFD — the emoji
renders as "�".

Fix in two layers:

- **Capture/analysis root cause**: new `truncateTextSafe()` helper that never
  splits a surrogate pair, applied to every ad-copy truncation site
  (`clampHook`, `stripHeavyEmojiRuns`, meta-library-browser preview
  headline/subhead, meta-api preview subhead). New captures keep the real
  emoji.
- **Display guard for already-persisted corruption**: `scrubBrokenUnicode()`
  strips U+FFFD and lone surrogates (never valid ad copy) from the /search
  row summary, detail quote, headline, hook, offer, and CTA. Real emoji
  (well-formed surrogate pairs) pass through untouched.

Files touched by the fix: `app/lib/analysis.server.ts`, `app/lib/meta-api.server.ts`,
`app/lib/meta-library-browser.server.ts`, `app/lib/search-display.ts`,
`app/lib/text-safe.ts` (new), plus test suites (`tests/text-safe.test.ts`,
`tests/search-display.test.ts`, and regression cases in analysis,
meta-library-browser, meta-api).

## Live verification in this worktree (2026-08-21)

- `git merge-base --is-ancestor 419d0937 HEAD` → true (fix is in main).
- All 22 tests across the guard suites pass:

```
✓ tests/text-safe.test.ts (10 tests)
✓ tests/search-display.test.ts (12 tests)
Test Files  2 passed (2)
     Tests  22 passed (22)
```

- The Nykaa "French Pharmacy collection" case is directly pinned in
  `tests/search-display.test.ts`: "never renders the U+FFFD replacement
  character from stale cached copy" — a body of `"French Pharmacy collection
  \uFFFD"` formats to `"French Pharmacy collection"` in both
  `formatResultCardSummary` and `formatAdDetailBody`.
- The public /search render path (`app/routes/search.tsx`) scrubs every ad
  copy surface: row summary via `formatResultCardSummary`, detail quote via
  `formatAdDetailBody`, and headline/hook/offer/CTA via `scrubBrokenUnicode`
  calls at lines 2076–2111.

## Evidence sources

- `git log` in this worktree: commit `419d0937` (2026-08-12) and merge
  `1f126173` (PR #691 from `Nishfleet/fix/search-fffd-broken-emoji`).
- `tests/search-display.test.ts` lines 99–147: the broken-unicode guard suite
  including the exact Nykaa "French Pharmacy collection" fixture.
- `app/lib/text-safe.ts`: `truncateTextSafe` / `scrubBrokenUnicode`
  implementations.
- `app/routes/search.tsx` lines 2076–2111: scrub calls in the selected-ad
  detail pane.

## Files

- `.lane/reports/0509-lane1-search-fffd-broken-emoji-already-resolved.md` —
  evidence record only; no product code touched.

# PACKET COMPLETE
