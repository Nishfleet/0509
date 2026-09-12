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
- `npx vitest run --project node --changed origin/main` → 364/365 files pass;
  3 pre-existing failures in `tests/launch-readiness-guard.route.test.ts`
  (`detail` field pin, broken on main by 6a5621c0e; open PRs #3262/#3273 own
  the fix — untouched files, unrelated lane).
- verify-0509 harness: `npm run e2e:serve:local` applied 0099 ✅ via real
  wrangler migration path; `/api/health` 200, `/api/health/deep` `d1:"ok"`,
  `/` 200, `/brands` 200. Server killed by process group; port 4179 free.

## Notes

- `THREADS_ACCESS_TOKEN` is env-held (issue advisory allows it); no
  `source_connection` CHECK widen needed.
- Meta cap semantics honored: queries returning zero results do not count;
  cap counted per rolling-24h window anchored at first counted query.
- Migration number 0099 chosen because 0097/0098 are claimed by open PRs.
