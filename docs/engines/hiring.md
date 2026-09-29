# Engine: Hiring (job boards)

Issue #4725. Built in #4841 (findBoard), #4848 (readBoard) and #4850 (the Workflow and config). Every path below is on `main` today.

## What it does

The `hiring-sweep` Workflow runs at 02:30 UTC (after the 02:00 site sweep, before the 03:00 standing refresh). It finds each tracked brand's public job board and files each new job post as a `signal` with `kind = 'hiring'`. The 03:00 refresh counts those as `hiring_new_role` (`workers/standing/refresh.ts` via `app/lib/standing-score.server.ts`), so Home ranks them with no further change.

## Source choice

Official public job-board listing APIs for Greenhouse, Lever (US and EU), Ashby, Workable and SmartRecruiters (`app/lib/hiring/discover-board.ts`): public, no key, JSON. Rejected: scraping careers pages, because it needs AI judgment and the browser.

## Flow

`planHiringSweep` (`app/lib/hiring/sweep.server.ts`) lists the `'on'` entities with no active hiring watch, and the active watches. `findBoard` (one `step.do` per entity) reads the homepage through `readUrl`, collects every `a[href]` with HTMLRewriter and calls `discoverBoard`. The result is cached in `IDENTITY_CACHE` under `hiring:<registrable>:board` for 7 days. A board on an enabled `hiring.<platform>` source becomes a watch whose `target_key` is the board URL.

`readBoard` (one `step.do` per watch, `app/lib/hiring/read-board.server.ts`) reads the listing with plain `fetch` (8 s abort per page, SmartRecruiters paged), and stores the normalized roles at R2 `snapshot/hiring/<watchId>/<snapshotId>.json`. The hash is SHA-256 of the sorted role ids; an unchanged hash reuses the previous R2 key. The first snapshot is a baseline and files nothing. After that, roles not in the previous snapshot become signals, deduplicated on `<watchId>:<roleId>`. One `hiring.sweep` log line per run carries the counts: discovered, boards, first, unchanged, changed, newRoles, failed.

## Cost

Listing reads are plain `fetch`, about 0.25 s a board (`docs/REBUILD-COST.md`). The browser is reached only through `readUrl` on a discovery cache miss, so a brand with no board costs one KV read a night. One R2 write per changed board. Signal writes are batched in chunks of 50. There is no new binding beyond the Workflow.

## Failure modes

A homepage that cannot be read fails that entity's step only, and nothing is cached. A 404 or 410 on the listing deactivates the watch (the brand moved boards), and rediscovery finds the new board when the cache entry expires. Any other listing failure logs `hiring.read_failed` and fails that step only. Retries are idempotent: deterministic snapshot ids, `ON CONFLICT DO NOTHING` on the `<watchId>:<roleId>` dedup key, and the previous snapshot is read with `before = plannedAt`.

## Privacy

Only normalized role fields are stored (id, title, url, location, team, postedAt): never descriptions, compensation or anyone's name. Brands and creators only (`docs/REBUILD-GUARDRAILS.md`).
