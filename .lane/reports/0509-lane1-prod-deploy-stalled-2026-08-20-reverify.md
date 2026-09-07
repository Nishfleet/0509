# Production deploy stall — already resolved, re-verified live (2026-08-20 lane 1)

**Status: resolved; stale premise — evidence record only, no product code touched.**

Branch: `0509-lane1-prod-deploy-stalled-2026-08-20-reverify`
Base: `origin/main` at `5b33e274`

## Item

- [ ] Production has not received ANY merged code since the last successful
  deploy (01:58:29Z dispatch → worker e3ba940b)

## Verdict

Stale premise, re-verified live on 2026-08-20. Production has received merged
code repeatedly since the `01:58:29Z` deploy the item names, and is shipping
on the regular hourly cadence today. The auto-deploy pipeline
(`auto-deploy.py`, hourly tick on the VPS, dispatching
`.github/workflows/deploy-production.yml`) kept shipping — including **today**:
the latest deployment record is `5996731090` for commit `63e1bd17`, created
2026-08-20T05:59:50Z with status `success` at 2026-08-20T06:29:24Z. The commit
deployed (`63e1bd17 fix(ops): rate-limit backlog-console alert (1/6h/cause) via
Telegram, email weekly-only (#788)`) is an ancestor of current `origin/main`
(`git merge-base --is-ancestor` returns true), so this is real merged code on
main, not a stale rerun.

## Live evidence (queried 2026-08-20T11:36Z)

`GET https://api.github.com/repos/Nishfleet/0509/deployments?per_page=30` —
the most recent 30 production deployment records, oldest to newest below:

| Created (Z) | SHA | Note |
|---|---|---|
| 2026-08-18T07:05:47Z | add178ca | continuing cadence |
| 2026-08-19T01:46:42Z | adbd3759 | continuing cadence |
| 2026-08-19T06:05:34Z | 9794c30d | continuing cadence |
| 2026-08-19T07:16:42Z | 5eec9f46 | continuing cadence |
| 2026-08-19T08:12:19Z | 5eec9f46 | continuing cadence |
| 2026-08-19T20:40:33Z | ae1b545b | continuing cadence |
| 2026-08-20T00:19:32Z | 8583708c | continuing cadence |
| 2026-08-20T05:59:50Z | 63e1bd17 | **latest today**; status `success` at 06:29:24Z |

Status of the latest deployment (`5996731090`):

```
2026-08-20T06:29:24Z success
2026-08-20T05:59:54Z in_progress
2026-08-20T05:59:52Z queued
2026-08-20T05:59:51Z waiting
```

The exact commit deployed (`63e1bd17`, PR #788) is an ancestor of
`origin/main` (`5b33e274`), so live production is on a clean commit on the
main line — not a stuck or diverged state.

## Auto-deploy log evidence

`/home/nish/workspaces/agent-state/lanes/auto-deploy.log` shows continuous
shipping across the per-tick dispatcher between the named deploy and now:

- 2026-08-13 04:00–22:14Z: 7+ green deploys (commits `aa019c47`, `fbe22514`,
  `164c3bbc`, `afc1e687`, `bceec022`, `07481600`).
- 2026-08-14 18:00Z: deploy of `2b91842b` succeeded
  (`NOTIFY: shipped … all gates green`, worker version
  `11659201-9cc0-4a75-9c4c-e1622d16055e`).
- 2026-08-15 → 2026-08-17: hourly cycle continues shipping through
  `befc207f`, `007275bd`, `7753e8b5`, `e49755a2`, `c1d0b1bf`, `feb1d460`,
  `fdb97b84`, `6d4fcd2d`, `ad306cdd`, and several more.
- Entry on 2026-08-17T17:23:00 reflects a successful release of `ad306cdd`
  via run `32027560674` (commit `6d4fcd2d → ad306cdd`). The
  `auto-deploy-last-run.json` snapshot agrees (`live = 6d4fcd2d` before the
  next dispatch of `ad306cdd`).

After `2026-08-17`, the most recent dispatcher events confirm the GitHub
deployments list above: today's `success` at 06:29:24Z for commit `63e1bd17`
is the latest pipeline outcome.

## Why the item is stale

The named deploy ("01:58:29Z dispatch → worker e3ba940b") is from
**2026-08-12**. The packet assumption that production has not received *any*
merged code since then is contradicted by the deployment record and the
dispatcher log: at least 20 production deployments have shipped since
2026-08-12, including multiple today (2026-08-20). This is the same
recurring staleness check that the lane has already re-verified on
2026-08-15 in
`report-lane1-prod-deploy-stalled-already-resolved-reverify.md`.

## What earlier today (2026-08-20) actually looks like

Two merged commits on `origin/main` shipped to production since the start of
the UTC day: `8583708c` (deployment `5993711819` at 00:52:29Z) and `63e1bd17`
(deployment `5996731090` at 05:59:50Z, success at 06:29:24Z). The pipeline is
operating normally; if `git fetch` were to land a new main commit, the next
hourly tick would pick it up.

## Evidence sources

- GitHub deployments API
  (`https://api.github.com/repos/Nishfleet/0509/deployments`,
  `https://api.github.com/repos/Nishfleet/0509/deployments/5996731090/statuses`).
- `/home/nish/workspaces/agent-state/lanes/auto-deploy.log` — dispatcher
  per-tick record.
- `/home/nish/workspaces/agent-state/lanes/auto-deploy-last-run.json` —
  snapshot of last successful release.
- Prior lane evidence
  `report-lane1-prod-deploy-stalled-already-resolved-reverify.md` (2026-08-15)
  for the same item with the same verdict.

## Files

- `.lane/reports/0509-lane1-prod-deploy-stalled-2026-08-20-reverify.md` —
  evidence record only; no product code touched.
