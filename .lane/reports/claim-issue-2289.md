# Lane evidence — claim/issue-2289

Issue: Nishfleet/0509#2289 — reccos: Default the anonymous /search preview to verified-first

## What changed
- `app/lib/search-sort.ts`: added `verified_first` sort option + `compareAdsVerifiedFirstThenActive`
  comparator (verified tier > likely > unmatched, active-first within tier) and
  `ANONYMOUS_DEFAULT_SEARCH_RESULT_SORT = "verified_first"`. Uses the existing
  `domainMatchTier` field; no new status added.
- `app/routes/search.tsx`: anonymous sessions (`!data.session`) default to
  `verified_first`; signed-in sessions keep `active_first`. Added "Verified first"
  to the sort `<select>`. An explicit `?sort=` always wins.
- `app/routes/$locale.search.tsx`: unchanged — re-exports `./search` end to end,
  so the locale buyer-surface inherits the fix.

## Acceptance
- Anonymous /search payload sorts every verified row above every Likely row
  (verified-first default). Counts and labels unchanged.
- Logged-in default sort unchanged (active_first).

## Verification (run on this VPS)
- `npm run typecheck` → exit 0
- `npm test` → node: 656 files / 7813 tests passed; workers: 50 files / 244 tests passed; exit 0
- `npx vitest run tests/search-sort.test.ts` → 7 passed
- `npx vitest run tests/search.route.test.ts` → 45 passed (incl. new #2289 test)
