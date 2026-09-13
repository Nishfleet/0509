# Lane evidence — claim/issue-3370 (Nishfleet/0509#3370)

## Task

vitest 4.1.11 dropped the built-in `basic` reporter: any issue
verify/termination line written as `npx vitest run <file> --reporter=basic`
fails its own command (Startup Error: Failed to load custom Reporter from
basic) before a single test runs. Acceptance: (1) decide the convention,
deletion-first; (2) sweep the two open issues still carrying the flag
(#2873, #3302) so their written commands actually pass; (3) if the
scout/packet generator stamps the flag, fix it at the source.

## State found (2026-09-13, this worktree @ 63b49c1f7, claim/issue-3370)

- This unit's first incarnation (claim 14:54:28Z, released 15:48:33Z, no
  commits, no comments) got the issue-text sweep done before dying: #2873 and
  #3302 updatedAt 2026-09-13T15:09:13/14Z — one second apart, inside this
  unit's claim window, exactly this issue's sweep. Inferred from updatedAt
  plus the #2873 2026-09-11T09:10Z verification comment that THEN described
  the snippet as still carrying the flag; not directly observed.
- Both bodies TODAY: 0 occurrences of `--reporter=basic` (grep -c on the
  fetched bodies: #2873=0, #3302=0). #3302 was closed by PR #3365's merge
  (93aa1ceba), so only #2873 remains open.
- #2873's 09-11 verification comment already documents the known failure and
  recommends the bare form — the issue text now agrees with it.

## Convention decided (acceptance 1)

(a), deletion-first — issue verify/termination lines run bare
(`npx vitest run <path>`; `--reporter=dot` allowed for a one-line summary).
No vitest-config shim: option (b) would be a mechanism where a convention
suffices, and the issue itself calls (a) fewer mechanisms. Recorded in
AGENTS.md (## Test conventions) — 0509-owned: no repo-sync workflow covers
AGENTS.md (none exists in .github/workflows) and its MD5 differs from the
fleet-ops deploy-clone copy — and enforced by the new detector.

## Generator check (acceptance 3) — the conditional resolves to NO

`rg -F "reporter=basic"`, unpiped exits:
- 0509 tracked+untracked tree (`--hidden`, excl. node_modules/var/lock):
  no match, exit 1.
- fleet-ops deploy clone (read-only): no match, exit 1.
- vault `_system` (read-only): no match, exit 1.

So no tracked generator stamps the flag today; the occurrences were
scout-drafted issue text (#2873, #3302), both swept. The detector keeps the
tracked convention surfaces from regressing.

## Shipped

- `AGENTS.md` — "## Test conventions": the bare-form rule + pointer to the
  guard test. Written so the literal flag appears nowhere in the tracked
  convention surfaces, which is exactly what the guard asserts.
- `tests/vitest-reporter-convention.test.ts` — the detector: AGENTS.md +
  every text file under `.github/` must contain zero `--reporter=basic`.
  docs/** deliberately not scanned (historical records, not the convention).
- `.lane/reports/claim-issue-3370.md` — this record.

## Receipts (2026-09-13, this worktree, vitest 4.1.11, --maxWorkers=2 = VITEST_MAX_WORKERS)

- P1b repro, WITH the flag: `npx vitest run tests/compare-sneakerping.route.test.ts --reporter=basic --maxWorkers=2`
  → exit 1, "Startup Error / Error: Failed to load custom Reporter from
  basic / [cause]: ... Does the file exist?" — the issue's error, verbatim.
  Expected failure (the bug), not a broken run.
- P2 #3302 termination, bare: `npx vitest run tests/compare-sneakerping.route.test.ts --maxWorkers=2`
  → 1 file / 5 tests passed, exit 0.
- P3 #2873 termination, bare: `npx vitest run tests/capture-validity --maxWorkers=2`
  → 5 files / 63 tests passed, exit 0.
- P4 detector + lane guard: see PR body (Verification).
- P5 affected-tests, blessed form, post-commit: see PR body (Verification).

## Loose ends

- #2873 stays OPEN (blocked-on: orchestrator) — this unit only fixed its
  verify/termination lines; the issue's own scope was already satisfied on
  main per its 09-11 verification comment.
- The stalled repo-sync PR #3351 (repo-sync/fleet-ops/default) is unrelated
  and untouched.
