#!/usr/bin/env bash
#
# Install the 0509 free-preview recall audit as a systemd USER timer on the
# fleet VPS (no root needed — the check needs no secrets, only outbound HTTPS).
#
# Run as nish on the VPS:  ops/search-recall-audit/install-user-timer.sh
#
# Installs:
#   ~/.config/systemd/user/0509-search-recall-audit.service
#   ~/.config/systemd/user/0509-search-recall-audit.timer   (every 6h)
# Evidence:
#   ~/workspaces/agent-state/cron-output/0509-search-recall-audit.log
#
# The audit script lives in the repo (scripts/search-recall-audit.mjs, the
# issue-#3014 recall gate over the BET 2 25-domain set) and runs from a
# dedicated read-only checkout at
# /home/nish/workspaces/agent-state/0509-search-recall-audit that self-syncs
# to main on every run (ExecStartPre), so the timer never touches the shared
# products/0509 checkout. This installer creates and checks out that
# read-only worktree if it is missing.

set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
fi

readonly SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly UNIT_DIR="${HOME}/.config/systemd/user"
readonly LOG_DIR="${HOME}/workspaces/agent-state/cron-output"
readonly AUDIT_DIR="${HOME}/workspaces/agent-state/0509-search-recall-audit"

if [[ ! -d "${AUDIT_DIR}/.git" ]]; then
  echo "creating read-only audit checkout at ${AUDIT_DIR}"
  install -d -m 0755 "$(dirname "${AUDIT_DIR}")"
  git clone --reference-if-able /home/nish/workspaces/.mirrors/0509.git \
    https://github.com/Nishfleet/0509.git "${AUDIT_DIR}"
fi

[[ -f "${AUDIT_DIR}/scripts/search-recall-audit.mjs" ]] || {
  echo "audit script missing in ${AUDIT_DIR} — self-sync will fetch it after the PR merges; pull main first" >&2
  exit 1;
}

install -d -m 0755 "${UNIT_DIR}" "${LOG_DIR}"
install -m 0644 "${SOURCE_DIR}/0509-search-recall-audit.user.service" "${UNIT_DIR}/0509-search-recall-audit.service"
install -m 0644 "${SOURCE_DIR}/0509-search-recall-audit.user.timer" "${UNIT_DIR}/0509-search-recall-audit.timer"

systemctl --user daemon-reload
systemctl --user enable --now 0509-search-recall-audit.timer

# Smoke: run the service once now and report the live verdict honestly. A red
# verdict on an unfixed production is a REAL finding — the installer reports
# it either way so the operator sees the live truth; only a unit that FAILED
# TO RUN (exit 2 / crash) counts as a bad install.
echo "smoke: running 0509-search-recall-audit.service once..."
if systemctl --user start 0509-search-recall-audit.service; then
  echo "smoke: PASS (0 dead-ends, verified share >= 80%, §1.8 brands non-empty)"
else
  status=$(systemctl --user show 0509-search-recall-audit.service -p ExecMainStatus --value)
  if [[ "${status}" == "1" ]]; then
    echo "smoke: RAN, verdict FAIL — the recall gates are red on live production; check ${LOG_DIR}/0509-search-recall-audit.log"
  else
    echo "smoke: FAILED to run (ExecMainStatus=${status}) — check ${LOG_DIR}/0509-search-recall-audit.log" >&2
    exit 1
  fi
fi

systemctl --user list-timers --no-pager | grep search-recall-audit || true
