# Production deploy stall — already resolved (2026-08-14 lane 1)

**Status: resolved; stale premise — evidence record only, no product code touched.**

Branch: `report/lane1-prod-deploy-stalled-already-resolved`
Base: `origin/main` at `7b7a87db`

## Item

- [ ] Production has not received ANY merged code since the last successful
  deploy (01:58:29Z dispatch → worker e3ba940b)

## Verdict

The premise is stale. Production has received merged code repeatedly since
the `01:58:29Z` deploy the item names. The auto-deploy pipeline
(`auto-deploy.py`, hourly tick on the VPS, dispatching
`.github/workflows/deploy-production.yml`) kept shipping: six further
successful deploys landed between 2026-08-12 21:36Z and 2026-08-13 20:59Z,
all verified by GitHub run conclusion, deployment records, the dispatcher's
`NOTIFY: shipped ... all gates green` lines, and wrangler's published
version IDs. The item was evidently generated during the outage cluster
between those two timestamps (billing block, runner starvation, and the
dispatch pin race — see below) and has since been overtaken by events.

## Timeline of successful deploys since the named one

| Run (created Z) | Conclusion | Candidate | Dispatcher log (IST) | Notes |
|---|---|---|---|---|
| 95ab1858 `2026-08-12 01:58:29Z` | success | `95ab1858` | — | the item's "last successful deploy" (worker `e3ba940b`) |
| 31643328467 `2026-08-12 21:36:51Z` | success | `aa019c47` | 08-13 04:23 `synced last-good to aa019c47` | 08-12 failures: billing block, runner starvation |
| 31665620284 `2026-08-13 04:00:08Z` | success | `fbe22514` | 08-13 10:24 `shipped 7 change(s), all gates green` | |
| 31689141791 `2026-08-13 10:00:11Z` | success | `164c3bbc` | 08-13 16:05 `shipped 4 change(s), all gates green` | deployment record 10:01:07Z |
| 31700562935 `2026-08-13 12:32:59Z` | success | `afc1e687` | 08-13 18:42 `shipped 1 change(s), all gates green` | deployment record 12:37:51Z |
| 31736848625 `2026-08-13 19:38:28Z` | success | `bceec022` | 08-14 02:23 `synced last-good to bceec022` | deployment record 20:16:26Z |
| 31743533734 `2026-08-13 20:58:54Z` | success | `07481600` | 08-14 03:04 `shipped 1 change(s), all gates green` | deployed version `38686986-2de7-4522-8b6d-c61f3ad896f8`; deployment records 20:58–22:14Z |

Every row after the first is a deploy of merged `main` code that the packet
claims never happened. The last named failure cluster before the recovery
(`31708906229`, `1d01031a`, Deploy Worker cancelled mid Gate-B at 14:55Z) is
followed by a clean green run on the same candidate via the next tick's
retry — the pipeline self-heals, which is the designed behavior.

## Evidence sources

- `gh run list --workflow deploy-production.yml` — conclusions and SHAs above.
- `gh api repos/Nishfleet/0509/deployments` — production deployment records at
  10:01:07Z (`164c3bbc`), 12:37:51Z (`afc1e687`), 20:16:26Z (`bceec022`),
  20:58:27Z and 22:08–22:14Z (`07481600`).
- `/home/nish/workspaces/agent-state/lanes/auto-deploy.log` — the dispatcher's
  per-tick record, including `NOTIFY: shipped N change(s) to production, all
  gates green` at 2026-08-13 10:24:41 / 16:05:16 / 18:42:10 IST and
  2026-08-14 03:04:07 IST.
- Run 31743533734 job log — `Uploaded 0509`, `Current Version ID:
  38686986-2de7-4522-8b6d-c61f3ad896f8`, rollback target recorded; the deploy
  job completed with all gates green.
- Current `origin/main` is `7b7a87db` (`chore(lane): move lane evidence to a
  per-branch report path`, #662) — a docs-only change. The dispatcher's last
  tick (2026-08-14 04:23 IST) shows it waiting on `codex-node-checks` /
  `required-verifier-integrity` before dispatching, which is the normal
  check-gate behavior, not a stall.

## Related, non-blocking

The mid-day failures the item's era produced (run 31728446004 17:59Z —
authorize `dispatch_sha_mismatch`; run 31734022041 19:04Z — pin
`provider_main_cas_invalid: remote_main_drift`) are exactly the dispatch
pin race: a `workflow_dispatch` run pins `GITHUB_SHA` to main's tip at run
creation, which can be newer than the dispatched candidate. **PR #704**
(`fix/deploy-dispatch-pin-race`, branch `fix/deploy-dispatch-pin-race`) fixes
this by pinning the dispatched candidate, not the run head; it is open,
mergeable, and green (`mergeStateStatus: CLEAN`, required checks passing).
It is not a blocker for this item — deploys succeeded despite the race — but
it removes a real failure mode that cost several hours on 2026-08-13.

## Files

- `.lane/reports/report-lane1-prod-deploy-stalled-already-resolved.md` —
  evidence record only; no product code touched.
