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
- `migrations/0103_widen_source_target_connector_appstore.sql` — expand-only
  CHECK widen via the 0093/0098/0100/0101 table-rebuild convention; child
  tables snapshotted and restored inside the transaction. Numbered 0103: the
  file was first 0101 (collided with 0101_pinterest, caught by the
  integration test), then 0102 — but the podcast slice's 0102 was restored
  to main (e15f7ec77: production had applied it before the revert landed),
  so the unapplied appstore widen renumbered to 0103.
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

## Resume pass (this unit, 2026-09-14)

- Merged `origin/main` @ `16bd92843` (16 commits incl. tiktok source +
  coverage-golden additions) — clean, no conflicts.
- Fixed the leftover `0102` staleness the last salvage left: migration
  backup tables renamed `*_bk_0102` → `*_bk_0103` (the convention is
  suffix = own migration number; 0102 is podcast's live production file)
  and the connector doc comment now names 0103.
- Re-ran on this worktree: `npx vitest run --configLoader runner
  --project node --changed origin/main` → 376 files, 4728/4728 pass;
  `npx vitest run --configLoader runner --project workers` → 89 files,
  539/539 pass; the appstore file alone after the rename → 8/8.

## Ship pass (this unit, 2026-09-14)

- The remote claim branch had been reset to plain main by the
  claim-release/re-claim cycle; the salvaged work lived only on the local
  branch. Merged `origin/main` @ `e039762f1` (clean, no conflicts) so the
  push is a fast-forward carrying the whole slice.
- Re-verified on the merged head `f0030d880`: `npx vitest run
  --configLoader runner --project node --changed origin/main
  --reporter=dot` → 378 files, 4747/4747 pass (186s); `npx vitest run
  --configLoader runner --project workers --reporter=dot` → 91 files,
  545/545 pass (158s) — migrations changed, so the full real-workerd
  project ran. `sgscan --base origin/main` → no new findings.
- Migration numbering re-checked against live main tail: `0102_podcast` is
  the last file on origin/main; our `0103_appstore` is next, no collision.

## CI fix pass (this unit, 2026-09-14, PR #3499 red)

- Merged `origin/main` @ `f2ea228fd` — five sibling-add conflicts resolved as
  unions (presence-types ids, registry mention-ids + dispatch, access-gates
  poll-path predicate, coverage tests, PLAN.md research notes,
  restore-evidence list).
- **Migration renumbered 0103 → 0104**: `0103_widen_source_target_connector_
  youtube.sql` landed on main while this slice was in flight. The new file's
  CHECK carries the full thirteen-connector union (0103's twelve + appstore);
  backup tables renamed `*_bk_0104`; the migration test renamed to match and
  now preserves/writes 'podcast' AND 'youtube' rows alongside 'appstore'.
- **File-size ratchet**: `tests/status.route.test.ts` crossed 800 with our
  +27 — the appstore /status row test moved to
  `tests/status-route-appstore.test.ts`, the same split
  `status-route-youtube.test.ts` took.
- **no-time-bomb guard (#3215)**: the integration suite's feed `updated`
  literals are now `// fixed-date:`-annotated (two hoisted consts) — they are
  fixture payload stored verbatim, never compared to the wall clock (the
  digest `since` reads created_at).
- **preview-assert TS2345**: the Play-only stub needed no `lookup` — the
  fetcher's `lookup` responder is now optional with the same 404 fallback as
  `reviews`/`play`.
- Re-verified on this worktree at `839874fec`+ (merged head): `npx vitest run
  --configLoader runner --project node --changed origin/main --reporter=dot`
  → 384 files, 4784/4784 pass (127s); `npx vitest run --configLoader runner
  --project workers --reporter=dot` → 94 files, 575/575 pass (182s) —
  migrations changed so the full real-workerd project ran, 0104 applied to
  real D1 (read + write path asserted, podcast + youtube rows preserved).
