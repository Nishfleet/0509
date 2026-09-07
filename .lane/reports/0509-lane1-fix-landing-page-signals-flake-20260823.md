# Lane evidence — fix landing-page-signals test flake

**Branch:** `0509-lane1-fix-landing-page-signals-flake-20260823`

## Change

Raised the `smallDuration` floor in two performance-ratio assertions in `tests/landing-page-signals.test.ts` from `0.1` ms to `0.5` ms:

- `keeps malformed quoted-tag scanning near-linear`
- `does not rescan overlapping windows of repeated malformed tags`

This prevents the `largeDuration / Math.max(smallDuration, floor)` ratio from destabilizing on the self-hosted runner when `smallDuration` falls below 0.1 ms (failure seen in deploy-production run 32542387000: `11.23 > 10`).

## Verification

```bash
scripts/deploy-window-lock.sh run -- npx vitest run tests/landing-page-signals.test.ts --configLoader runner
# Test Files  1 passed (1)
# Tests  55 passed (55)

scripts/deploy-window-lock.sh run -- npm run typecheck
# exit 0, no error TS lines

scripts/deploy-window-lock.sh run -- npm run test
# exit 1 locally — 27 failures in workspace-seats, monitoring-fanout, monitoring-evidence-lifecycle (SQLite "column index out of range"); unrelated to this diff. origin/main CI run 32624146763 completed success.
```

## Pre-check

- `https://0509.io/pricing` returned HTTP 404 at start of work (pricing route merged in PR #892 but not yet deployed).

## Next steps (out of lane scope for builder)

- Independent review + merge
- `scripts/dispatch-deploy-production.sh` after merge
- Confirm `/pricing` returns 200 post-deploy
