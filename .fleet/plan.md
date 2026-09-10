# Plan — Nishfleet/0509 #2199 (Hiring / job-board signals)

Manager mode (difficulty: heavy). Manager plans, delegates, reviews, ships.
Worker implements each phase extremely well. Base: worktree
`issue-0509-2199-fresh`, branch `claim/issue-2199`, reset onto current
origin/main (`1e31d643`, 2026-09-10) after seam #2218 (merged) and #2610 landed.
Stub `hiringAdapter` + `HiringSection` present and registered by seam #2218.

## Manager log
- 2026-09-10: prior run's uncommitted work (phases 2-5 code, fixtures) salvaged
  from the abandoned `issue-0509-2199-fresh` worktree and replayed onto today's
  origin/main. Branch had zero commits; nothing lost.
- Manager decision (binding, judge batch-2 edit: "diff() returns one grouped
  SourceChange per check"): phase 5 emits exactly ONE `SourceChange` per check
  when N>=1 opened or M>=5 closed, `metadata.kind = "role_change"` carrying
  both `opened` and `closed` (+ per-side top departments/locations). The
  Section parser reads that one shape. NOT two changes.
- Manager decision: `parseBoardUrl` is exported from `hiring.tsx` so the manual
  override parsing is unit-tested, and the override posts to the seam's
  `update-source-field` action on `/app/watchlists/<id>` (seam-owned route).
- Manager decision: worker runs targeted
  `npx vitest run --configLoader runner --project node <files>` only. No
  `npm run typecheck` / `tsc -b` / coverage inside the worker (CI owns those;
  MemoryMax=4G budget rule).
- Salvage defect found by manager: `hiring.tsx` called `submitBoard(...)` while
  the helper is `submitBoardOverride` — the file did not compile. Fixed in
  phase 6.

## Goal
Watch Greenhouse / Ashby / Lever public job feeds per tracked competitor, alert
on new roles since the last weekly check, on the seam's generic source path
(#2218) following the parallel tiktok-ads pattern (#2194).

## Phases / acceptance bullets (one line each)
- [x] phase 1: confirm seam state (hiring stub, run.server generic path+competitorUpdate, migration 0088 job_board_* + source_snapshot, seam update-source-field action, source-sections/competitor-detail wiring) and reproduce the tiktok-ads pattern (thin adapter shell + submodule + Section) for hiring
- [x] phase 2: slug-discovery module — fetch homepage + one linked careers page (20s, one attempt), scan HTML for Greenhouse/Ashby/Lever board URLs; else registrable-domain label check Greenhouse→Ashby→Lever keeping first 200; label-guessed → verified:false + 'unconfirmed board'; HTML-discovered + manual → verified:true
- [x] phase 3: fetchJobs(board) — build URL from provider+slug, ONE attempt, 20s AbortController, normalize [{id,title,location,department,url,postedAt}] or {unavailable,reason}; no content=true
- [x] phase 4: weekly snapshot — reuse 7-day per-competitor gate (no new schedule), snapshot role list, competitorUpdate {job_board_provider, job_board_slug, job_board_verified} returned from fetch, discoveredAt in payload; baseline never alerts; unavailable never blocks
- [x] phase 5: diff — new ids → role_opened, missing ids → role_closed, ONE grouped SourceChange per check under N>=1 new / M>=5 closed; counts by department+location
- [x] phase 6: adapter wiring (implemented:true, weekly) + HiringSection (total open roles, opened/closed since last check, top-3 depts+locations, public-board link, "No public job board detected" + manual field RENDERING) + tests all green
  - [x] 6a code correctness: fix the `submitBoard` compile break; collapse phase-5 diff to ONE grouped `role_change` change; Section reads it; export `parseBoardUrl`
  - [x] 6b tests: `tests/sources/job-board-discovery.test.ts` (HTML scan, careers link, domain-label probe order/200, 404, one-attempt timeout)
  - [x] 6c tests: `tests/sources/hiring-signals.test.ts` (three provider fixtures, normalization, 404 -> not_found, no `content=true`, single attempt)
  - [x] 6d tests: `tests/sources/hiring-snapshot.test.ts` (7-day gate, no-board snapshot, unconfirmed board never alerts, baseline never alerts, opened/closed diff + one grouped change, grouping by dept/location)
  - [x] 6e tests: `tests/sources/hiring-section.render.test.tsx` (board view, unconfirmed label, no-board + manual field, null when no snapshot)

## Files owned (edit ONLY these)
- app/lib/sources/hiring.server.ts (REPLACE stub — thin wiring shell only)
- app/lib/sources/hiring/hiring-signals.server.ts (NEW — provider URL builders + fetchJobs + normalizers)
- app/lib/sources/hiring/job-board-discovery.server.ts (NEW — HTML scan + registrable-domain label fallback)
- app/lib/sources/hiring/hiring-snapshot.server.ts (NEW: weekly gate, competitorUpdate, snapshot-store, diff)
- app/components/sources/hiring.tsx (REPLACE stub section incl. manual field/form)
- tests/sources/hiring-snapshot.test.ts (NEW)
- tests/sources/hiring-signals.test.ts (NEW)
- tests/sources/job-board-discovery.test.ts (NEW)
- tests/fixtures/job-boards/** (NEW: greenhouse.html, ashby/lever feed, careers.html, 404 body)

## Do NOT edit (seam owns)
registry.server.ts, run.server.ts, types.ts, env.server.ts, source-sections.tsx,
competitor-detail.tsx, the watchlist route, migrations, the claim table. Consume
run.server exports only. The seam already added the claim-table row and the
competitor page section slot.

## Open decision (resolved by manager)
- Section interface passes only {snapshot, diff} — no competitorId. The manual
  override field renders inside HiringSection and posts to the seam's generic
  update-source-field action; the watchlistId is derived client-side from
  window.location.pathname (competitor-detail page path) for the Form action.
  Do NOT widen types.ts / source-sections props (off-limits).

## Stall rule
No box ticked in 10 min → commit what works + stalled note in this file.
## Phase log
- phase 1 (seam re-check): done by manager on the current origin/main `1e31d643`.
  migration 0088 job_board_* + source_snapshot, run.server generic path +
  competitorUpdate, source-field action, source-sections slot all present.
- phases 2-5 (discovery, fetchJobs, weekly snapshot, diff): salvaged from the
  prior run's worktree and replayed; reviewed by manager against the binding
  judge edits.
- phase 6a: compile break fixed (`submitBoardOverride`), one grouped
  `role_change` SourceChange implemented, Section parser updated, one grouped
  change pinned by tests.
- phase 6b: `tests/sources/job-board-discovery.test.ts` — 39 tests, green.
- phase 6c: `tests/sources/hiring-signals.test.ts` — 33 tests, green.
- phase 6d: `tests/sources/hiring-snapshot.test.ts` — green.
- phase 6e: `tests/sources/hiring-section.render.test.tsx` — green.
- phase 6a-fix: strict-TS sweep of the ticket's own files fixed 5 real
  typecheck errors (`body.value` unknown access x2, `"unavailable" in fetched`
  narrowing x2 that does not narrow an optional discriminant, `WatchlistRow |
  null` widening, `string | null | undefined` widening) plus a real
  `findCareersLink` bug (`return null` in the URL catch aborted the page scan;
  now `continue`, with a regression test).
- Manager run-proof: `npx vitest run --configLoader runner --project node
  tests/sources/hiring-snapshot.test.ts tests/sources/hiring-section.render.test.tsx
  tests/sources/job-board-discovery.test.ts tests/sources/hiring-signals.test.ts`
  -> 4 files passed, 96 tests passed.
- No `stalled:` phases. No phase needed a retry beyond the two fix rounds above.
- phase 6f (senior review round, seat cursor/cursor-grok-4.6-high, one round):
  1 Critical + 8 Warnings. Act-on: unconfirmed (label-guessed) board now
  renders the manual override so it can be confirmed/replaced (the Critical);
  sequential `update-source-field` writes (slug -> provider -> verified last);
  `parseBoardUrl` tolerates listing paths/query/hash; `findCareersLink` matches
  an absolute `/careers` or `/jobs` link whose text does not; discovered slugs
  lowercased; the missing-location bucket renamed from `(remote)` to
  `(not listed)`. Consider/Noted/Dismissed reasons are recorded in the PR body.
  Manager re-ran the four files after the fixes: 102 tests passed.
