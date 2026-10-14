# Evals failed on the repository token and nobody was told (2026-10-14)

## What customers saw

Nothing. The evals measure Jev quality before changes ship, so for a week no change had a fresh quality number.

## Start and end (UTC)

Last real pass: 2026-10-07 07:07 (run 37585428258, `read-this-first`, score 0.75). First real fail: 2026-10-14 08:34 (run 38536095970). The 2026-10-09 failure (run 37925513454) was a deliberate no-match filter probe, not an outage. Open until the token below is replaced.

## Root cause

Not yet proven. Known: the workflow, harness, wrangler version (4.144.0) and `wrangler.jsonc` AI binding are identical between the passing and the failing run. The failing run passes the daily-neuron GraphQL read, then wrangler's remote Workers AI session is refused: `/accounts/***/workers/subdomain/edge-preview`, 403, code 10000. So the repository secret `CLOUDFLARE_API_TOKEN` still has Account Analytics read and lost, or never had in its current value, the Workers permission that opens a remote session. `deploy-production.yml` and `e2e-scheduled.yml` use the same secret name but declare an `environment`, whose own secret of that name wins, and they still succeed. `evals.yml` declares none, so it reads the repository-level value, the one that changed. Proof needed from Nish: the repository secret's token permissions.

## How it was detected

By hand, on 2026-10-14, when a dispatched run for #7483 went red. `evals.yml` was dispatch-only and opened nothing on failure, so a red run reached only whoever clicked.

## The fix

A token named `0509 evals` (Cloudflare, scoped to this account) with Account Analytics: Read, Workers Scripts: Edit and Workers AI: Read, stored as the repository secret `CLOUDFLARE_API_TOKEN`. The alert change is in this PR.

## What stops a repeat

1. `evals.yml` runs weekly (Monday 06:17) on `read-this-first`, capped at 2,000 neurons and refused by the daily ceiling, and on any failure opens or updates the issue from `.github/red-main/evals.md`. A broken token now shows within a week.
