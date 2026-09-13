# Lane report — claim/issue-3357 (issue #3357)

Unit: pi-issue-0509-3357. Base: origin/main @ 368f761f (rebased; #3388 landed mid-run, no overlap with this diff's files). Head: this commit (the fix + this report amended in). Worker seat: litellm/worker-cheap; the senior round runs on the reviewer-3357 agent, model: litellm/senior (never the worker seat).

## What died before, and what this run resumes

Three earlier runs of this unit banked salvage worktrees (wip/pi-issue-0509-3357-20260913T*); the reconciler reset origin/claim/issue-3357 onto main between them. This run resumed the banked 3-file diff (463 insertions), verified it against the issue's acceptance one bullet at a time, squashed it to one commit, and shipped it. Extended the EXISTING #1958 sitemap-timeline rail (whose cohort is the tracked /ads surface since #2021 widened the candidate source); no new mechanism, no new cron: the +3 in workers/app.ts only adds the #1549 `truncated` cut signal to the existing 04:00 rail's completion log.

## Diff

`app/lib/sitemap-timeline-backfill.server.ts` (+214): an 8-minute internal wall (SITEMAP_TIMELINE_BACKFILL_DEADLINE_MS) stops STARTING new captures and reports `truncated: true`; the cohort is ordered stalest-first from the rail's own `timeline-<domain>-<day>` row ids (loadRecentSitemapTimelineCaptureDays, 7-day lookback, 5000-row read cap, degrade-to-cohort-order when the ledger read fails, so a ledger hiccup can never zero the night). The ledger rows ARE the resume state: no migration, no new table, no flag. `tests/sitemap-timeline-backfill.server.test.ts` (+254: id parsing, staleness ordering incl. the stable-sort tie, ledger read + degrade paths, deadline truncation, stalest-first through the loop). #2873 capture validity untouched (every row still requires a real requireScreenshot capture; the read-side complete-proof gate still suppresses phantom states); #1309/#2021 410/noindex guards untouched (zero route edits).

## Runs (this worktree, VITEST_MAX_WORKERS=2 respected, no --maxWorkers passed, one heavy toolchain at a time)

- `npx vitest run --configLoader runner --project node tests/sitemap-timeline-backfill.server.test.ts` → 35/35.
- `npx vitest run --configLoader runner --project node --changed origin/main` → 8 files / 87 tests, all passed.
- `node scripts/check-ads-timeline-links.mjs` → OK: 158 indexable /ads pages link their /timeline; 9 qualifying /timeline pages; exit 0 (the #1931 sweep, the issue's verify gate).
- `sgscan` → no new security findings, exit 0.
- `crgate` → "CodeRabbit is not signed in on this machine" — the CLI printed usage, no local review ran (headless, no OAuth session; the same named gap as #3383's and #3317's lane records today; the substantive review is the PR's senior round).
- `fleet-review-arm-check` → exit 0 (a senior seat is usable; the round ran before the arm).

## Production

Undeployed as of this run (products are PR-only; production deploys are Nish-gated). The 9→60 sitemap /timeline climb is wall-clock: it needs this rail deployed plus nightly captures, which is the issue's own rollback framing ("snapshots already written are valid history"). The #3095 ops/timeline-coverage-guard canary observes the count daily; the issue's termination curl turns green on its documented observe-to-close, not on merge.

Failed commands this run, named: `ls /home/nish/workspaces/tooling/fleet-ops-deploy-clone/lib/seat-lib.sh` → not found (ENOENT; the deploy clone's layout predates the lib), then `source` with the empty result → `bash: source: filename argument required` (exit 2, twice on the same call). Fixed in the same run: the lib resolved in the fresher worktrees, and the senior-seat question it answers was closed by `fleet-review-arm-check` exit 0 anyway. No-match probes (exempt): `gh pr list` (no open #3357 PR), skip/only grep over the diff (none), `.git/info/exclude` (empty).
