## What and why

The daily market-signal D1 snapshot went stale >26h on 2026-09-06 with no alert. Root cause: the snapshot workflow shared the `0509-production-provider-mutations` concurrency group with `deploy-production.yml`. A deploy at 04:28Z kept the group busy, the 04:29Z scheduled snapshot queued, and the next deploy entry cancelled the pending snapshot (deploy-production uses the default `queue: single`, which cancels older pending runs in the group).

This PR fixes the root cause and adds a monitor so a missed daily run is never silent.

## Changes

- **Give the snapshot its own concurrency group** (`market-signal-snapshot`, `cancel-in-progress: false`) so deploy churn can never cancel a queued snapshot again. A no-op unchanged snapshot still exits 0, so a queued rerun is harmless.
- **Add `scripts/check-d1-snapshot-age.sh`** — the issue's termination condition. It fetches the published snapshot from the private telemetry sink (`Nishfleet/0509-telemetry`, branch `automation/market-signal-snapshot`) and exits non-zero when `generatedAt` age exceeds the threshold (default 24h). Supports `--snapshot-file` for offline testing and `--max-age-hours` to force the stale path.
- **Add the `market-signal-snapshot-age` monitor workflow** — runs every 6h, files a `market-signal-stale` issue when the snapshot is stale/missing and closes it on recovery, so a missed daily run is never silent.
- **Add tests** covering the age logic (fresh/stale/missing/invalid/future/offset) and the workflow structure (schedule, permissions, concurrency group).

## Acceptance

- Identify why the scheduled workflow did not run on 2026-09-06: the concurrency-group conflict with deploy-production (documented in the workflow comment).
- Add a monitor/alert that fires if snapshot age exceeds 24h: the `market-signal-snapshot-age` monitor + `check-d1-snapshot-age.sh`.
- Ensure workflow runs reliably daily: the snapshot now has its own concurrency group.

## Verification

Termination condition run locally (fresh snapshot, expect exit 0):

```
$ scripts/check-d1-snapshot-age.sh --snapshot-file <fresh.json> --max-age-hours 24
market_signal_snapshot_fresh generatedAt=2026-09-07T07:18:38Z age=2.00h threshold=24h
exit=0
```

Stale path (threshold forced to 0, expect exit 1 — the alert condition):

```
$ scripts/check-d1-snapshot-age.sh --snapshot-file <fresh.json> --max-age-hours 0
market_signal_snapshot_stale: generatedAt=2026-09-07T07:18:38Z age=2.00h threshold=0h
exit=1
```

run-proof: `scripts/check-d1-snapshot-age.sh` fresh path exits 0 and stale path exits 1 (real local runs above); `npx vitest run --project node tests/check-d1-snapshot-age.test.ts` → 10/10 passed; full node project 599 files / 7130 tests passed; workers project 31 files / 156 tests passed; `npm run typecheck` and `npm run build` pass; `sgscan` → no new security findings.

net-positive-because: adds a durable monitor + termination-condition script that closes the stale-snapshot gap (issue #1894); the added lines are the detector and its tests, not machinery churn.

## Review (reviewer seat: cursor/cursor-grok-4.6-high)

- **Act on:** none.
- **Consider:** (1) the monitor conflates "snapshot stale" with "could not fetch snapshot" (both exit 1 → file a `market-signal-stale` issue); a transient fetch failure or rotated deploy key would false-alarm, but it self-heals on the next 6h run. (2) `gh issue list` only handles the first open stale issue; a multi-day outage could accumulate several. (3) `--max-age-hours` with no value errors unhelpfully under `set -u`. (4) the https fallback fetch is a dead path for a private repo without a credential helper. (5) `environment: production` on the scheduled monitor — fine today, worth confirming no required-reviewer protection rule is added.
- **Noted:** root-cause comment verified accurate (deploy-production.yml has no `queue:` key → default `queue: single` cancels older pending runs in the shared group); monitor reuses the write-enabled deploy key for read (read is lower privilege); monitor files an issue but the run stays green (intentional, avoids double-alerting).
- **Dismissed-with-reason:** removal of `queue: max` (own group makes default `queue: single` fine); tests don't exercise the network fetch path (network/credential-dependent; the age logic is fully covered via `--snapshot-file`); actionlint warnings on `market-signal-snapshot.yml` are pre-existing (`runner.environment` in setup-node), not introduced by this diff.

Closes #1894
