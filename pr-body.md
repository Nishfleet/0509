**Issue #2334** — Replace the `event_type` CHECK constraints with a lookup/free-text column in one final table rebuild.

## What changed
Migration `migrations/0090_event_type_free_text.sql` (new) rebuilds `event_candidate` and `watch_event` one final time:

- `event_type` becomes unconstrained free text (the inline `CHECK (... IN (...))` is dropped from both tables) — vocabulary validation moves from the schema to code (the source adapter registry from #2333).
- A new nullable `source_kind TEXT` column is added to both tables.
- Rebuild uses the established `_next` → `INSERT ... SELECT` → `DROP` → `RENAME` convention (0077:40-135 for `watch_event`, 0077:146-250 for `event_candidate`) with `PRAGMA foreign_keys = OFF/ON`, preserving every existing column, value, and row and recreating the same indexes. Row counts are unchanged by the rebuild.
- Apply is one-way (D1 has no down-migrations); the pre-0090 event types remain valid free text, so reverting the code does not depend on re-imposing a CHECK. One phase only: this is the final table rebuild. (`Relates to #2333` — the adapter-registry code validation is that issue's scope.)

## Migration numbering note
The judge edits (binding) pinned this as `migrations/0088_event_type_free_text.sql`, but `0088` is already taken by two applied migrations (`0088_competitor_source_fields.sql`, `0088_recreate_delivery_hot_path_indexes.sql`). Per the sibling issue's standing principle ("verify the next free migration number at run time; if taken, use the next and note it in the PR"), this lands as the next genuinely free number, `0090`. A duplicate `0088` would collide with D1's per-id migration bookkeeping on a fresh apply.

## Verification
Ran `npm test` on this branch — full suite green against real D1:
- `node` project: **662 test files / 7885 tests passed**
- `workers` (real D1 + real migrations applied): **53 test files / 258 tests passed**, including the new `tests/integration/migrations/0090-event-type-free-text.integration.test.ts` (4 tests) and the updated `tests/integration/watch-event-writes.integration.test.ts`.

`run-proof: migrations/0090_event_type_free_text.sql applied to a fresh D1 in the workers project; tests/integration/migrations/0090-event-type-free-text.integration.test.ts (4 tests) + full `npm test` (node 662/7885, workers 53/258) green`

## Integration test (D1 schema rule)
`tests/integration/migrations/0090-event-type-free-text.integration.test.ts` applies the repo's real migrations and asserts both the **READ** path (both tables expose `source_kind`; the `event_type` CHECK is gone from the live `sqlite_master` DDL; a legacy `ad_new` event_type round-trips unchanged with `source_kind` NULL) and the **WRITE** path (a brand-new `event_type` that the old CHECK never allowed, plus a `source_kind`, is accepted into both tables and read back).

The pre-existing `watch-event-writes.integration.test.ts` test `lets D1 reject an event_type outside the schema's CHECK vocabulary` pinned the schema as the enforcement point — precisely the behavior #2334 removes. It is updated (same assertion count) to assert the new contract: D1 accepts free-text `event_type`, with `test-removal-justified:` on the commit. It touches no gate-owned path and removes no test.

## Scope checks
- `research:` — no `bin/` files added (migration + test only); `research-before-build-check` not applicable.
- `help-first:` — not applicable (no new `bin/` files).
- rebuild/masking diffs: none.
- organ diffs: none (`organ-heartbeat:` not-an-organ — `watch_event`/`event_candidate` are data tables, not organs; no organ files touched).
net-positive-because: a migration file plus its required real-D1 integration test necessarily add schema-lines; the added code is persistent intent (the free-text event_type contract #2334 demands), not a throwaway shim.

loose-ends: legacy `watch_event`/`event_candidate` rows keep `source_kind` NULL; the column is populated by new sources going forward (code wiring lands with the #2333 adapter registry, out of scope here).

Closes #2334