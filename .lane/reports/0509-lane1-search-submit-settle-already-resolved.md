# Anonymous search submit leaving "Searching…" after the request settles — already resolved

**Status: already resolved; this lane records the evidence only.**

Branch: `lane1/search-submit-settle-already-resolved`
Base: `origin/main` at `2b91842b` (#729)

## Item

- [ ] Make the anonymous search submit leave “Searching…” after the request
  settles [research-desk 2026-08-09 01:27 IST].

## Verdict

No code change was warranted. The item is already landed on `origin/main` as
PR #559 (`90147b9b`, merged 2026-08-09 — the scout's own flag date) and has
been continuously maintained by later merged fixes. Verified with
`git merge-base --is-ancestor 90147b9b HEAD`.

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
  the 5s × 12 = 60s poll budget), and the `SubmitButton` renders `pendingLabel="Searching…"`
  from it. The code carries the explicit `COLD-PATH (0509 lane 1)` comment.
- **Budget/escape**: the pending state shares the warming poll's 60s budget —
  a background capture that never lands re-enables the button instead of
  leaving it disabled forever (see `warmingPollExhausted` and the "never
  leaves the submit disabled" test).
- **Later hardening on main** (all ancestors of HEAD):
  - PR #579 (`1d00f084`, 2026-08-11) — honest anonymous form error/status
    states.
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
- "never leaves the submit disabled when a warming search does not resolve"
  — the 60s budget caps the pending state.
- "shows an honest end state when the warming check outlives the poll budget
  and re-arms it on retry".
- "shows the recovery reload after 90 seconds on an uncommitted idle page,
  enables submit, and clears when navigation settles" — the long-horizon
  escape hatch (`SEARCH_NAVIGATION_SETTLE_GRACE_MS = 90_000`).

## Verification run (this lane)

On current main in this worktree (no product changes; evidence branch only):

```
$ npx vitest run --configLoader runner tests/search-submission-settle.test.tsx tests/search-warming-state.test.ts
```

The six static-markup settle tests pass, including the exact item pin
("keeps See ads pending after the cold-path request settles while the
committed page is warming"). The remaining tests in these files fail in this
worktree with `TypeError: act is not a function` — a broken/partial `react`
19.2.8 install (missing the `.` subpath export map, no `act` export, no
`__SECRET_INTERNALS`, no `react-dom` client entry) that fails every
mount-based test repo-wide, pre-existing and unrelated to this lane. The same
test files pass in CI; the settle logic has not changed since PR #559 beyond
later merged hardening (PRs #579, #612, #659, #693), and its tests were
extended and merged through PR #659 on 2026-08-13 with green CI.

## Files

- `.lane/reports/0509-lane1-search-submit-settle-already-resolved.md` — this
  evidence record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
