#!/usr/bin/env bash
#
# Install the 0509 /ads rate-limit error-body regression guard on the fleet
# VPS.
#
# Issue #1930's fix made a rate-limited /ads/:domain (or /timeline/:domain)
# request render the honest per-IP free-preview limit state with a recovery
# path and forward Retry-After, instead of the generic "Something broke on
# our side" root error boundary. This installs a systemd timer (same rail as
# the 0509-search-h1-guard and 0509-screenshot-rate-guard rails) that curls a
# populated /ads page until the anonymous brand-page limiter trips, fails the
# unit when the tripped 429 again renders the generic shell or drops
# Retry-After, and auto-files a GitHub issue (accept criterion #4).
#
# Run as root on the VPS:
#   sudo ops/public-brand-page-rate-limit-guard/provision-public-brand-page-rate-limit-guard.sh
#
# Installs:
#   /opt/0509-public-brand-page-rate-limit-guard/0509-public-brand-page-rate-limit-guard-run.sh
#   /etc/systemd/system/0509-public-brand-page-rate-limit-guard.service
#   /etc/systemd/system/0509-public-brand-page-rate-limit-guard.timer
# The service runs as the `nish` user (no Cloudflare credential needed — the
# guard only curls the public site; it runs as nish because it auto-files
# issues via the ambient `gh` auth). Failed verdicts exit non-zero, marking
# the unit failed for operators and watchdogs.

set -euo pipefail

readonly INSTALL_ROOT="/opt/0509-public-brand-page-rate-limit-guard"
readonly SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

die() {
  printf 'public-brand-page-rate-limit-guard provisioning error: %s\n' "$*" >&2
  exit 1
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || die "run as root"
}

install_files() {
  install -d -o root -g root -m 0755 "${INSTALL_ROOT}"
  install -o root -g root -m 0755 \
    "${SOURCE_DIR}/0509-public-brand-page-rate-limit-guard-run.sh" \
    "${INSTALL_ROOT}/0509-public-brand-page-rate-limit-guard-run.sh"
  install -o root -g root -m 0644 \
    "${SOURCE_DIR}/0509-public-brand-page-rate-limit-guard.service" \
    /etc/systemd/system/0509-public-brand-page-rate-limit-guard.service
  install -o root -g root -m 0644 \
    "${SOURCE_DIR}/0509-public-brand-page-rate-limit-guard.timer" \
    /etc/systemd/system/0509-public-brand-page-rate-limit-guard.timer
  systemctl daemon-reload
}

smoke_guard() {
  # One probe run as the service would. Exit 0 (pass) and exit 1 (a real
  # regression detected — the guard working) are both fine: the canary reached
  # a live verdict. Exit 2 (canary could not run) means the install is broken
  # and provisioning must stop.
  local code
  set +e
  systemctl start 0509-public-brand-page-rate-limit-guard.service
  code=$?
  set -e
  if [[ "${code}" -eq 2 ]]; then
    die "smoke run could not reach the live /ads surface (exit 2); see: journalctl -u 0509-public-brand-page-rate-limit-guard.service"
  fi
}

verify_timer() {
  local state
  state="$(systemctl is-active 0509-public-brand-page-rate-limit-guard.timer)" || die "timer is not active"
  [[ "${state}" == "active" ]] || die "timer state was ${state}, expected active"
  systemctl show 0509-public-brand-page-rate-limit-guard.timer --property=NextElapseOnRealTimeUTC --value
}

main() {
  require_root
  install_files
  smoke_guard
  systemctl enable --now 0509-public-brand-page-rate-limit-guard.timer
  verify_timer
  printf '0509 /ads rate-limit error-body guard installed and scheduled daily.\n'
  printf 'Inspect:  journalctl -u 0509-public-brand-page-rate-limit-guard.service\n'
}

main "$@"
