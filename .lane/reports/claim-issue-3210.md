# Lane evidence — claim/issue-3210 (Nishfleet/0509 #3210)

Unit: pi-issue-0509-3210. Branch: `claim/issue-3210`. Base: `origin/main` at `5f2f1242d`.

Session pickup: two prior units banked work (`wip/pi-issue-0509-3210-20260913T183412Z`,
`wip/pi-issue-0509-3210-20260913T193706Z`); this unit inherited the connector,
migration and tests, merged the post-revert main (podcast slice reverted by
`2c8470ed7`, evidence fix `#3439`), resolved the five podcast-vs-appstore
conflicts (appstore kept, podcast dropped — main's revert wins), and shipped.

## What shipped (issue #3210 — app-store mentions, split of #3171)

- `app/lib/presence-connectors/appstore.server.ts` — ONE keyless connector,
  TWO lawful public surfaces: Apple iTunes Search/Lookup + customer-review
  RSS (page=1 only, never deep-paged) and Google Play's public details page
  (`SoftwareApplication` ld+json). Google Play REVIEWS are the documented
  exclusion (no free public API — `batchexecute` is private), listed in
  `docs/mentions/PLAN.md` per the issue's only-allowed-exclusion clause.
- `migrations/0102_widen_source_target_connector_appstore.sql` — expand-only
  CHECK widen via the 0093/0098/0100/0101 table-rebuild convention; child
  tables snapshotted and restored inside the transaction. Numbered 0102: the
  file was first 0101 (collided with 0101_pinterest, caught by the
  integration test), and the podcast slice's 0102 was reverted from main.
- Registry/coverage/env/status wiring: `appstore` joins
  `PRESENCE_CONNECTOR_IDS`, the dispatched poll path (stateless, no cursor —
  gdelt posture), `coverageLabelForConnector` → `PUBLIC_WEB_BEST_EFFORT`,
  `PRESENCE_APPSTORE_ROLLOUT` env (kill flag, off by default), the
  `/status` per-source row, and the claim-surface authority + coverage goldens.
- Shared interface untouched (issue `required`): only the appstore adapter,
  its flag, tests, migration, and coverage note changed.
- Research first (issue `required`): PLAN.md cites the searched + rejected
  open-source collectors — facundoolano/oxylabs/JoMingyu google-play-scraper
  (private `batchexecute` — rejected, public-surfaces-only), grych/AppStoreReviews
  + cowboy-bebug/app-store-scraper (wrap the same Apple surfaces — rejected).
  $0, no paid vendor, no new dependency.

## Verification (all run this session, this worktree)

- `npx vitest run --configLoader runner --project node
  tests/customer-claim-surface-registry.test.ts
  tests/d1-remote-restore-evidence.test.ts
  tests/presence-source-coverage.test.ts tests/presence-tracking.test.ts
  tests/status.route.test.ts tests/presence-pilot-rollout.test.ts
  tests/presence-customer-copy.test.ts tests/presence-data.server.test.ts`
  → 8 files, 151/151 pass.
- `npx vitest run --configLoader runner --project workers` (migrations
  changed → full integration project on real workerd + real migrations)
  → 85 files, 531/531 pass.
- `tests/integration/appstore-mention-connector.integration.test.ts`
  (478 lines, 8 tests) proves each acceptance bullet: ≥1 mention through the
  real dispatched poll (Apple listing + reviews + Play listing); dedup by
  canonical URL (second poll inserts 0 via `UNIQUE (source_target_id,
  url_hash)`); an edited Apple review becomes a REVISION; rate budget pinned
  (2 requests per Apple poll, 1 per Play poll, honest empty poll = 1);
  kill flag unset stops the dispatched path with zero hops; `/status`
  appstore row graded `gated`/`PUBLIC_WEB_BEST_EFFORT` with the honest
  Play-reviews exclusion.
- `sgscan` → no new security findings.
- No typecheck/coverage run in-workspace (CI owns both; fleet-ops#4891).
