# Production deploy dispatch — 2026-08-09

## Dispatch

- **Workflow**: `.github/workflows/deploy-production.yml` (`Deploy production`)
- **Run**: https://github.com/nish3451/0509/actions/runs/31298895978
- **Event**: `workflow_dispatch`
- **Ref**: `refs/heads/main`
- **`expected_sha`**: `25392ca2ae77dbf48f7e7df80337fb1be8c3677c` (current `origin/main`)
- **`backup_proof_status`**: `required`
- **`deferred_backup_authorization`**: empty

## Why a dispatch was needed

A prior dispatch for `d863fd18` (run 31297786931) was aborted at the provider-main
CAS gate with `provider_main_cas_invalid: remote_main_drift` — `main` moved to
`25392ca2` while that deploy ran. The workflow fails closed by design, so the fix
is to re-dispatch against the current main tip, which this run does.

## Customer fixes leaving the queue with this deploy

- #548 — brand pages stop claiming "right now"/"live" on stale captures
- #547 — lease waiter no longer blocks the first anonymous query for an uncached advertiser
- #546 — digest named owner, materiality reason, and next action on every brief

## Result

To be appended once the deploy run reaches a conclusion.
