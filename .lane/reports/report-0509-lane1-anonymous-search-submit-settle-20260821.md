# Anonymous search submit leaving "Searching…" after the request settles — already resolved

**Status: already resolved on `origin/main`; this lane records the re-verification evidence only. No duplicate PR opened.**

Branch: `0509-lane1-anonymous-search-submit-settle-20260821`
Base: `origin/main` at `422fbd55` (#806)
Worktree: `/home/nish/workspaces/agent-worktrees/0509-lane1-20260821-040031`

## Item

- [ ] Make the anonymous search submit leave “Searching…” after the request
  settles [research-desk 2026-08-09 01:27 IST,

## Verdict

No product code change was warranted. The item is already landed on
`origin/main` as PR #559 (commit `90147b9b`, merged 2026-08-09 — the scout's
own flag date) and has been continuously maintained by later merged fixes.
Verified with `git merge-base --is-ancestor 90147b9b origin/main` on this
worktree: the fix commit is an ancestor of the current `origin/main` HEAD
(`422fbd55`). This lane re-verifies the behavior on fresh main and records the
evidence; it does not open a second PR for an item a merged PR already
resolves (fleet convention, same as the earlier lane-1 record for this item
at `.lane/reports/0509-lane1-search-submit-settle-already-resolved.md`).

## Evidence on current main

- **The fix**: PR #559 "fix(search): anonymous submit stays on Searching…
  while the cold-path search resolves". The first anonymous query for an
  uncached advertiser returns the typed warming state immediately while the
  browser capture finishes in the background (waitUntil). The request had
  settled — navigation idle, URL committed — so the See ads submit flipped
  straight back to an enabled CTA next to the in-progress line. The fix keeps
  the submit on "Searching…" (pending, aria-busy, disabled) while the
  committed page is warming with no results rendered, and only leaves it when
  results or an error land.
- **Where**: `app/routes/search.tsx` — `commandNavigationPending` includes
  the committed warming state (`isSearchWarming` with zero visible ads inside
  the 5s × 12 = 60s poll budget), and the `SubmitButton` renders
  `pendingLabel="Searching…"` from it. The code carries the explicit
  `COLD-PATH (0509 lane 1)` comment at the `commandNavigationPending`
  definition.
- **Budget/escape**: the pending state shares the warming poll's 60s budget —
  a background capture that never lands re-enables the button instead of
  leaving it disabled forever (`warmingPollExhausted`, `SEARCH_WARMING_POLL_LIMIT`).
- **Later hardening on main** (all ancestors of HEAD):
  - PR #579 (`1d00f084`, 2026-08-11) — honest anonymous form error/status states.
  - PR #612 (`90cea3a5`, 2026-08-11) — honest end state when the anonymous
    check outlives the 60s warming cap.
  - PR #659 (`afc1e687`, 2026-08-13) — lifted /search over the 250-word
    content floor and extended `tests/search-submission-settle.test.tsx`.
  - PR #693 (`99a6d2e2`) — labeled 429 with Retry-After for anonymous
    rate-limited searches.

## Regression pins

`tests/search-submission-settle.test.tsx` and `tests/search-warming-state.test.ts`
pin exactly this item:

- "keeps See ads pending after the cold-path request settles while the
  committed page is warming" — the request settles (navigation idle, URL
  committed) but the committed page is warming with no results; the submit
  keeps `Searching…`, `aria-busy="true"`, `disabled`.
- "leaves Searching… when the warming poll lands results on the committed
  page" — the submit leaves "Searching…" only when results actually land.
- "never leaves the submit disabled when a warming search does not resolve" —
  the 60s budget caps the pending state.
- "shows an honest end state when the warming check outlives the poll budget
  and re-arms it on retry".
- "shows the recovery reload after 90 seconds on an uncommitted idle page,
  enables submit, and clears when navigation settles" — the long-horizon
  escape hatch (`SEARCH_NAVIGATION_SETTLE_GRACE_MS = 90_000`).
- `tests/search-warming-state.test.ts` — "renders one honest live status with
  an explicit retry instead of a contradictory terminal answer" asserts the
  submit stays on `Searching…` / `aria-busy="true"` while warming.

## Verification run (this lane, on fresh origin/main `422fbd55`)

```
$ env -u NODE_ENV npx vitest run tests/search-submission-settle.test.tsx tests/search-warming-state.test.ts

 Test Files  2 passed (2)
      Tests  17 passed (17)
```

Both files pass 17/17 on this tip, including the exact item pin above.
(`env -u NODE_ENV` is required in this login shell because a
production `NODE_ENV` makes `react` load its production build without an
`act` export — a pre-existing repo-wide test-environment gotcha, not a code
regression; CI runs the same files green.)

## Files

- `.lane/reports/report-0509-lane1-anonymous-search-submit-settle-20260821.md`
  — this evidence record (the only file touched by this lane; no product code).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
