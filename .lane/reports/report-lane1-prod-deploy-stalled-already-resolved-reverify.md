# Production deploy stall — already resolved, re-verified live (2026-08-15 lane 1)

**Status: resolved; stale premise — evidence record only, no product code touched.**

Branch: `report/lane1-prod-deploy-stalled-reverify`
Base: `origin/main` at `b21cc135`

## Item

- [ ] Production has not received ANY merged code since the last successful
  deploy (01:58:29Z dispatch → worker e3ba940b)

## Verdict

Stale premise, re-verified live on 2026-08-15. Production has received merged
code repeatedly since the `01:58:29Z` deploy the item names. The auto-deploy
pipeline (`auto-deploy.py`, hourly tick on the VPS, dispatching
`.github/workflows/deploy-production.yml`) kept shipping — including **today**:
deploy run `31828349312` (created 18:22:42Z 2026-08-14) completed green and
published worker version `11659201-9cc0-4a75-9c4c-e1622d16055e` for commit
`2b91842b` at 18:54:34Z, with the production deployment record at
18:24:41Z. Current `origin/main` is `b21cc135`; a deploy of exactly that
commit (run `31834020097`) was queued at 19:36:25Z 2026-08-14, waiting on
runner availability (all three self-hosted `vps-verify` runners are online
but busy), which is queueing, not a stall.

## Timeline since the named deploy

| Run (created Z) | Conclusion | Candidate | Evidence |
|---|---|---|---|
| (the item's run) `2026-08-12 01:58:29Z` | success | `95ab1858` → worker `e3ba940b` | the "last successful deploy" the item names |
| `31643328467` `2026-08-12 21:36:51Z` | success | `aa019c47` | auto-deploy log 08-13 04:23 `synced last-good to aa019c47` |
| `31665620284` `2026-08-13 04:00:08Z` | success | `fbe22514` | auto-deploy log 08-13 10:24 `shipped 7 change(s), all gates green` |
| `31689141791` `2026-08-13 10:00:11Z` | success | `164c3bbc` | deployment record 10:01:07Z |
| `31700562935` `2026-08-13 12:32:59Z` | success | `afc1e687` | deployment record 12:37:51Z |
| `31736848625` `2026-08-13 19:38:28Z` | success | `bceec022` | deployment record 20:16:26Z |
| `31743533734` `2026-08-13 20:58:54Z` | success | `07481600` | deployment records 20:58–22:14Z; version `38686986-2de7-4522-8b6d-c61f3ad896f8` |
| `31828349312` `2026-08-14 18:22:42Z` | success | `2b91842b` | deployment record 18:24:41Z; **worker `11659201-9cc0-4a75-9c4c-e1622d16055e`** (Deploy Worker log 18:54:34Z) |
| `31834020097` `2026-08-14 19:36:25Z` | queued | `b21cc135` (current main) | authorize job queued since 19:36:26Z; all three `vps-verify` runners online+busy |

Every row after the first deploys merged `main` code that the packet claims
never happened. The named deploy's own commit (`95ab1858`) was shipped on
08-12 07:56Z, after the `01:58:29Z` run.

## Why earlier today (2026-08-14) shows failures

Runs `31804741398`/`31804669687`/`31804657640` (13:25Z), `31798456838`
(11:59Z), `31798060337` (11:53Z), `31791662688` (10:18Z), `31786774345`
(09:07Z), `31782229111` (08:01Z), `31812404733` (15:01Z), `31818192147`
(16:11Z) failed at the **Authorize exact production candidate** step. The
dispatcher log shows those dispatches (`deploy dispatched but its run could
not be identified`, then `CI passed … dispatching deploy of <sha>` while a
newer main had landed) — the exact **dispatch pin race**: a
`workflow_dispatch` run pins `GITHUB_SHA` to main's tip at run creation,
which can be newer than the dispatched candidate, so authorize's
`expected_sha == GITHUB_SHA` check fails. PR **#704**
(`fix/deploy-dispatch-pin-race`, open, mergeable but currently BLOCKED) pins
the dispatched candidate instead of the run head. These failures are the
race, not a pipeline stall — a later green run landed the same or newer
main within hours, and the pipeline self-heals on the next tick by design.

## Evidence sources

- `gh run list --workflow deploy-production.yml` / `gh run view <id>` —
  conclusions, SHAs, job logs above.
- `gh api repos/Nishfleet/0509/deployments` — production deployment records,
  including 18:24:41Z for `2b91842b` (today).
- `/home/nish/workspaces/agent-state/lanes/auto-deploy.log` — dispatcher
  per-tick record (`NOTIFY: shipped … all gates green`, the `could not be
  identified` failures, and the 08-12 07:56Z ship of the item's own commit).
- Prior lane evidence commit `21d4f8fd` (#709), which documented the same
  verdict with the 08-12/08-13 run table; this record re-verifies live and
  extends through 08-14.
- Current `origin/main` is `b21cc135` (`blitz: capture MagicBrief wind-down
  buyers …` #643), fetched live; deploy run `31834020097` for that exact
  commit is queued on the `vps-verify` runner pool (all three online, busy).

## Files

- `.lane/reports/report-lane1-prod-deploy-stalled-already-resolved-reverify.md` —
  evidence record only; no product code touched.
