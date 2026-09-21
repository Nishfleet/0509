# claim/issue-2507 — migration-numbering pre-merge gate (detector for #2506)

## Change

`tests/check-migration-numbering.test.ts` (new): a newly added migration must
sort LAST. For every `migrations/<NNNN>_*.sql` file added in the diff
(`git diff --name-only --diff-filter=A <merge-base>...HEAD -- migrations/`),
the 4-digit prefix must be strictly greater than the highest prefix present
on the base ref (`git ls-tree` on the merge-base — historical duplicates on
base keep passing by design). Same-PR prefix duplicates are flagged too.
Fails closed when the base ref cannot be resolved. The first `it()` in the
file is the gate itself, run against the real repo (`origin/main`...`HEAD`);
the remaining cases exercise it on synthetic repos (sorts-above pass,
duplicate-top fail, below-top fail, no-migrations pass, historical
duplicates pass, same-PR duplicate fail, unresolvable-base throw).

`.github/workflows/ci.yml`: one step in the existing required
`codex-node-checks` job (after Install dependencies, before Build) running
`npx --no-install vitest run --configLoader runner --project node
tests/check-migration-numbering.test.ts`, so the assertion does not depend
on which vitest shard collects the file (shards 2-4 are not required
contexts — only `codex-node-checks` is).

## Spec deviation (and why)

Issue #2507 (written 2026-09-10) asks for `scripts/check-migration-numbering.mjs`
plus a workflow step invoking it. Since then `scripts/` was deleted repo-wide
and the fleet no-new-scripts rule (fleet-ops worker.md, 2026-09-19) bans new
`*.mjs` helpers. The checker's logic therefore lives in the test file itself
— "logic that needs tests is a test under tests/" — and the workflow step
calls vitest directly, mirroring `tests/d1-budget-check.test.ts` +
`tests/helpers/d1-budget-check.mjs` (gate-as-test convention already in the
required job). Same rule semantics, same required-check visibility, no
scripts/ resurrection.

## Verification

- `npx vitest run --configLoader runner --project node tests/check-migration-numbering.test.ts` — 8/8 pass
- Negative probe on the real repo: committed `migrations/0001_dupe.sql`, gate
  failed naming `offending file: migrations/0001_dupe.sql`, `required
  minimum: 108 (highest on base is 107)`; probe commit then reset.
- `git diff --check origin/main...HEAD` — clean
- `semgrep --config p/default --baseline-commit "$(git merge-base HEAD origin/main)"` — see PR body
- Reviewer round (senior seat): see PR body

## Prior history

Salvaged from `wip/pi-issue-0509-2507-20260913T120348Z` (commits 7e73c34a +
d1c802ac, branch since pruned). The 2026-09-17 pi-worker run parked
`blocked-on: orchestrator` because the spec then required pushing a
`scripts/` + workflow change its App token could not publish (no Workflows
permission); Nish's 2026-09-18 decision requeued the packet for a
workflow-capable publisher. The test-file shape above also fixes the two
review findings carried from #3411: shared mutable scratch repo (each test
now builds its own via `setupRepo`) and unchecked `spawnSync` git calls
(`execFileSync` throws on failure; `isolatedGitEnv` strips caller `GIT_*`).
