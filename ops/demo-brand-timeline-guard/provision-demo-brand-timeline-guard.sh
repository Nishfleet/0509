#!/usr/bin/env bash
#
# Install the 0509 demo-brand Offer Timeline regression guard on the fleet VPS.
#
# Issue #1449 accept criterion #5: `landing_page_snapshot` count per demo
# brand is checked by a scheduled canary and any drop to 0 for a watched brand
# files an issue. This installs a systemd timer (same rail as the
# 0509-screenshot-rate-guard) that runs the guard daily, queries production
# D1, fails the unit when any watched demo brand's stored corpus drops to 0
# rows, and auto-files a GitHub issue.
#
# Run as root on the VPS:
#   sudo ops/demo-brand-timeline-guard/provision-demo-brand-timeline-guard.sh
#
# Installs:
#   /opt/0509-demo-brand-timeline-guard/0509-demo-brand-timeline-guard-run.sh
#   /etc/systemd/system/0509-demo-brand-timeline-guard.service
#   /etc/systemd/system/0509-demo-brand-timeline-guard.timer
# The service runs as the `nish` user (owns the repo checkout + the sanctioned
# Cloudflare token in ~/.config/cloudflare/deploy-ci.env, which the fleet
# cf-token-canary keeps alive). Failed verdicts exit non-zero, marking the
# unit failed for operators and watchdogs.

set -euo pipefail

readonly INSTALL_ROOT="/opt/0509-demo-brand-timeline-guard"
readonly SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

die() {
  printf 'demo-brand-timeline-guard provisioning error: %s\n' "$*" >&2
  exit 1
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || die "run as root"
}

install_files() {
  install -d -o root -g root -m 0755 "${INSTALL_ROOT}"
  install -o root -g root -m 0755 \
    "${SOURCE_DIR}/0509-demo-brand-timeline-guard-run.sh" \
    "${INSTALL_ROOT}/0509-demo-brand-timeline-guard-run.sh"
  install -o root -g root -m 0644 \
    "${SOURCE_DIR}/0509-demo-brand-timeline-guard.service" \
    /etc/systemd/system/0509-demo-brand-timeline-guard.service
  install -o root -g root -m 0644 \
    "${SOURCE_DIR}/0509-demo-brand-timeline-guard.timer" \
    /etc/systemd/system/0509-demo-brand-timeline-guard.timer
  systemctl daemon-reload
}

smoke_guard() {
  # One probe run as the service would, overridden to the nish checkout + token
  # file so the smoke run uses the real environment. Exit 0 (pass) and exit 1
  # (a real regression detected — the guard working) are both fine: the canary
  # reached a live verdict. Exit 2 (canary could not run) means the install is
  # broken and provisioning must stop.
  local code
  set +e
  systemctl start 0509-demo-brand-timeline-guard.service
  code=$?
  set -e
  if [[ "${code}" -eq 2 ]]; then
    die "smoke run could not query D1 (exit 2); see: journalctl -u 0509-demo-brand-timeline-guard.service"
  fi
}

verify_timer() {
  local state
  state="$(systemctl is-active 0509-demo-brand-timeline-guard.timer)" || die "timer is not active"
  [[ "${state}" == "active" ]] || die "timer state was ${state}, expected active"
  systemctl show 0509-demo-brand-timeline-guard.timer --property=NextElapseOnRealTimeUTC --value
}

main() {
  require_root
  install_files
  smoke_guard
  systemctl enable --now 0509-demo-brand-timeline-guard.timer
  verify_timer
  printf '0509 demo-brand timeline guard installed and scheduled daily.\n'
  printf 'Inspect:  journalctl -u 0509-demo-brand-timeline-guard.service\n'
}

main "$@"