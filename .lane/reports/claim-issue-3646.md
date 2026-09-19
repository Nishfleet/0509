# claim/issue-3646 — dead-SHA guard for test fixtures (no-time-bomb family)

## What the issue asked

Two deploy-gate fixtures pinned the rewritten-away deploy head d16b1f00 —
an object that survives only on disposable claim/backup branches. Already
fixed on main by #3645 (fixtures now fabricate the shape via commit-tree
from objects every checkout keeps). Remaining ask: check whether any other
fixture names a SHA that lives only on a disposable branch.

## Salvage + rebase onto current main (this run, 2026-09-20)

Prior run's PR #3654 (head 5154da2f) was closed unmerged by the
claim-release path (fleet-ops#6292) and the claim branch was reset to
origin/main. Cherry-picked 5154da2f; two modify/delete conflicts because
main has since removed both annotated files:

- `tests/deploy-production-gate.test.ts` — deleted by b9e241e1f (stock
  deploy pipeline, design A of #3679).
- `tests/dispatch-deploy-production.test.ts` — deleted by 5f57db119
  (13 dead scripts cut).

Resolution: accepted the deletions — the `// dead-sha:` annotations there
are moot once the files are gone. Surviving change set: the detector in
`tests/no-time-bomb-fixtures.test.ts` and the `feb1d460` unquote in
`tests/visual-diff-alert-payloads.test.ts`.

## Re-audit on current main

The guard itself is the audit: it scans every quoted 7–40-hex literal in
`tests/`/`e2e/`, resolves each via `cat-file -e` (existence; `rev-parse
--verify` alone accepts syntactically valid 40-hex without consulting the
object store) and fails on any resolved object unreachable from HEAD
unless the line carries `// dead-sha: <why>` — same escape convention as
`// fixed-date:`.

On current main the suite is green — the five literals the 2026-09-19
audit found all lived in the two deleted files or were prose (unquoted).

Reviewer round (senior seat) returned no BLOCKING findings; two Consider
items landed in the guard: `-- dead-sha:` is accepted beside `// dead-sha:`
(parity with the sibling guard's `-- fixed-date:` — a `//` inside a SQL
string is string content, not an annotation), and the escape docstring now
states the exact scope (literal line or the line directly above).

## Verification (this worktree, 2026-09-20)

- `npx vitest run tests/no-time-bomb-fixtures.test.ts --project node` →
  2 passed.
- Bite probe: `tests/dead-sha-probe.test.ts` naming `"d16b1f00"` → guard
  failed, naming file:line and the resolved sha
  (`d16b1f00096d5a29db9f6ba51b32bc49db45824b`, an object HEAD does not
  keep). Probe deleted; suite green again.
- Escape probe: `"d16b1f00"` carrying a `-- dead-sha:` annotation inside a
  SQL template line → exempt; probe deleted.
