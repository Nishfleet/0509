# Restore: what is backed up, how to get it back, how long it takes

Checked read-only on 2026-10-14 (backup drill, 0509 journeys thread).

| Data                | Backup                                                                          | Reach                                                           | Restore                                                                                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 `0509`           | Cloudflare Time Travel                                                          | 30 days                                                         | `wrangler d1 time-travel restore 0509 --bookmark=<bookmark>`, production needs Nish's yes. Measured 11 s on a throwaway (docs/REBUILD-DONE.md, 2026-09-22), and a full export loads into a fresh database in about 12 s (2026-09-28). |
| R2 `0509-snapshots` | Nightly copy to `0509-snapshots-backup` (05:00 UTC, `snapshot-backup` Workflow) | Copies stay until the backup's own lifecycle rules age them out | Copy objects back from the backup bucket. No code does this today, it is a manual copy.                                                                                                                                               |

## Evidence the R2 copy is complete and fresh

- Runs 2026-10-09 to 10-13 all completed. 10-12: listed 1582, copied 89. 10-13: listed 1702, copied 120. A rerun later on 10-13 listed 1702, copied 0, present 1702.
- At 2026-10-14T03:00Z the source held 1874 objects (513,051,512 B) and the backup 1710 (486,101,750 B). The 164 objects difference is what was written after the last run. The next 05:00 run closes it.
- Since this change the copy also compares sizes, so a stale or short copy under the same key is replaced.

## Recovery time

- D1: seconds to minutes, measured.
- R2: **estimate, not measured.** The cloud has no read access to R2 objects, so no timed fetch exists. The nightly listing ran 9 pages of 200 in 30 to 45 s per page, copy included. Copying about 1,900 objects (about 513 MB) back at that page rate is 10 pages, so about 5 to 8 minutes.
- What is not covered: the copy keeps no history of an object that was overwritten (only logos reuse a key), and a deletion in the source is never deleted in the backup until its lifecycle rule fires.

## Roll back a bad deploy

Written from `.github/workflows/deploy-production.yml` on 2026-10-14. No live rollback was triggered for this write-up, so none of it was drilled against production.

### The Worker

- **Automatic.** The deploy job records the serving version, deploys, then polls `/api/health` until it answers `ok` with this commit (20 tries, 5 s apart). A red or cancelled smoke runs `wrangler rollback` to the recorded version. Read the step "Roll back to the serving Worker version" in the run.
- **Manual.** `npx wrangler versions list` shows version ids, `npx wrangler rollback <version-id> --message "<why>"` serves one. This changes production, so it needs Nish's yes (AGENTS.md: production state stays gated).
- **A rollback is not a fix.** The next push to `main` deploys again. Revert the bad commit through the merge queue as well.
- **Can be impossible.** A deploy that adds a new Durable Object migration tag in `wrangler.jsonc` can make a rollback impossible or unsafe. On such a deploy the automatic rollback step still runs and may fail, so check the run and recover by hand. Deploys that add no new tag are not affected.

### A migration

- Migrations are additive, so the previous Worker keeps running on the new schema. Rolling the Worker back does not need the schema rolled back.
- The migration step runs before the Worker deploys. A migration file that fails stops the job: the Worker is never deployed, and the files before it stay applied.
- The deploy writes the D1 Time Travel bookmark taken just before migrating into the run's job summary. That bookmark is the path back for a migration that dropped or rewrote data.
- To use it, `npx wrangler d1 time-travel restore 0509 --bookmark=<bookmark>`. This rewinds every write after the bookmark, including sign-ups and snapshots written since. Exporting first (`npx wrangler d1 export 0509 --remote --output <file>`) keeps those rows, but the export blocks the database while it runs, so during an incident decide whether the Time Travel bookmark alone is enough. Production restores need Nish's yes.
- A restore prints the bookmark it replaced, which undoes the restore if it was the wrong call.
