# Lane evidence — claim/issue-1947 (issue #1947, unit pi-issue-0509-1947)

Issue: gate-integrity false-positives on lockfile-only Dependabot PRs — 3 security bumps blocked, 0 mergeable PRs in repo.
Worktree: /home/nish/workspaces/agent-worktrees/issue-0509-1947 (branch claim/issue-1947, base = origin/main f026d4248).

## What the evidence showed (2026-09-13)

- The issue's 2026-09-08 failures (#1579 #1543 #1589, "11 of 12 fail gate-integrity") were judged by main @ b064909d4 (2026-09-07 23:21Z). Root cause of THAT wave: the context-build step's jq `--arg/--argjson` E2BIG crash — 0509#2516, fixed on main 2026-09-10 (310fa5c70, "read candidate context from files, not argv"). Not the content scan.
- Today's live truth: #1579 MERGED (2026-09-11T17:25:32Z), #1543 CLOSED unmerged, #1589 OPEN with `gate-integrity: SUCCESS` in its statusCheckRollup (blocked today by codex-node-checks FAILURE + preview-assert FAILURE — different checks, outside this issue).
- The CONTENT scan still reads lockfile bytes on today's main. Proven false positive, reproduced locally: `|| true` inside pnpm-lock.yaml FAILS the gate-weakening scan ("CI step softened in pnpm-lock.yaml: || true", rc=1) because CI_SOFTENER scans every .yml/.yaml. #1579's exact 3-line package-lock.json bump passes on today's main (no rule happens to fire) — the exclusion makes the whole class structurally immune so it stays that way.

## What shipped

- `.github/scripts/gate-integrity.sh`: LOCKFILE_PATH (package-lock.json | pnpm-lock.yaml | yarn.lock) exempt from the CONTENT scan only; filename-level test/gate checks unchanged. Narrowing, not relaxation; no attest bypass; no other path relaxed.
- `.github/scripts/test-gate-integrity.sh`: 5 fixtures — #1579's exact 3-line diff (PASS), the #1589 skip-shaped lockfile text (PASS), the pnpm `|| true` fails-before/passes-after pin (PASS), plus two negative controls: a test renamed to a lockfile name (must FAIL: "test file renamed out of the suite: tests/auth.test.ts -> package-lock.json") and a bare `it.skip(` with no `test-removal-justified:` trailer (must FAIL: "test disabled in tests/auth.test.ts").

## Run proof (real commands, this worktree, 2026-09-13)

BEFORE (origin/main's gate-integrity.sh + the 5 new fixtures): `83 passed, 1 failed` — the one failure exactly `lockfile_pnpm_ci_softener` (expected PASS, got rc=1). Direct: `bash <main's gate-integrity.sh> <pnpm fixture bundle>` → "FAIL: this pull request weakens a quality gate without the required justification / - CI step softened in pnpm-lock.yaml: || true", rc=1.

AFTER (fixed script, FULL suite incl. all pre-existing fixtures): `84 passed, 0 failed`, exit 0.

Real Dependabot bundles rebuilt via the workflow's own jq recipe (files patched to +/- lines, commits, comments, head_sha, gate_globs): #1579, #1543, #1589 → PASS on the fixed script (and on main's — documented honestly in the PR body).

sgscan: "No new security findings", exit 0. No vitest run: no node_modules in this worktree and the diff touches no .ts test file (vitest --changed origin/main selects nothing); the affected suite is the fixture regression, 84/0. CI owns typecheck/coverage (memory budget, fleet-ops#4891).

Prior attempt: local-only commit ac584de37 (2026-09-11, never pushed, based on pre-#3354 main) — re-applied by hand onto current main, comment adapted to the ratchet clause that landed meanwhile.
