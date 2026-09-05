#!/usr/bin/env bash
#
# Install the 0509 search tier canary as a systemd USER timer on the fleet
# VPS (no root needed — the check needs no secrets, only outbound HTTPS).
#
# Run as nish on the VPS:  ops/search-tier-canary/install-user-timer.sh
#
# Installs:
#   ~/.config/systemd/user/0509-search-tier-canary.service
#   ~/.config/systemd/user/0509-search-tier-canary.timer   (daily 06:10 IST)
# Evidence:
#   ~/workspaces/agent-state/cron-output/0509-search-tier-canary.log
#
# The canary script itself lives in the repo (scripts/search-tier-canary.mjs,
# npm run canary:search-tier) and runs from the standing products checkout at
# /home/nish/workspaces/products/0509 — pull that repo after the canary PR
# merges so the timer runs the merged script.

set -euo pipefail

readonly SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly UNIT_DIR="${HOME}/.config/systemd/user"
readonly LOG_DIR="${HOME}/workspaces/agent-state/cron-output"
readonly REPO_DIR="${HOME}/workspaces/products/0509"

[[ -d "${REPO_DIR}/scripts" ]] || { echo "products checkout missing: ${REPO_DIR}" >&2; exit 1; }
[[ -f "${REPO_DIR}/scripts/search-tier-canary.mjs" ]] || {
  echo "canary script missing in ${REPO_DIR} — pull main after the PR merges" >&2;
  exit 1;
}

install -d -m 0755 "${UNIT_DIR}" "${LOG_DIR}"
install -m 0644 "${SOURCE_DIR}/0509-search-tier-canary.user.service" "${UNIT_DIR}/0509-search-tier-canary.service"
install -m 0644 "${SOURCE_DIR}/0509-search-tier-canary.user.timer" "${UNIT_DIR}/0509-search-tier-canary.timer"

systemctl --user daemon-reload
systemctl --user enable --now 0509-search-tier-canary.timer

# Smoke: run the service once now and require a clean exit. A red canary on
# an unfixed production is expected pre-deploy — the installer reports the
# verdict either way so the operator sees the live truth, but only a unit
# that RAN (exit 0 or 1, never 2/crash) counts as installed correctly.
echo "smoke: running 0509-search-tier-canary.service once..."
if systemctl --user start 0509-search-tier-canary.service; then
  echo "smoke: PASS (production currently returns tier rows for all six domains)"
else
  status=$(systemctl --user show 0509-search-tier-canary.service -p ExecMainStatus --value)
  if [[ "${status}" == "1" ]]; then
    echo "smoke: RAN, verdict FAIL — production dead-ends ≥1 domain (expected until the fix deploys); detector is live"
  else
    echo "smoke: FAILED to run (ExecMainStatus=${status}) — check ${LOG_DIR}/0509-search-tier-canary.log" >&2
    exit 1
  fi
fi

systemctl --user list-timers --no-pager | grep search-tier || true
