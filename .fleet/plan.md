# Phase 3 plan — Reddit + X mention activation through existing connectors

Issue: Nishfleet/0509#1378 (mention-monitoring epic #1368). Manager mode.

## Goal
Activate the existing `reddit` and `x` presence connectors as mention sources:
a pure `buildMentionQuery` builder with provenance, a real customer poll path for
x/reddit, docs coverage rows switched to `gated`, and a workerd/D1 integration
test proving `pollPresenceTarget` + upsert + dedup end-to-end.

## Acceptance-driven phases

- [x] phase 1: open the real customer poll path for x + reddit — `connectorHasCustomerPollPath` in `app/lib/presence-access-gates.server.ts` returns true for `"x"` and `"reddit"` (currently only website/rss), with one `research:` + one `help-first:` line noting it is the minimal additive extension of a REUSE read-only connector surface that the issue's UNKNOWNS explicitly allows. Do NOT touch linkedin.
- [x] phase 2: create `app/lib/mention-query.server.ts` — pure, synchronous `buildMentionQuery(trackedEntity, source)` where `source: "reddit" | "x"`; reddit returns `{ source, query: { subredditCandidates: [...] }, provenance }`; x returns `{ source, query: { q: "<entity label>" OR "<canonical domain>" }, provenance }`; provenance names the probe that surfaced each candidate. No env, no network. Accept optional pure `identity?: { domainAliases?; siteName? }` enrichment param; never call the probe inside.
- [x] phase 3: in `app/lib/presence-source-coverage.server.ts` `presenceSourceCoverageForDocs()`, change x and reddit rows' `productionStatus` from `"unavailable"` to `"gated"` (mirror rss wording re rollout env, off by default). No env access in the static table.
- [ ] phase 4: update `tests/presence-source-coverage.test.ts` — docs assertion for x → `"gated"`; rewrite the "mock-only social connectors unavailable" test to expect `available` for x when rollout+creds set (real poll path now); keep linkedin no-poll-path behavior. Add `tests/mention-query.test.ts` (node) covering `buildMentionQuery` pure behavior + provenance for both sources.
- [ ] phase 5: create `tests/integration/mention-source-activation.integration.test.ts` (workerd/D1, real migrations) — seed user + tracked_entity + source_target rows for x and reddit; activated env (rollouts internal, creds, REDDIT_COMMERCIAL_ACCESS approved, mocks on); assert buildMentionQuery shapes; `pollPresenceTarget` returns items; `upsertPresenceItems` inserts; second poll+upsert dedups (row count stays); `reconcilePresenceItemsAfterPoll` tombstoned:0; disabled env → buildMentionQuery still returns shape + `evaluatePresenceSourceCoverage` returns UNAVAILABLE + `loadMentionPanel` returns empty-no-sources (honest empty, planFamily agency).
- [ ] phase 6: verification — run node tests (mention-query, presence-source-coverage, mention-panel) green; run workers integration glob (new file + rss-mention-connector regression) green; typecheck + lint clean; `npx vitest run tests/integration/mention-source-activation.integration.test.ts` exits 0 (the termination command).

## Files to Modify
- `app/lib/presence-access-gates.server.ts` — widen `connectorHasCustomerPollPath` (x, reddit).
- `app/lib/presence-source-coverage.server.ts` — docs rows x/reddit → `gated`.
- `tests/presence-source-coverage.test.ts` — update x docs assertion + rewrite social mock test.

## New Files
- `app/lib/mention-query.server.ts` — pure `buildMentionQuery` + provenance.
- `tests/mention-query.test.ts` — node unit tests for the pure builder.
- `tests/integration/mention-source-activation.integration.test.ts` — workerd/D1 integration.

## Risks
- `connectorHasCustomerPollPath` is a REUSE read-only file — keep the change to exactly the x/reddit predicate; research:+help-first: required.
- `connectorOperationalForPolling` needs rollout `internal|pilot|ga` + creds; reddit needs `REDDIT_COMMERCIAL_ACCESS:"approved"`.
- Dedup is per `source_target_id`+`urlHash` — assert within a single target.
- `reconcilePresenceItemsAfterPoll` is tombstone-only; inserts go through `upsertPresenceItems`.
- docs `gated` vs runtime `unavailable` when disabled — matches the existing rss pattern; do not force runtime to gated.
- Panel-loader assertion needs `planFamily:"agency"` so plan gates don't mask it.
- Gate-owned paths (.github/**, migrations/**, plan.server.ts, competitor-site-monitor, auto-competitor-seed) MUST NOT be touched.
