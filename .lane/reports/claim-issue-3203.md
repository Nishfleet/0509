# Lane report — issue #3203: YouTube mentions into the mention table (split of #3171)

Branch: `claim/issue-3203`
Base: `origin/main` at `16bd92843` — the 5 prior commits (2 `wip(salvage)` + 3 real) squashed to ONE and rebased on it CLEAN (no conflicts)
Unit: `pi-issue-0509-3203`

## What the issue needed, and what the salvage trail had

Both blocked-ons were resolved before this pickup: #3178 (mention table +
adapter interface) merged as #3339 on 2026-09-13T04:50Z; fleet-ops#5806 (the
split-release gate) closed earlier — the sibling slices #3200/#3202/#3204
landed through the same gate. A claim-cap park (seat 401/402 outage,
fleet-ops#2772) held the issue until the judge's `decision-resolved:
seat-outage-park` at 2026-09-14T08:35Z returned it to agent-ready.

Re-entrancy by salvage: this unit died repeatedly post-build, pre-PR across
2026-09-13T16:38Z → 2026-09-14T01:28Z (five banked `wip/pi-issue-0509-3203-*`
branches, the latest at `91563aef1`). The cumulative diff survived on the
claim branch:

- `app/lib/presence-connectors/youtube.server.ts` (+662) — the connector;
- `migrations/0103_widen_source_target_connector_youtube.sql` (+84) — the
  CHECK widen (rebuild convention, strict superset of 0102_podcast);
- `tests/integration/youtube-mention-connector.integration.test.ts` (+882,
  24 its, workers project);
- `app/lib/presence-access-gates.server.ts` — rollout/credentials cases +
  `connectorHasCustomerPollPath` (a follow-on fix: the orchestrator gate had
  returned `connector_not_operational` at any rollout);
- `app/lib/presence-connector-registry.server.ts` — dispatch + coverage
  label; `app/lib/presence-source-coverage.server.ts` — coverage wiring +
  docs note; `app/lib/env.server.ts` — `PRESENCE_YOUTUBE_ROLLOUT` +
  `YOUTUBE_API_KEY`;
- `tests/status.route.test.ts` + `tests/presence-source-coverage.test.ts` +
  `tests/d1-remote-restore-evidence.test.ts` — the /status row pin, the
  coverage-posture pins, the repo-only migration pin;
- `docs/mentions/PLAN.md` — §2 row, #3203 work-item row, the metric read,
  and the §8 collector research.

## What this run shipped

Inherited the diff — did NOT re-derive it. Verified the artifact, removed
one salvage-rebase artifact (an orphaned 3-line podcast-survey fragment
sitting mid-§8 — its head paragraph was reverted on main by 2c8470ed7), then
squashed the 5 commits to one, rebased onto origin/main, and ran the tests:

- `npx vitest run --configLoader runner --project node --changed origin/main`
  → 376 files / 4,726 tests passed, exit 0 (160s).
- `npx vitest run --configLoader runner --project workers
  tests/integration/youtube-mention-connector.integration.test.ts`
  → 24/24 passed, exit 0, real workerd + real D1 + real migrations.

`VITEST_MAX_WORKERS=2` respected; one suite at a time; no coverage/typecheck
(CI owns both).

## Resume pass (unit died post-PR, salvage resume 2026-09-14)

PR #3468 was already open and armed. Found `codex-node-checks` red:
`tests/status.route.test.ts` crossed the 800-line file-size ratchet
(802 lines). Moved the YouTube /status row pins into
`tests/status-route-youtube.test.ts` (ratchet's own docstring prescribes
the split); status.route.test.ts back to 787.

Reviewer round ran on senior seat `cursor/cursor-grok-4.6-high` (stock
reviewer, one round): no BLOCKING. Two act-on findings fixed and pushed
(3fe527b19): `youtube` added to `PRESENCE_MENTION_CONNECTOR_IDS` so digest
+ public timeline read the captured rows; Data API v3 snippet fields now
`decodeHtmlEntities` before trim/store/hash (rss decodeXml precedent), with
a new `SEARCH_PAGE_ESCAPED` integration pin (25/25 workers suite green).
Consider/Noted/Dismissed buckets recorded in the PR body.

CI then surfaced a fleet-wide blocker unrelated to this diff:
`tests/sitemap-coverage-guard-provision.test.ts` fails on GitHub runners
(`--resolve-path` needs one dir with BOTH node and gh) on every queued
branch — filed as #3502. PR is queued (merge queue, position 8 at push
time); it merges once main is green again.
