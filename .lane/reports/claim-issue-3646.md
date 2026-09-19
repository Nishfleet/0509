# claim/issue-3646 — dead-SHA guard for test fixtures (no-time-bomb family)

## What the issue asked

Two deploy-gate fixtures pinned the rewritten-away deploy head d16b1f00 —
an object that survives only on disposable claim/backup branches. Already
fixed on main by #3645 (fixtures now fabricate the shape via commit-tree
from objects every checkout keeps). Remaining ask: check whether any other
fixture names a SHA that lives only on a disposable branch.

## Audit (this clone, 2026-09-19)

Scanned every quoted 7–40-hex literal in `tests/` and `e2e/`, resolved each
with `git cat-file -e` (existence + unambiguity) and checked reachability
against `git rev-list --objects HEAD`. Five literals resolve to objects HEAD
does not keep; all five are benign opaque strings, none is a live bomb:

- `tests/dispatch-deploy-production.test.ts` — `realSha` /
  `otherRealSha` / `"389c0e5"` are format-test inputs to
  `is_valid_candidate_sha`, which regex-checks shape only and never touches
  the object store.
- `tests/deploy-production-gate.test.ts:507` — `releaseControlBaseSha`
  constant from `scripts/deploy-production-plan.mjs`, compared by string
  equality as a recorded provenance value.
- `tests/visual-diff-alert-payloads.test.ts` — `feb1d460` inside a doc
  comment naming the PR #715 commit (prose, not a fixture).

## Fix shipped

A sibling check in `tests/no-time-bomb-fixtures.test.ts` (the family the
issue names): any quoted hex literal in `tests/`/`e2e/` that resolves to a
git object not reachable from HEAD fails the suite unless the line carries
`// dead-sha: <why>` — same escape-hatch convention as `// fixed-date:`.

Existence is probed with `cat-file -e` first because
`rev-parse --verify --quiet` accepts syntactically valid 40-hex names
without consulting the object store — sentinels like `"aaaa…"` would
otherwise "resolve" to themselves and false-positive.

The five audit hits were either annotated (`// dead-sha:` where the string
is genuinely opaque) or unquoted (`feb1d460` doc reference — prose never
needed quotes).

## Verification

- `npx vitest run tests/no-time-bomb-fixtures.test.ts` → 2 passed; with a
  probe fixture naming an unannotated non-ancestor sha → 1 failed naming
  the file:line and the unresolved object (guard bites; probe deleted).
- `npx vitest run tests/dispatch-deploy-production.test.ts
  tests/visual-diff-alert-payloads.test.ts tests/no-time-bomb-fixtures.test.ts`
  → 14 passed.
- `npx vitest run tests/deploy-production-gate.test.ts` → 65 passed.
- `npx vitest run --configLoader runner --project node --changed origin/main`
  → 4 files, 79 passed.
- `semgrep --config p/default --baseline-commit $(git merge-base HEAD
  origin/main)` → 0 findings.
