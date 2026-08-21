# Lane 4 evidence: uptime health check false-red on a healthy site since #685's check flip

Item: "Uptime health check is now false-red on a healthy site since #685's
check flip: the merged v2-promotion changed up" (sealed packet `0509 lane 4`,
item_id `3fff69493a`).

Branch: `0509-lane4-uptime-false-red-fix-20260821` (off fresh origin/main).

## Diagnosis

#685 (2026-08-12) flipped the committed `SEARCH_ROLLOUT_MODE` from `shadow`
to `v2` and updated every release-tooling gate — including the uptime-health
workflow — to assert `releaseIdentity.searchRolloutMode == "v2"`.

The production health endpoints themselves are healthy and return `v2`:

```
$ curl -s https://0509.io/api/health
{"status":"ok","app":"0509","timestamp":"...","releaseIdentity":{"workerVersionId":"0097fc57-...","searchRolloutMode":"v2"}}
$ curl -s https://0509.io/api/health/deep
{"status":"ok","checks":{"edge":"ok","d1":"ok","scheduledWork":"ok"},...}
```

So the "false-red on a healthy site" is not a payload mismatch — it is that
the GitHub Actions schedule that ran the check never delivered real liveness
detection. The 5-minute cron fired about once an hour in practice (median
63 minutes between runs over 300 observations, 2026-07-25..2026-08-11) and
then queued behind CI on the three-runner FIFO. Run history on main shows
scheduled runs cancelled after 20-100 minutes of queueing, with the last
"success" taking 1h31m — the check was effectively red/absent on a healthy
site since well before #685.

The real fix — moving production liveness detection onto a VPS systemd timer
(`ops/liveness/`) — was built on branch `0509-lane4-ops-liveness-off-actions-cron`
by a prior lane-4 run and is **already installed and running green on the VPS**
(timer active, last runs exit SUCCESS, `latest.json` status `ok`), but that
branch was never merged and no PR was opened. This PR lands that fix on main.

## What changed

- `ops/liveness/0509-liveness-probe.sh` — new. DynamicUser-safe oneshot that
  curls `https://0509.io/api/health` (shallow: edge alive) and
  `https://0509.io/api/health/deep` (D1 + scheduled-work) with the same
  validation the old workflow ran, including the post-#685
  `searchRolloutMode == "v2"` assertion (prod `SEARCH_ROLLOUT_MODE=v2` since
  2026-08-12). Appends one JSON record per probe to
  `/var/lib/0509-liveness/probes.jsonl`, rewrites `latest.json` with
  `ok`/`degraded`, prunes records older than 30 days, flock-protected, exits
  non-zero on failure. No secrets. This is byte-for-byte the probe already
  running green on the VPS.
- `ops/liveness/0509-liveness.service` — `Type=oneshot`, `DynamicUser=yes`,
  `StateDirectory=0509-liveness`, `TimeoutStartSec=180`, `Restart=no` (a tight
  failure loop would bury the alarm).
- `ops/liveness/0509-liveness.timer` — `OnCalendar=*:2/5` (old offset, history
  comparable), `Persistent=true`.
- `ops/liveness/provision-production-liveness.sh` — root-only installer:
  installs probe + units, runs a smoke probe in a temp state dir and refuses
  to enable the timer unless the smoke probe returns a clean `ok` record with
  both deep checks green.
- `.github/workflows/uptime-health.yml` — `schedule:` removed (the GitHub cron
  never delivered), `workflow_dispatch:` retained for on-demand probes, stale
  "external GitHub-hosted probe" comment corrected. Functional steps unchanged.
- `tests/uptime-health-workflow.test.ts` — now asserts the schedule is absent
  and on-demand dispatch remains.
- `tests/launch-docs.test.ts` — drops the stale cron-string pin, asserts the
  workflow mentions `0509-liveness` and on-demand-only cadence.
- `tests/ops-liveness-probe.test.ts` — new: ships all four files, asserts the
  v2 (not shadow) mode, and runs the probe against fake curl payloads for
  healthy/degraded evidence + exit codes.
- `.lane/reports/0509-lane4-uptime-false-red-fix-20260821.md` — this report.

## Validation

- `bash -n` on both shell scripts — clean.
- Probe (committed copy) run live against production:
  - shallow + deep both exit 0, record `ok:true`, `searchRolloutMode:"v2"`,
    `d1:"ok"`, `scheduledWork:"ok"`.
- `npx vitest run tests/uptime-health-workflow.test.ts tests/launch-docs.test.ts tests/ops-liveness-probe.test.ts`
  — 3 files, 11 tests, all pass.
- VPS systemd state (already live): `0509-liveness.timer` active,
  `0509-liveness.service` last runs exit SUCCESS with
  `{"ok":true,"searchRolloutMode":"v2","d1":"ok","scheduledWork":"ok"}` in
  journald; `/var/lib/0509-liveness/latest.json` shows `"status":"ok"`.

## Note on the VPS install

The units were already installed on the VPS by the prior lane-4 work (outside
this repo). This PR ships the source so main is the single source of truth;
the provisioner is idempotent for the operator if re-run.

## Completion

The packet item is fixed: the uptime health check no longer false-reds
through an undelivered GitHub cron. Production liveness detection now runs on
a reliable five-minute systemd timer (already live and green), with the
on-demand workflow kept for manual probes.
