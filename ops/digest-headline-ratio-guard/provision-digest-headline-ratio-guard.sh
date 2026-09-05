#!/usr/bin/env bash
#
# Install the 0509 BET 1 digest headline-ratio regression guard on the fleet
# VPS.
#
# Issue #1451 accept criteria 3-4: a scheduled cron samples the last 24h of
# delivered digests, computes the headline ratio, writes a daily summary CSV,
# and a regression guard fires (files an issue pinging #972) when the 7-day
# rolling headline ratio drops below 50%. This installs a systemd timer (same
# rail as the 0509-screenshot-rate-guard and 0509-demo-brand-timeline-guard)
# that runs the guard daily, queries production D1, fails the unit when the
# rolling window regresses, and auto-files a deduplicated GitHub issue.
#
# Run as root on the VPS:
#   sudo ops/digest-headline-ratio-guard/provision-digest-headline-ratio-guard.sh
#
# Installs:
#   /opt/0509-digest-headline-ratio-guard/0509-digest-headline-ratio-guard-run.sh
#   /etc/systemd/system/0509-digest-headline-ratio-guard.service
#   /etc/systemd/system/0509-digest-headline-ratio-guard.timer
# The service runs as the `nish` user (owns the repo checkout + the sanctioned
# Cloudflare token in ~/.config/cloudflare/deploy-ci.env, which the fleet
# cf-token-canary keeps alive). Guard-fired verdicts exit non-zero, marking
# the unit failed for operators and watchdogs.

set -euo pipefail

readonly INSTALL_ROOT="/opt/0509-digest-headline-ratio-guard"
readonly SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

die() {
  printf 'digest-headline-ratio-guard provisioning error: %s\n' "$*" >&2
  exit 1
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || die "run as root"
}

install_files() {
  install -d -o root -g root -m 0755 "${INSTALL_ROOT}"
  install -o root -g root -m 0755 \
    "${SOURCE_DIR}/0509-digest-headline-ratio-guard-run.sh" \
    "${INSTALL_ROOT}/0509-digest-headline-ratio-guard-run.sh"
  install -o root -g root -m 0644 \
    "${SOURCE_DIR}/0509-digest-headline-ratio-guard.service" \
    /etc/systemd/system/0509-digest-headline-ratio-guard.service
  install -o root -g root -m 0644 \
    "${SOURCE_DIR}/0509-digest-headline-ratio-guard.timer" \
    /etc/systemd/system/0509-digest-headline-ratio-guard.timer
  systemctl daemon-reload
}

smoke_guard() {
  # One probe run as the service would, so the smoke run uses the real
  # environment. Exit 0 (healthy / nothing delivered to measure) and exit 1
  # (a real regression detected — the guard working) are both fine: the canary
  # reached a live verdict. Exit 2 means the canary could not run; the ONE
  # tolerated cause is provisioning before the canary PR has merged — the
  # timer stays armed and the first post-merge fire self-installs. Any other
  # exit 2 is a broken install and provisioning must stop.
  local code
  set +e
  systemctl start 0509-digest-headline-ratio-guard.service
  code=$?
  set -e
  if [[ "${code}" -eq 2 ]]; then
    if journalctl -u 0509-digest-headline-ratio-guard.service -n 20 --no-pager 2>/dev/null \
      | grep -q "has the PR landed on main"; then
      printf 'smoke deferred: canary is not on origin/main yet (pre-merge); timer is armed and the first post-merge fire self-installs.\n' >&2
      return 0
    fi
    die "smoke run could not reach a verdict (exit 2); see: journalctl -u 0509-digest-headline-ratio-guard.service"
  fi
}

verify_timer() {
  local state
  state="$(systemctl is-active 0509-digest-headline-ratio-guard.timer)" || die "timer is not active"
  [[ "${state}" == "active" ]] || die "timer state was ${state}, expected active"
  systemctl show 0509-digest-headline-ratio-guard.timer --property=NextElapseOnRealTimeUTC --value
}

main() {
  require_root
  install_files
  smoke_guard
  systemctl enable --now 0509-digest-headline-ratio-guard.timer
  verify_timer
  printf '0509 digest headline-ratio guard installed and scheduled daily.\n'
  printf 'Inspect:  journalctl -u 0509-digest-headline-ratio-guard.service\n'
}

main "$@"
