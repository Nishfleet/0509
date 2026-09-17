# App-store schema preparation, issue #3210

Phase 1 only. `0105_widen_source_target_connector_appstore.sql` adds `appstore`
to the CHECK from `0103`, after `0104_competitor_suggestion_dismissal.sql`.
It does not register a connector, change a flag, or claim customer coverage.
The saved connector at `3c7a76b76d7420db822e0700a227674fb3fd8523` is unmerged
work, not shipped functionality. Its earlier lane notes are not release proof.
Phase 2 stays on #3210 and must recheck official-source parity before activation.

## Execution limits

This is a parent-table rebuild, not a data-free ALTER. It copies the parent,
snapshots three child tables, drops the parent, renames its replacement, then
restores children and indexes. The old application's accepted connector values
remain valid when the migration finishes. Code rollback does not undo this SQL.

Only the approved senior migration process may apply this to production:
verified backup, concrete recovery plan, independent senior review and approval,
application, live verification, then notification. This PR is not approval to
apply it. All writers must be stopped for the entire execution and recovery
window. Concurrent writes after snapshots could otherwise be lost. Queries may
fail while the parent is absent. Do not run this as an online migration.

## Evidence and assumptions

Official Cloudflare docs read on 2026-09-17:

- [Migrations](https://developers.cloudflare.com/d1/reference/migrations/)
  documents ordered files and the `d1_migrations` ledger. It does not establish
  atomicity across every statement in one file.
- [Foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)
  documents enforced foreign keys and implicit transactions. Deferring checks
  does not turn off cascading deletes.
- [D1Database.batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
  documents transactions for batches. That is not a guarantee about a migration
  execution path using separate requests.

The local integration test runs the actual 0105 statements separately. At the
DROP boundary it checks that the replacement parent and child snapshots remain,
while the original parent is absent and its child rows have cascaded away. It
then resumes with the remaining statements and checks reads, new writes and
foreign-key integrity. This proves local SQL behavior, not production execution,
backup readiness, or safety with concurrent writers.

## Interruption and recovery

Never blindly rerun this file after partial execution. Its CREATE, restore
INSERT and rename statements are not retry-safe. Keep writers stopped. Record
the last confirmed statement, inspect `sqlite_master`, the migration ledger,
and full row contents before deciding where to resume. Counts alone are not
proof of an intact copy. If the committed boundary is uncertain, do not guess:
use the verified backup through the approved recovery process.

| Last confirmed stage | Data location and recovery |
| --- | --- |
| Before parent DROP | Original parent and children remain. Keep all snapshots. Inspect the replacement copy and resume only at the next uncommitted statement. |
| Parent dropped, not renamed | Parent rows are in `source_target_appstore_widen_new`. Children are in `pi_bk_0105`, `pc_bk_0105`, `pir_bk_0105`. Resume at the rename, not at the start. |
| Renamed, children partly restored | Parent is `source_target`. Restore only the confirmed missing child INSERTs in file order: items, cursors, revisions. Never replay completed INSERTs or overwrite duplicate rows. |
| Children restored, cleanup/indexes incomplete | Confirm every row matches the pre-run backup. Resume remaining cleanup and index statements. Do not delete remaining snapshots until preservation is proven. |
| SQL finished but ledger uncertain | Check rows, schema, indexes and ledger. Have the approved recovery process reconcile the ledger; do not rerun the whole file to force a ledger entry. |

Before writers resume, verify all parent and child rows, all three indexes,
`PRAGMA foreign_key_check`, an old-connector write and an appstore write in a
controlled verification transaction or approved test account. Production tests
and their cleanup need the same senior approval. No production command was run
for this phase.
