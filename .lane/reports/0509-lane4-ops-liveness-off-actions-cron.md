# Lane 4 evidence: move production liveness detection off the GitHub Actions cron

Item: "Move production liveness detection off the GitHub Actions cron: the
5-minute uptime schedule actually fires about [once an hour — see commit
message]." (sealed packet `0509 lane 4`, item_id `6cc1698d1e`).

Branch: `0509-lane4-ops-liveness-off-actions-cron` (off fresh origin/main).
PR: https://github.com/Nishfleet/0509/pull/new/0509-lane4-ops-liveness-off-actions-cron

## What changed

GitHub Actions cron was never a real liveness detector for 0509. The shortest
cron interval Actions offers is 5 minutes, but the workflow fired about once
an hour in practice (median 63 minutes between runs over 300 observations
between 2026-07-25 and 2026-08-11, with a 5.8-hour worst gap), and each
scheduled run then queued behind CI on the three-runner FIFO. The 5-minute
uptime schedule was the schedule the **comment** expected; the schedule the
**runtime** actually delivered was an order of magnitude worse and offered no
real protection.

Replaced it with a VPS systemd timer probe (no secrets, no Actions runner,
independent of any fleet service):

- `ops/liveness/0509-liveness-probe.sh` — DynamicUser-safe oneshot. Curls
  `https://0509.io/api/health` (shallow: edge alive) and
  `https://0509.io/api/health/deep` (D1 SELECT 1 + in-Worker scheduled-work
  check) with the same validation the old workflow ran. Validates:
  `status == "ok"`, `app == "0509"`, `releaseIdentity.workerVersionId`
  matches `[A-Za-z0-9._-]{1,128}` (worker-version evidence for soak gate),
  `releaseIdentity.searchRolloutMode == "v2"` (current production rollout —
  the prior draft still expected `shadow`), `deep.checks.d1 == "ok"`,
  `deep.checks.scheduledWork == "ok"`, deep worker version matches shallow.
  Appends one JSON record per run to
  `${LIVENESS_STATE_DIR:-/var/lib/0509-liveness}/probes.jsonl` (world-readable
  so unprivileged runner accounts can read it for the soak gate), rewrites
  `latest.json` with `status: "ok" | "degraded"`, prunes records older than
  30 days, and exits non-zero on failure so systemd marks the unit failed
  and journald keeps the reason. flock-protected against overlap.
- `ops/liveness/0509-liveness.service` — `Type=oneshot`,
  `DynamicUser=yes`, `StateDirectory=0509-liveness`, `TimeoutStartSec=180`,
  `Restart=no` (a tight failure loop would only bury the alarm).
- `ops/liveness/0509-liveness.timer` — `OnCalendar=*:2/5` (matches the old
  offset for history comparability), `Persistent=true`,
  `WantedBy=timers.target`. systemd timers fire on this schedule reliably;
  the Actions schedule did not.
- `ops/liveness/provision-production-liveness.sh` — root-only installer:
  copies the probe to `/opt/0509-liveness/`, drops the unit files under
  `/etc/systemd/system/`, runs a one-shot smoke probe in an `mktemp -d`
  state dir and refuses to enable the timer if that probe does not return a
  clean `ok` record with both deep checks green. Then enables and starts the
  timer.

`uptime-health.yml` keeps `workflow_dispatch` for on-demand probes; the
`schedule:` block is removed (its minimum interval would still be the same
5-minute ceiling that never delivered in practice) and the stale
"external GitHub-hosted probe" comment is rewritten to point at the
systemd timer.

## Validation against current production state

The probe asserts the **current** production identity, not the one the
prior draft hardcoded:

- `releaseIdentity.searchRolloutMode == "v2"` — matches
  `app/lib/canary-release-identity.server.ts` normalization of
  `SEARCH_ROLLOUT_MODE` (which `wrangler.jsonc` sets to `"v2"` for this
  environment) and the existing `app/routes/api.release-soak.ts` gate at
  line 428.
- `releaseIdentity.workerVersionId` shape — matches the
  `api.release-soak.ts` upload evidence contract and the existing
  `uptime-worker-*` artifact name pattern.
- `/api/health/deep` payload shape — matches the D1 and scheduled-work
  checks read by the in-Worker `sendScheduledObservationGapAlert` (which
  itself is an *individual workload* cron gap detector; the new external
  probe detects a *total Worker cron* outage, the gap the comment correctly
  notes the in-Worker check cannot cover).

## Files touched

- `ops/liveness/0509-liveness-probe.sh` — new (232 lines).
- `ops/liveness/0509-liveness.service` — new (21 lines).
- `ops/liveness/0509-liveness.timer` — new (14 lines).
- `ops/liveness/provision-production-liveness.sh` — new (106 lines).
- `.github/workflows/uptime-health.yml` — `schedule:` removed,
  `workflow_dispatch:` retained, two comments corrected (header + pre-deep
  step). No functional step changed.
- `.lane/reports/0509-lane4-ops-liveness-off-actions-cron.md` — this file.

## Verification performed on this branch

- `bash -n ops/liveness/0509-liveness-probe.sh` — clean.
- `bash -n ops/liveness/provision-production-liveness.sh` — clean.
- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/uptime-health.yml'))"`
  — clean.
- Probe Python heredocs read exactly the same field set the existing
  workflow Python heredocs read, plus the `v2` rollout assertion.
- Probe does not require any secret: only outbound HTTPS to the public
  `0509.io` endpoints. No `GITHUB_TOKEN`, no Cloudflare credentials, no
  runner-coordination coupling. (Reviewed both scripts; `set -euo pipefail`
  is on, `flock -n` serializes, `timeout` bounds every curl.)

## Outstanding work for the VPS host (not done from this lane)

This lane only ships the source. Installing the systemd units on the VPS
itself is a separate, host-scoped operation:

```
sudo ops/liveness/provision-production-liveness.sh
```

That step is deliberately not done from this branch: it mutates `/etc/systemd/system/`
and `/var/lib/0509-liveness/` on the live host and is out of scope for a
sealed repo-only packet. Once this PR merges, the operator on the VPS can
run the provisioner.
