# Lane evidence — issue-2507 (Nishfleet/0509#2507)

## Task

CI twin of #2506: a pre-merge detector that fails any PR whose newly added
migration does not sort last. #2506's duplicate `0088_*` took every production
deploy down and `allowedProductionMigrationLedgers` only fires after merge, in
the deploy. Difficulty: light (flat run — no manager loop).

## Salvage adjudication (this unit resumed banked work)

Two prior unit deaths each committed the same fix; both were banked by
fleet-salvage:

- `origin/issue-2507` @ `d1c802ac2` — based on main @ `edacd4aaf` (older).
- this worktree, branch `issue-2507` @ `ac483be64` — based on main @
  `5c32a83c4` (current origin/main, verified: `git merge-base --is-ancestor
  5c32a83c4 origin/main` → ancestor; zero upstream drift on the 3 touched
  files).

Adopted the newer-based line. Verified the three issue files are
byte-identical across both salvage tips (`md5sum` of `git show <tip>:<file>`
for `scripts/check-migration-numbering.mjs`, `tests/check-migration-numbering.test.ts`,
`.github/workflows/ci.yml` — all IDENTICAL), so nothing from the discarded
line needs grafting.

## Shipped (3 files, +282)

- `scripts/check-migration-numbering.mjs` — for every migration ADDED in the
  PR (`git diff --name-only --diff-filter=A <merge-base>...HEAD -- migrations/`),
  its 4-digit prefix must be strictly greater than the highest 4-digit prefix
  on the base. Global uniqueness NOT enforced (the 8 historical duplicate
  numbers 0010/0014/0017/0018/0028/0067/0087/0088 keep passing); two migrations
  added in the SAME PR sharing a prefix still fail (the #2506 incident, one
  release earlier). Fails closed: unresolvable base ref = exit 1, never a
  silent pass.
- `.github/workflows/ci.yml` — one step (`node scripts/check-migration-numbering.mjs`)
  inside the existing required `codex-node-checks` job, after Install
  dependencies, before Build. No new workflow file — accept 2.
- `tests/check-migration-numbering.test.ts` — 7 cases in a real temp git repo
  each: no-migrations-PR passes; added-migration-above-top passes;
  duplicate-of-top fails naming the file + required minimum;
  below-top fails; historical base duplicates do not trip it;
  same-PR duplicate prefix fails; unresolvable base fails closed.
  Runs in the existing vitest node shard of the SAME PR-checks job — accept 1.

## Receipts (2026-09-13, this worktree @ the tip recorded in the PR body)

- Targeted: `npx vitest run --configLoader runner --project node
  tests/check-migration-numbering.test.ts --reporter=dot` → 7/7 passed
  (716ms).
- Affected suite (`npx vitest run --configLoader runner --project node
  --changed origin/main`, VITEST_MAX_WORKERS=2): 1 file / 7 tests, all passed
  — the diff adds only the self-contained new test (the affected-tests
  dep-graph pulls in exactly it).
- Termination, as written in the issue: `node
  scripts/check-migration-numbering.mjs` on this branch → exit 0
  (`migration_numbering_ok: 0 added migration(s) ... base top 99`). Then
  `migrations/0001_dupe.sql` added + committed → exit 1 naming
  `migrations/0001_dupe.sql`, `its number: 1`, `required minimum: 100 (highest
  on origin/main is 99)`. Working tree reset back to `ac483be64` afterwards
  (verified: `git rev-parse --short=9 HEAD` → `ac483be64`, clean).
  The metric bullet (a PR adding `migrations/0001_dupe.sql` is blocked by CI)
  is exactly this exit-1, now wired as a required-context CI step.
- No migrations/ diff of my own, so the `--project workers` integration suite
  is not triggered (per the memory-budget rule: only when `migrations/**` or
  `tests/integration/**` changed).
- `sgscan --base origin/main` → recorded in the PR body (run at the final
  head, after this report was committed).
- `crgate` → recorded in the PR body (same).

## Gate handoff (fleet-ops#5870)

This diff touches `.github/workflows/ci.yml` — a gate-owned path. Per
gate-integrity.sh, a gate-path change needs a repository-admin
`gate-integrity-attest: <head sha>` comment; this unit therefore posts
`attest-requested: <head sha>` and stops WITHOUT arming (the #3316 precedent:
orchestrator attests, orchestrator merges). No `gate-integrity-attest:` /
`verifier-attest:` comment was posted by this worker, per the hard rule.

## Session notes (failed commands, named)

- `gh pr list --sort -mergedAt` → `unknown flag: --sort` — this box's gh has
  no `--sort`; exited 2 (flagged, not a no-match probe).
- `bash "$FO/lib/seat-lib.sh"` → `No such file or directory` — the packet's
  `lib/seat-lib.sh` name has drifted; the routing authority is
  `lib/litellm-seat.sh` (fleet-ops#4263 retired pick_seat; `find_senior_seat`
  lives there and prints `litellm<TAB>senior`). Also ENOENT in the
  fleet-ops-deploy-clone checkout.
- home-wide `find` for seat-lib.sh → `SPAWN_BLOCKED reason=
  home_wide_filesystem_sweep` (the depth-1 fleet spawn guard; expected).
- Reviewer seat: `find_senior_seat` → `litellm<TAB>senior` (proxy ready), but
  the stock reviewer agent pins `nebius/zai-org/GLM-5.3-Flash` in its
  frontmatter — the extension's only seat lever — which is NOT the worker's
  seat (`litellm/worker-cheap`). That matches the completed precedent on
  #3360 ("senior seat nebius/zai-org/GLM-5.3-Flash via find_senior_seat — the
  senior ladder is currently exhausted/walled"). No harness file edited.

## Loose ends

- The orchestrator must post `gate-integrity-attest: <final head sha>` (the
  check is red until then — the gate's own remedy text) and is the
  merge authority for this PR; this unit deliberately does not arm (see the PR
  body's attest-requested note).
- #2506 (the fix itself: renumber `0088_org_scoped_ownership` → `0089`) is
  still OPEN; this detector is its guardrail, not its replacement.

## Re-entry 2026-09-14 (unit pi-issue-0509-2507, claim re-held)

The PR's 2026-09-13T21:21Z CI round hit a transient red main: main's
`tests/status.route.test.ts` carried unpinned absolute literals + wall-clock
reads between the merge base and the 22:38Z fix (no-time-bomb window), so
`codex-node-checks-shard-4` failed on the PR's merge commit through no fault of
this diff. Proof: the flagged test passes at merge base `522c79d4c` (local run,
1/1) and at current main `65776e216` (local run, 1/1); this branch's files
contain no ISO literals or `Date.now()`/`new Date()` reads.

Action: rebased the single commit onto current origin/main `65776e216` (green),
re-verified at the new head, force-pushed `claim/issue-2507`. The earlier
`attest-requested: ac107ee1e…` is stale (sha-bound); the fresh PR comment
carries the new head's `attest-requested:`. Both admin attests
(`gate-integrity-attest`, `verifier-attest`) remain the orchestrator's job; the
unit still does not arm.

- `gh run rerun` was considered and rejected: GitHub's re-run merge-commit
  semantics for a moved base are not documented tightly enough to bet the
  round-trip on; a rebase gives a deterministic fresh run against green main.
