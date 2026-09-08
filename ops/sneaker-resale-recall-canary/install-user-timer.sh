#!/usr/bin/env bash
#
# Install the 0509 sneaker-resale seed-list recall canary as a systemd USER
# timer on the fleet VPS (no root needed — the check needs no secrets, only
# outbound HTTPS to 0509.io).
#
# Run as nish on the VPS:  ops/sneaker-resale-recall-canary/install-user-timer.sh
#
# Installs:
#   ~/.config/systemd/user/0509-sneaker-resale-recall-canary.service
#   ~/.config/systemd/user/0509-sneaker-resale-recall-canary.timer  (every 3h)
# Evidence:
#   ~/workspaces/agent-state/cron-output/0509-sneaker-resale-recall-canary.log
#
# The canary script itself lives in the repo (scripts/canary-sneaker-resale-recall.mjs,
# npm run canary:sneaker-resale-recall) and runs from the standing products
# checkout at /home/nish/workspaces/products/0509 — pull that repo after the
# canary PR merges so the timer runs the merged script.

set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
fi

readonly SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly UNIT_DIR="${HOME}/.config/systemd/user"
readonly LOG_DIR="${HOME}/workspaces/agent-state/cron-output"
readonly REPO_DIR="${HOME}/workspaces/products/0509"
readonly UNIT_BASE="0509-sneaker-resale-recall-canary"

[[ -d "${REPO_DIR}/scripts" ]] || { echo "products checkout missing: ${REPO_DIR}" >&2; exit 1; }
[[ -f "${REPO_DIR}/scripts/canary-sneaker-resale-recall.mjs" ]] || {
  echo "canary script missing in ${REPO_DIR} — pull main after the PR merges" >&2;
  exit 1;
}

install -d -m 0755 "${UNIT_DIR}" "${LOG_DIR}"
install -m 0644 "${SOURCE_DIR}/${UNIT_BASE}.user.service" "${UNIT_DIR}/${UNIT_BASE}.service"
install -m 0644 "${SOURCE_DIR}/${UNIT_BASE}.user.timer" "${UNIT_DIR}/${UNIT_BASE}.timer"

systemctl --user daemon-reload
systemctl --user enable --now "${UNIT_BASE}.timer"

# Smoke: run the service once now and require a clean run. A red canary on an
# unfixed production is expected pre-deploy — the installer reports the verdict
# either way so the operator sees the live truth, but only a unit that RAN
# (exit 0 or 1, never 2/crash) counts as installed correctly.
echo "smoke: running ${UNIT_BASE}.service once..."
if systemctl --user start "${UNIT_BASE}.service"; then
  echo "smoke: PASS (production returns rows / no dead-ends for the seed-list set)"
else
  status=$(systemctl --user show "${UNIT_BASE}.service" -p ExecMainStatus --value)
  if [[ "${status}" == "1" ]]; then
    echo "smoke: RAN, verdict FAIL — production dead-ends ≥1 expected-coverage seed-list brand (expected until the fix deploys); detector is live"
  else
    echo "smoke: FAILED to run (ExecMainStatus=${status}) — check ${LOG_DIR}/${UNIT_BASE}.log" >&2
    exit 1
  fi
fi

systemctl --user list-timers --no-pager | grep "sneaker-resale" || true