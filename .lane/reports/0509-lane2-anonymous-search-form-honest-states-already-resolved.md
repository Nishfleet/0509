# Lane 2 (2026-08-14): anonymous search form error/status honesty — already resolved by PR #579

## Item

- [ ] Make the anonymous search form's error/status states honest (stale validation error during re-submit; "Search complete" on a rejected input) [scout 2026-08-09, risk: green]

## Verdict

**Already resolved on origin/main by PR #579** — `1d00f084` "fix(search): honest anonymous form error/status states", merged 2026-08-11, an ancestor of origin/main HEAD `7960292d`. The item's own `still-seen` observation (2026-08-09 15:07 IST) predates the fix by two days. No product code change was warranted; this lane records the resolution evidence.

## Accept-criteria mapping

1. **"Correcting the input and re-submitting clears the validation error immediately (alert region empty while in flight)"** — implemented in `app/routes/search.tsx` as `searchCommandInFlight` / `liveInputError`: while a re-submit GET navigation to a new /search target is in flight, the committed previous submission's `inputError` stops rendering as an `role="alert"` / `aria-invalid="true"` hint; the form shows "Searching…" instead. The fresh loader result (error or results) takes over on commit.
2. **"A rejected input never writes 'No search results found. Search complete.' to the status region"** — implemented in `app/lib/search-display.ts` `formatSearchResultsAnnouncement`: a `discoveryStatus === "disabled"` result (idle pre-search, refused invalid website, or throttled search) now returns "Enter a competitor website to start." instead of falling through to the "Search complete." branch. `formatEmptyResultHeadline` likewise maps `disabled` to "Enter a competitor website".
3. **"Settled successful searches keep today's behavior"** — unchanged: healthy/degraded/empty completion announcements are untouched.

## Verification on this tip

- `tests/search-submission-settle.test.tsx` — **15/15 passed**, including the dedicated regression "suppresses the stale validation error while a re-submit navigation is in flight" (committed error renders as alert → in-flight re-submit shows "Searching…" with no alert and `aria-invalid="false"` → fresh committed error returns as alert).
- `tests/search-load-more.test.ts` — **8/8 passed**.
- `tests/search.route.test.ts` — **36/36 passed**, including "shows an incomplete-website error instead of silently searching".
- Run with `NODE_ENV=development` (the test environment default; plain `vitest run` outside CI defaults `NODE_ENV=production`, which makes `react.act` undefined in React 19.2 and is unrelated to this change).

## Files touched by this lane

- `.lane/reports/0509-lane2-anonymous-search-form-honest-states-already-resolved.md` (this report only)
