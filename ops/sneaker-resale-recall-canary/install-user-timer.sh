#!/usr/bin/env bash
#
# Install the 0509 sneaker-resale recall canary as a systemd USER timer on the
# fleet VPS (no root needed — the check needs no secrets, only outbound HTTPS).
#
# Run as nish on the VPS:  ops/sneaker-resale-recall-canary/install-user-timer.sh
#
# Installs:
#   ~/.config/systemd/user/0509-sneaker-resale-recall-canary.service
#   ~/.config/systemd/user/0509-sneaker-resale-recall-canary.timer   (every 3h)
# Evidence:
#   ~/workspaces/agent-state/cron-output/0509-sneaker-resale-recall-canary.log
#
# The canary script itself lives in the repo (scripts/canary-sneaker-resale-
# recall.mjs) and runs from a dedicated read-only checkout at
# /home/nish/workspaces/agent-state/0509-sneaker-resale-recall-canary that
# self-syncs to main on every run (ExecStartPre), so the timer never touches
# the shared products/0509 checkout. This installer creates and checks out
# that read-only worktree if it is missing.

set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
fi

readonly SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly UNIT_DIR="${HOME}/.config/systemd/user"
readonly LOG_DIR="${HOME}/workspaces/agent-state/cron-output"
readonly CANARY_DIR="${HOME}/workspaces/agent-state/0509-sneaker-resale-recall-canary"

if [[ ! -d "${CANARY_DIR}/.git" ]]; then
  echo "creating read-only canary worktree at ${CANARY_DIR}"
  install -d -m 0755 "$(dirname "${CANARY_DIR}")"
  git clone --reference-if-able /home/nish/workspaces/.mirrors/0509.git \
    https://github.com/Nishfleet/0509.git "${CANARY_DIR}"
fi

[[ -f "${CANARY_DIR}/scripts/canary-sneaker-resale-recall.mjs" ]] || {
  echo "canary script missing in ${CANARY_DIR} — self-sync will fetch it after the PR merges; pull main first" >&2
  exit 1;
}

install -d -m 0755 "${UNIT_DIR}" "${LOG_DIR}"
install -m 0644 "${SOURCE_DIR}/0509-sneaker-resale-recall-canary.user.service" "${UNIT_DIR}/0509-sneaker-resale-recall-canary.service"
install -m 0644 "${SOURCE_DIR}/0509-sneaker-resale-recall-canary.user.timer" "${UNIT_DIR}/0509-sneaker-resale-recall-canary.timer"

systemctl --user daemon-reload
systemctl --user enable --now 0509-sneaker-resale-recall-canary.timer

# Smoke: run the service once now and require a clean run. A red canary on an
# unfixed production is expected pre-deploy — the installer reports the verdict
# either way so the operator sees the live truth, but only a unit that RAN
# (exit 0 or 1, never 2/crash) counts as installed correctly.
echo "smoke: running 0509-sneaker-resale-recall-canary.service once..."
if systemctl --user start 0509-sneaker-resale-recall-canary.service; then
  echo "smoke: PASS (every coverage-bearing sneaker-resale brand returned rows)"
else
  status=$(systemctl --user show 0509-sneaker-resale-recall-canary.service -p ExecMainStatus --value)
  if [[ "${status}" == "1" ]]; then
    echo "smoke: RAN, verdict FAIL — a coverage-bearing brand dead-ends (expected until the fix deploys); detector is live"
  else
    echo "smoke: FAILED to run (ExecMainStatus=${status}) — check ${LOG_DIR}/0509-sneaker-resale-recall-canary.log" >&2
    exit 1
  fi
fi

systemctl --user list-timers --no-pager | grep sneaker-resale-recall || true
