# Production deploy dispatch — 2026-08-10

## Dispatch

- **Workflow**: `.github/workflows/deploy-production.yml` (`Deploy production`)
- **Run**: https://github.com/Nishfleet/0509/actions/runs/31416010543
- **Event**: `workflow_dispatch`
- **Ref**: `refs/heads/main`
- **`expected_sha`**: `d109e2d2d395865898476dd42b19352526a51407` (current `origin/main`)
- **`backup_proof_status`**: `required`
- **`deferred_backup_authorization`**: empty

## Why a dispatch was needed

The last successful production deploy was run 31319791367 for `8a3b9daa`
(2026-08-09). Since then three customer fixes merged to main and are still
waiting in the deploy queue:

- #583 — keep the refine disclosure shut on a pristine /search (BL-031)
- #582 — pin undici 7.29.0
- #567 — gate public /search "right now" promise on a proven fresh-live Ad
  Library capture

Every dispatch since `5e682868` (ten runs, latest before this one:
31411238685) failed at the very first job with no steps and no logs.

## Observed blocker on this dispatch

This dispatch (31416010543) also failed at `Authorize exact production
candidate` within seconds of creation, with zero executed steps. The job
annotation is authoritative:

> The job was not started because recent account payments have failed or your
> spending limit needs to be increased. Please check the 'Billing & plans'
> section in your settings

The GitHub account is currently billing-blocked from GitHub-hosted runner
usage. Every job pinned to `ubuntu-latest` dies at job start (verified again
today on CI, Secret Scan, Review gate, and Uptime health check runs), while
the self-hosted `vps-verify` runners (netcup-rs2000-verify1/2/3) are online
and executing jobs normally. `deploy-production.yml` still pins its
authorize/pin/deploy jobs to `ubuntu-latest`, so no deploy can start until
either the account billing block lifts or the workflow is routed to the
self-hosted runners.

## Unblock path

- PR #585 (`ci/vps-verify-runners`) moves every hosted job — including all
  six jobs of `deploy-production.yml` — onto `[self-hosted, linux, x64,
  vps-verify]`. PR #581 (`chore/actions-zero-hosted-minutes`) does the same
  repo-wide. Either landing makes the dispatch gate reachable.
- Once one lands, re-dispatch against the then-current main tip with
  `backup_proof_status=required`; the three customer fixes above will leave
  the queue in that deploy.

## Result

To be appended once a deploy run reaches a conclusion.
