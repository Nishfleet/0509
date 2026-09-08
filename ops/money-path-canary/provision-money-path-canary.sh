#!/usr/bin/env bash
#
# Install the 0509 money-path availability canary on the fleet VPS (issue
# #2001), following the 0509-search-h1-guard provisioning pattern.
#
# Run as root on the VPS:  sudo ops/money-path-canary/provision-money-path-canary.sh
#
# Installs:
#   /opt/0509-money-path-canary/0509-money-path-canary-run.sh   (the runner)
#   /etc/systemd/system/0509-money-path-canary.service
#   /etc/systemd/system/0509-money-path-canary.timer
# and enables the timer. The canary scripts live in the repo and run from
# the standing products checkout at /home/nish/workspaces/products/0509 —
# pull that checkout after the canary PR merges so the timer runs the
# merged scripts.

set -euo pipefail

readonly SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly CHECKOUT="/home/nish/workspaces/products/0509"

[[ -f "${CHECKOUT}/scripts/search-latency-probe.mjs" ]] || {
  echo "probe script missing in ${CHECKOUT} — pull main after the PR merges" >&2
  exit 1
}
[[ -f "${CHECKOUT}/scripts/search-latency-regression-guard.mjs" ]] || {
  echo "guard script missing in ${CHECKOUT} — pull main after the PR merges" >&2
  exit 1
}

install -d -m 0755 /opt/0509-money-path-canary
install -m 0755 "${SOURCE_DIR}/0509-money-path-canary-run.sh" /opt/0509-money-path-canary/0509-money-path-canary-run.sh
install -m 0644 "${SOURCE_DIR}/0509-money-path-canary.service" /etc/systemd/system/0509-money-path-canary.service
install -m 0644 "${SOURCE_DIR}/0509-money-path-canary.timer" /etc/systemd/system/0509-money-path-canary.timer

systemctl daemon-reload
systemctl enable --now 0509-money-path-canary.timer

echo "money-path canary timer enabled (every 5 minutes)."
