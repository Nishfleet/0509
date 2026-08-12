# Daily market-signal D1 snapshot restore (five days stale)

**Status: implemented; full Vitest green; PR open, not merged.**

Branch: `fix/restore-market-signal-d1-snapshot`
Base: `origin/main` at `d109e2d2`
Pull request: https://github.com/nish3451/0509/pull/586 (opened by this lane)

## Item

- [ ] Restore the daily market-signal D1 snapshot so commercial dogfood is not
  five days stale [scout 2026-08-09].

## Problem

The daily 0509 market-signal snapshot has been stale since 2026-08-05. The
Hermes host cron (`hostinger-kvm4`) drives `npm run signal:market`, which runs
`wrangler d1 execute 0509 --remote`. The host's wrangler OAuth session expired
2026-08-04T13:26:24Z and no `CLOUDFLARE_API_TOKEN` exists in the cron
environment, so every non-interactive run fails. PR #557 (merged 2026-08-09)
made that failure self-diagnosing (`market_signal_auth_required`) but did not
restore generation: the host still cannot authenticate, and a git lane cannot
repair a host credential.

## Fix

Move snapshot generation to a scheduled GitHub Actions workflow that uses the
repository's `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets on a
`production`-environment GitHub-hosted runner — the same proven pattern as the
nightly `d1-backup-r2.yml` and `d1-remote-restore-evidence.yml` jobs — and
commit the snapshot to `ops/market-signal/0509-market-signal.json` on `main`.

- `.github/workflows/market-signal-snapshot.yml` — daily `7 0 * * *` (00:07 UTC
  / 05:37 IST, before the morning Hermes report and outside the 20:07/20:47 UTC
  provider-mutation windows) plus `workflow_dispatch` for an immediate restore.
  `npm ci` and `npm run signal:market` are lane-wrapped through
  `deploy-window-lock.sh run --`, and a freshness gate verifies `generatedAt`
  before the commit step pushes (no-op when unchanged). Manual dispatches are
  gated to `refs/heads/main`; the snapshot commit is a plain `git push origin
  HEAD:main` — main is unprotected, no workflow in the repo triggers on push to
  main, so a snapshot commit cannot cascade CI or deploys.
- `automation/HERMES_MARKET_SIGNAL.md` — the host no longer runs wrangler at
  all. Hermes reads the committed snapshot from the synced checkout and, if the
  file is missing or `generatedAt` is older than 26 hours, reports the D1
  source as unavailable instead of presenting stale counts as current (the
  workflow fails loudly on auth/query failure, so a stale committed file means
  the morning run did not happen). Manual host-side generation remains a
  documented fallback only.
- `tests/market-signal-workflow.test.ts` — locks the schedule, the
  production-environment/secret placement, the lane wrapping, the snapshot path
  parity between workflow and Hermes contract, and the stale-snapshot honesty
  rule.

## Verification

- Full Vitest on this tip: 424 files, 4854/4854 passed (includes the new
  `market-signal-workflow` suite and the global `workflow-routing-hardening` /
  `workflow-startup-safety` / `self-hosted-node-cache-workflows` invariants
  applied to the new workflow file).
- Workflow wiring exercised locally: `deploy-window-lock.sh run -- npm run
  signal:market -- --output <path>` resolves args correctly and, with no
  Cloudflare credential present, exits with the single greppable
  `market_signal_auth_required` classifier and writes no file. In CI the same
  command runs with `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` set, which is
  the exact combination the broken host cron lacked.
- `git diff --check`: clean.

## Post-merge restore

The next scheduled run (or a manual `workflow_dispatch` on `main`) produces a
fresh snapshot immediately; Hermes consumes it from `ops/market-signal/` with
no host Cloudflare credential required.
