# claim/issue-3263 — lane evidence

Unit: pi-issue-0509-3263 (systemd --user). Issue: Nishfleet/0509#3263 (ci: cut hosted jobs per PR).
This record is the run evidence for PR opened from this branch.

## What shipped (single squashed commit, rebased onto 276db8aab; this record amended into it)

Banked work from the 2026-09-12/13 salvage runs of this same unit (3 wip(salvage) commits),
rebased clean onto current origin/main, then squashed. 8 files: 4 workflows + 3 tests + this record.

- `.github/workflows/ci.yml` — `pull_request` trigger path-gated to the dependency surface
  (package.json / package-lock.json / shrinkwrap / Dependabot config). `merge_group` trigger
  stays unfiltered so the required contexts always report on the queue ref. codex-node-checks
  + shards 2-4 carry the release-proof precedent job-level `if:` (merge_group || workflow_dispatch),
  no `needs`, in-step authorizer kept.
- `.github/workflows/content-quality.yml` — Vale paths-gated on all three triggers
  (content/**, **.md, .vale/**, .vale.ini).
- `.github/workflows/preview-assert.yml` — preview-assert job carries the same pinned `if:`.
- `.github/workflows/semgrep-actionlint.yml` — the semgrep job detects .github/** touches via the
  PR files API (fail-open) and the actionlint job skips when there are none. Semgrep itself still
  runs on every PR. No second detector job, no new check run.
- `tests/required-context-no-skip.test.ts` — contract test extended: never-skip vs pinned
  merge-queue shapes, 7 -> 9 it() blocks.
- `tests/preview-assert-workflow.test.ts` — updated to the pinned-if contract, 12 -> 12 it() blocks.
- `tests/semgrep-actionlint-gate.test.ts` — new, 6 it() blocks.
- Required check NAMES unchanged; branch ruleset needs no edit.

## Measurement (the issue's own probe)

- Before: newest merged-PR head 6babfacf1 (#3327, merged 2026-09-13T00:31Z):
  16 check runs, 1x gate-integrity, 3x CodeQL-family contexts (CodeQL, Analyze (actions),
  Analyze (javascript-typescript)). The issue's 19 premise counted arm+classify (not on this head)
  and 2x gate-integrity.
- After, projected: app-only or docs-only head = 16 - 5 (ci.yml not triggered: dependabot + 4 codex
  lanes) - 1 (actionlint skips when .github/** untouched) = 10-11. Termination <= 12 holds.
- CodeQL: default setup (no in-repo workflow; the code-scanning/default-setup read 403s on the
  worker token, the #1253 integration-scope class). No trigger exists to filter; the issue's own
  zero-new-workflows line forbids the advanced-setup switch. Left as-is; termination holds anyway.
- Issue item 2 (merge the two gate-integrity contexts): 1x per PR head measured; twice per CYCLE
  is structural (enqueue gate reads the head context, the ruleset reads the queue-ref context).
  Documented, not merged away.

## Receipt gates (all run in this worktree)

- npx vitest run --configLoader runner --project node (the 10 suites reading the four touched
  workflows): 10 files, 103/103 passed, 0 failed, 4.71s. VITEST_MAX_WORKERS=2 respected.
  No coverage, no typecheck (CI owns both; memory budget rule).
- sgscan vs 276db8aa: "No new security findings.", exit 0.
- tests/lane-evidence-collision.test.ts: run after adding this record.
- fleet-no-agent-names-check --pr-body --commit-range origin/main..HEAD: pass.
- prove-one-run-check: pass (see PR body).
- research-before-build-check: pass (no new bin/ files).
- fleet-token-efficiency-check --name-status: pass.
- fleet-organ-heartbeat-check gate --name-status: "SKIP: no fleet organ touched in the diff",
  exit 0.
- fleet-review-arm-check: exit 0. Reviewer seat resolved via find_senior_seat:
  nebius + zai-org/GLM-5.3-Flash (senior ladder exhausted; fall-through to any capable seat).

## Failed commands this run (flagged, none blocking)

1. gh pr list --sort -mergedAt -> "unknown flag: --sort" (this gh build; #1107's documented
   invocation). Sorted in jq instead.
2. gh api repos/Nishfleet/0509/code_scanning/default_setup -> 404 (underscore; wrong path, mine).
3. gh api repos/Nishfleet/0509/code-scanning/default-setup -> 403 "Resource not accessible by
   integration" (the #1253 integration-scope class; no code-scanning read on the <=1h
   nishfleet-worker App token). CodeQL provenance taken from the check-run names instead.
4. One bash -c paste in the session broke with "syntax error near unexpected token `)'" — nothing
   executed; re-issued.

## Acceptance split (per the recorded 2026-09-12 orchestrator decisions on the issue)

- This PR: Part 1 items 1-2 (premise-measured) + Part 2 item 4. Standard claim -> PR -> attest ->
  auto-merge rail.
- Part 2 item 5 (ruleset PUT, max_entries 5 -> 8): needs Administration:write; the 24h
  batch-size/red-batch baseline completes ~2026-09-13T11:56Z. Orchestrator, after the baseline.
  Not this unit.
- The issue's two probe PRs (app-only, content-only, proving <= 12) read the workflows off their
  BASE, so they only mean something after this PR merges. Post-merge acceptance.
