# Lane evidence collisions on `.lane/report.md` (0509 lane 2, 2026-08-21)

Branch: `0509-lane2-lane-evidence-collision-guard`
Pull request: https://github.com/Nishfleet/0509/pull/835

## Item

- [x] Stop lane evidence records from colliding on one tracked file: 25 of 61
  open PRs edit `.lane/report.md`.

## Diagnosis

`.lane/report.md` was a single tracked file holding 14 lane records appended by
different lanes over time. Any two lanes appending to it produce overlapping
diffs at the end of the same file, so their PRs conflict pairwise. Nothing in
the repo prevented the next lane from doing it again.

## Change

1. Split the 14 records out of `.lane/report.md` verbatim into
   `.lane/reports/archived-shared-report-NN-<slug>.md` and deleted the shared
   path, so the collision target no longer exists on main.
2. Added `tests/lane-evidence-collision.test.ts` (runs in CI through
   `npm run test`), which fails when:
   - any shared evidence path is present in the tree
     (`.lane/report.md`, `.lane/reports/report.md`, `report.md`,
     `docs/status.md`, and similar), or
   - a `.lane/reports/` record is nested, non-markdown, or generically named.
3. Documented the lane evidence rule in `AGENTS.md`, including that some clones
   exclude `.lane/` via `.git/info/exclude` so `git add -f` may be required.

## Verification

- `vitest run tests/lane-evidence-collision.test.ts` → `Tests 2 passed (2)`.
- Negative case: re-adding `.lane/report.md` (`git add -f`) makes the guard fail
  with `expected [ '.lane/report.md' ] to deeply equal []`; removing it restores
  green.
- Content preserved: `cat .lane/reports/archived-shared-report-*.md | grep -c '^# '`
  → `14`, matching the 14 record headings in the deleted file.

## Files

- `.lane/report.md` (deleted)
- `.lane/reports/archived-shared-report-01..14-*.md` (added, verbatim records)
- `tests/lane-evidence-collision.test.ts` (added)
- `AGENTS.md` (lane evidence rule)
