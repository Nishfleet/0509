#!/usr/bin/env bash
#
# Install the 0509 production liveness probe on the fleet VPS.
#
# The probe replaces the GitHub Actions cron as the production liveness
# detector: GitHub's shortest cron interval is five minutes, but in practice
# this repo's 5-minute schedule fired about once an hour (median 63 minutes
# between runs over 300 observations, 2026-07-25..2026-08-11), and each
# scheduled job then competed with CI for the three-runner FIFO. A systemd
# timer on this host fires on the exact offset five-minute cadence, outside
# Actions entirely, and the evidence it writes is what the release-soak
# finalizer verifies.
#
# Run as root on the VPS:  sudo ops/liveness/provision-production-liveness.sh
#
# Installs:
#   /opt/0509-liveness/0509-liveness-probe.sh          (the probe)
#   /etc/systemd/system/0509-liveness.service          (DynamicUser oneshot)
#   /etc/systemd/system/0509-liveness.timer            (five-minute cadence)
# Evidence:
#   /var/lib/0509-liveness/probes.jsonl                (one JSON record per probe)
#   /var/lib/0509-liveness/latest.json                 ("ok" or "degraded" marker)
#
# The probe itself uses no secrets: it only curls the public health endpoints
# with the same validation the old scheduled workflow ran. Runner accounts on
# this host can read the evidence (world-readable), which is how the exact-
# worker soak gate verifies a deployment from an unprivileged CI job.

set -euo pipefail

readonly INSTALL_ROOT="/opt/0509-liveness"
readonly SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

die() {
  printf 'liveness provisioning error: %s\n' "$*" >&2
  exit 1
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || die "run as root"
}

install_files() {
  install -d -o root -g root -m 0755 "${INSTALL_ROOT}"
  install -o root -g root -m 0755 \
    "${SOURCE_DIR}/0509-liveness-probe.sh" \
    "${INSTALL_ROOT}/0509-liveness-probe.sh"
  install -o root -g root -m 0644 \
    "${SOURCE_DIR}/0509-liveness.service" \
    /etc/systemd/system/0509-liveness.service
  install -o root -g root -m 0644 \
    "${SOURCE_DIR}/0509-liveness.timer" \
    /etc/systemd/system/0509-liveness.timer
  systemctl daemon-reload
}

smoke_dir=""
cleanup_smoke() {
  [[ -n "${smoke_dir}" ]] && rm -rf -- "${smoke_dir}"
}
trap cleanup_smoke EXIT

smoke_probe() {
  # Run the probe once as the service would (dynamic user, fresh state dir) and
  # require a clean exit. LIVENESS_STATE_DIR override keeps the smoke probe's
  # evidence separate from the live stream.
  smoke_dir="$(mktemp -d -t 0509-liveness-smoke.XXXXXX)"
  if ! LIVENESS_STATE_DIR="${smoke_dir}" \
    "${INSTALL_ROOT}/0509-liveness-probe.sh"; then
    die "smoke probe failed; refusing to enable the timer (see journalctl -u 0509-liveness.service)"
  fi
  [[ -s "${smoke_dir}/probes.jsonl" ]] || die "smoke probe wrote no evidence"
  python3 - "${smoke_dir}/probes.jsonl" <<'PY' || die "smoke probe evidence invalid"
import json
import os
import re
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    record = json.loads(source.readline())
if record.get("ok") is not True:
    raise SystemExit("smoke probe record was not ok")
if record.get("workerVersionId") != os.environ.get("EXPECTED_SMOKE_VERSION", record.get("workerVersionId")):
    raise SystemExit("smoke probe record had no worker version")
if not re.fullmatch(r"[A-Za-z0-9._-]{1,128}", record.get("workerVersionId") or ""):
    raise SystemExit("smoke probe worker version was unsafe")
if record.get("d1") != "ok" or record.get("scheduledWork") != "ok":
    raise SystemExit("smoke probe deep checks were not ok")
PY
}

verify_timer() {
  local state
  state="$(systemctl is-active 0509-liveness.timer)" || die "timer is not active"
  [[ "${state}" == "active" ]] || die "timer state was ${state}, expected active"
  systemctl show 0509-liveness.timer --property=NextElapseOnRealTimeUTC --value
}

main() {
  require_root
  install_files
  smoke_probe
  systemctl enable --now 0509-liveness.timer
  verify_timer
  printf '0509 liveness probe installed and scheduled every five minutes.\n'
  printf 'Evidence: /var/lib/0509-liveness/probes.jsonl\n'
  printf 'Inspect:  journalctl -u 0509-liveness.service\n'
}

main "$@"
