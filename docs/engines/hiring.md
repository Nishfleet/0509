# Engine: Hiring (job boards)

Issue #4725. Built in #4841 (findBoard), #4848 (readBoard) and #4850 (the Workflow and config); every path below is in those merges.

## What it does

The `hiring-sweep` Workflow runs at 02:30 UTC (after the 02:00 site sweep, before the 03:00 standing refresh). It finds each tracked brand's public job board and files each new job post as a `signal` with `kind = 'hiring'`. The 03:00 refresh counts those as `hiring_new_role` (`workers/standing/refresh.ts` via `app/lib/standing-score.server.ts`), so Home ranks them with no further change.

## Source choice

Official public job-board listing APIs for Greenhouse, Lever (US and EU), Ashby, Workable and SmartRecruiters (`app/lib/hiring/discover-board.ts`): public, no key, JSON. Rejected: scraping each careers page for the roles themselves, because the listing read would need AI judgment and the browser on every board, every night. Discovery still reads the brand homepage once through `readUrl`, but only to find the board link.

## Flow

`planHiringSweep` (`app/lib/hiring/sweep.server.ts`) lists the `'on'` entities with no active hiring watch, and the active watches. `findBoard` (one `step.do` per entity) reads the homepage through `readUrl`, collects every `a[href]` with HTMLRewriter and calls `discoverBoard`. The result is cached in `IDENTITY_CACHE` under `hiring:<registrable>:board` for 7 days. A board on an enabled `hiring.<platform>` source becomes a watch whose `target_key` is the board URL.

`readBoard` (one `step.do` per watch, `app/lib/hiring/read-board.server.ts`) reads the listing with plain `fetch` (8 s abort per page). Greenhouse, Lever, Ashby and Workable return the whole board in one page; SmartRecruiters pages at 100 roles a fetch, capped at 10 pages. The normalized roles go to R2 at `snapshot/hiring/<watchId>/<snapshotId>.json`, and the hash is SHA-256 of the sorted role ids; an unchanged hash reuses the previous R2 key. The first snapshot is a baseline and files nothing. After that, roles not in the previous snapshot become signals, deduplicated on `<watchId>:<roleId>`. The hash covers ids only, so an edit to a role's title, location or team reads as unchanged, On every non-baseline read, changed or not, `readBoard` first applies the role lifecycle (`planRoleLifecycle` in `app/lib/hiring/role-lifecycle.ts`, written by `applyHiringLifecycle`) to that watch's existing signals: a present role advances `last_seen_at` (and reopens if closed), a role missing once is marked missed, missing twice closes it. Only then are new roles filed, skipping any role that already has a signal row. A 404/410 or a failed read never touches the lifecycle. One `hiring.sweep` log line per run carries the counts: discovered, boards, first, unchanged, changed, newRoles, advanced, closed, reopened, lifecycleWrites, failed.

## Cost

A listing read is plain `fetch`, about 0.25 s a page (`docs/REBUILD-COST.md`): one page a night for most boards, up to ten for a large SmartRecruiters board. The browser is reached only through `readUrl` on a discovery cache miss, so a brand with no board costs one KV read a night. One R2 write per changed board. Signal writes are batched in chunks of 50. There is no new binding beyond the Workflow.

## Failure modes

A homepage that cannot be read fails that entity's step only, and nothing is cached. A 404 or 410 on the listing deactivates the watch (the brand moved boards), and rediscovery finds the new board when the cache entry expires. Any other listing failure logs `hiring.read_failed` and fails that step only. Retries are idempotent: deterministic snapshot ids, `ON CONFLICT DO NOTHING` on the `<watchId>:<roleId>` dedup key, and the previous snapshot is read with `before = plannedAt`.

## Privacy

Only normalized role fields are stored (id, title, url, location, team, postedAt): never descriptions, compensation or anyone's name. Brands and creators only (`docs/REBUILD-GUARDRAILS.md`).
