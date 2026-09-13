# Lane evidence — claim/issue-3254 (Nishfleet/0509#3254)

Threads keyword-search presence connector, gated behind `PRESENCE_THREADS_ROLLOUT`
+ `THREADS_ACCESS_TOKEN` and Meta app review. Ships dark; activation is a rollout
decision, not a code change.

## Files

- NEW `app/lib/presence-connectors/threads.server.ts` — `id: "threads"`,
  `supportedModes: ["self","competitor"]`, `GET graph.threads.net/v1.0/keyword_search`,
  2,200 queries/principal/rolling-24h cap enforced in connector logic via
  `presence_poll_cursor.cursor_json.threadsUsage` (summed across all threads
  targets — the env-held token is one Meta principal).
- NEW `migrations/0099_widen_source_target_connector_threads.sql` — expand-only
  CHECK widen via the 0093 table-rebuild pattern; child rows
  (presence_item/presence_poll_cursor/presence_item_revision) snapshotted and
  restored; `gdelt` included in the CHECK list for merge-order safety vs #3284.
- NEW `tests/integration/threads-mention-connector.integration.test.ts` — 22
  tests on real workerd/D1.
- MOD `app/lib/env.server.ts` — `PRESENCE_THREADS_ROLLOUT`, `THREADS_ACCESS_TOKEN`.
- MOD `app/lib/presence-types.ts` — `threads` in connector + source id unions.
- MOD `app/lib/presence-access-gates.server.ts` — rollout case, credential case
  (`THREADS_ACCESS_TOKEN`), customer poll path.
- MOD `app/lib/presence-connector-registry.server.ts` — registration, poll
  dispatch, `OFFICIAL_PUBLIC_API` coverage label.
- MOD `app/lib/presence-source-coverage.server.ts` — label, connector mapping,
  social-source set, docs entry with `productionStatus: "gated"`.
- MOD `tests/presence-source-coverage.test.ts`,
  `tests/customer-claim-surface-registry.test.ts` — drift pins.

## Verification

- `npx vitest run tests/integration/threads-mention-connector.integration.test.ts`
  → 22/22 pass (deterministic termination command).
- `npx vitest run --project node tests/presence-source-coverage.test.ts
  tests/customer-claim-surface-registry.test.ts` → 35/35 pass.
- `npx vitest run --project node --changed origin/main` → 4641/4641 pass across
  371 files (re-ran 2026-09-13 after landing on the 2026-09-13 main — the
  launch-readiness failures noted in the first bank failed to reproduce; those
  were fixed on main by later merges).
- workers project (real workerd D1, full integration floor):
  `npx vitest run --configLoader runner --project workers` → 434/434 pass
  across 77 files, including the bluesky and gdelt mention connectors.
- verify-0509 harness: `npm run e2e:serve:local` applied 0099 ✅ via real
  wrangler migration path; `/api/health` 200, `/api/health/deep` `d1:"ok"`,
  `/` 200, `/brands` 200. Server killed by process group; port 4179 free.

## Bluesky CHECK heal (this run, amended commit)

The 0098 pair applies alphabetically (bluesky, then gdelt), so 0098_gdelt
rebuilt the CHECK WITHOUT 'bluesky' — the chain-final CHECK accepted gdelt
but not bluesky. The bluesky test only passes its write assertion by
re-applying its own migration in-test, masking that. The remote-restore
planner (tests/d1-remote-restore-evidence.test.ts catch-up case) plans 0099
AFTER 0098_bluesky, where the live CHECK carries bluesky but not gdelt.
0099 now carries BOTH sibling values (gdelt + bluesky + threads), making it
order-proof; the integration test seeds a pre-rebuild bluesky row and proves
it survives the re-applied rebuild.

## Notes

- `THREADS_ACCESS_TOKEN` is env-held (issue advisory allows it); no
  `source_connection` CHECK widen needed.
- Meta cap semantics honored: queries returning zero results do not count;
  cap counted per rolling-24h window anchored at first counted query.
- Migration number 0099 chosen because 0097/0098 are claimed by open PRs.
- Continuation record: the 2026-09-12 success/0 run banked
  `wip/pi-issue-0509-3254-20260912T130533Z` @ 45ebacf7e and is superseded by
  this branch (single commit rebased onto 2026-09-13 main, b1e76ca06); the
  banked wip branch is left in place untouched.
- Round-2 rebase onto origin/main b1e76ca06 (#3341/#3342/#3343/#3345 landed);
  auto-merge kept both the threads and x registrations; full workers + node
  suites re-proven after the rebase.

## Round 3 (2026-09-13, unit pi-issue-0509-3254 — final, PR round)

Base moved again: `origin/claim/issue-3254` had been reset by the claim-release
heartbeat to `origin/main` `ccca0c1cc...` — precisely, `ccca0c94e` (#3135, which
carries the #3348 revert of #3345). The round-2 head (b1e76ca06 parent, one
unpushed local commit) still carried the #3344 creatives that #3348 reverted,
so the pre-rebase diff vs main dragged 10 unrelated files. Single-commit
rebase onto `ccca0c94e` resolved clean; the PR diff is exactly the 13 feature
files (+1317/−8). The wip salvage branch (`45ebacf7e`, base predating the
revert) stays untouched; this branch supersedes it (its two fix commits —
presence-display copy, d1-restore fixture — are already inside this head).

Re-proof, all fresh on `ccca0c94e` + the feature commit:

- Termination: `npx vitest run tests/integration/threads-mention-connector.integration.test.ts`
  → 22/22, exit 0 (proven twice: before and after the fixed-date fix below).
- `npx vitest run --configLoader runner --project node --changed origin/main`
  → 4641/4641 across 371 files, exit 0 (121s, one suite at a time;
  VITEST_MAX_WORKERS=2 / PLAYWRIGHT_WORKERS=1 respected, no --maxWorkers
  override, CI owns typecheck/coverage — none run locally).
- Targeted integration (migration-adjacent + registry/coverage-adjacent):
  gdelt, bluesky, email-delivery-canary, mention-source-activation,
  presence-poll-targets, mention-digest-resweep, presence-migration-0093,
  rss-connector, x-mention-search → 9 files / 92 tests, exit 0.
- Targeted node: no-time-bomb-fixtures + d1-migration-sync-check +
  email-delivery-canary.server + d1-remote-restore-evidence → 1 failure found
  and FIXED in the same session: the no-time-bomb gate wants a `// fixed-date:`
  comment adjacent to EVERY ISO literal; the fixture had 3 literals and 1
  marker 5 lines away from its second. 3 adjacent markers added
  (captured-payload instants, never compared against the wall clock);
  re-proven: no-time-bomb 1/1, integration 22/22.
- `sgscan --base origin/main` → "No new security findings", exit 0.
- Local crgate: skipped — verified headless: `coderabbit review` →
  "Non-interactive environment detected. Use --api-key for authentication"
  (same documented skip as the #3255 precedent; the PR-level CodeRabbit/CI
  review gates cover this diff).
- Test accounting (gate-integrity, no test-removal): +22 it/test, +98 expect,
  −0 — net positive, no `test-removal-justified` trailer owed.
- No new npm dependency: the 13-file diff touches no package.json/lock
  (`git diff b1e76ca06..ccca0c94e -- package.json package-lock.json` is also
  empty — no dep drift between the rounds' bases).
- `fleet-review-arm-check` (pre-review-step probe): exit 0 — senior seat
  available; reviewer round ran on the diff before PR creation.

Pipeline note: `bin/fleet-review-arm-check` (relative) first failed with 127
(no such file — 0509 worktrees have no `bin/`; the checker is on PATH);
re-run as `fleet-review-arm-check` → exit 0. Named per fleet-ops#1052.

