# Lane evidence — claim/issue-3021 (Nishfleet/0509#3021)

## Task
growth: the /search empty state should feel like a tool, not a brochure —
give the 0-verified case a real next action.

## Changes (commit b61f3fa03, follow-up commit on this branch)

- `app/routes/search.tsx` — the completed 0-verified empty state keeps ONE
  visible honest telling (summary sub-line and SearchAnswerPanel note are
  suppressed when `discoveryEmptyReason === "no_results"`), drops the
  issue-1568 /capture-rules + methodology two-link row from the empty card,
  and renders `suggestedBrands` chips outside the primary `.f9-wk-acts`
  region. Loader serves the chips only when the completed search is empty.
- `app/lib/discovery-panel.server.ts` — `listRecentSearchedBrandSuggestions`
  reads warm `public_search` cache rows (`discovery_cache_entry`), filters to
  entries whose cached payload still holds ≥1 ad and is unexpired, excludes
  the searched domain, caps at 4, swallows transient D1 reads so suggestions
  can never fail the page.
- `app/app.css` — `.f9-wk-suggest` / `.f9-wk-chip`: rule-language outline
  chips, 44px touch floor, flex-wrap + `max-width:100%`/`overflow-wrap`
  so a long domain cannot break 390px.
- `tests/search/empty-state-cross-link.test.tsx` — rewritten: one visible
  "not evidence" line (sr-only aria-live excluded), doc links gone from the
  empty card, exactly one anchor in the primary action region, chip hrefs
  pin `country=all` to the warmed cache entry, chips omitted with an empty
  suggestions row, non-empty card unchanged (chips stay off).

## Reviewer round (senior seat opencode/nemotron-3-ultra-free)

- Act on: stuck dev-debug test `tests/dbg-3021.test.tsx` shipped in the
  commit → removed; missing lane evidence file → this file.
- Act on: chip 390px guarantee was data-dependent (a >253-char registrable
  domain could overflow the chip) → chip CSS now sets `max-width: 100%`
  and `overflow-wrap: anywhere`.
- Consider (not fixed here, filed as follow-up): loader chip-generation
  gate keys on `hydratedResult.ads.length === 0` while the UI empty card
  keys on `visibleAds` + `searchAnswer.state` — a relevance-narrowed pass
  can show the empty card while hydrated results exist and silently
  suppress chips on exactly the state this issue targets.
- Noted: stale-regex fragility of markup assertions; dynamic-import style
  consistent with file; `note: null` already typechecked.

## Test run

- `npx vitest run --configLoader runner --project node --changed origin/main`
  → 92 files / 1022 tests passed (round 2; round 1 caught the visible-telling
  count including the sr-only aria-live announcement — assertion now counts
  visible text only).
- `sgscan` since origin/HEAD → no new security findings.
