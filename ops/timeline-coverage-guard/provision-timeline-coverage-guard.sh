#!/usr/bin/env bash
#
# Install the 0509 Offer Timeline public-surface coverage guard on the fleet VPS.
#
# Issue #3095 observe-to-close: the sitemap /timeline/-URL count is watched by
# a scheduled canary (scripts/canary-timeline-coverage.mjs) under a systemd
# timer (same rail as the 0509-demo-brand-timeline-guard). The unit SUCCEEDS
# on the documented pending state (baseline held, floor not yet reached while
# the nightly capture pipeline populates) and FAILS only on a regression
# (covered < 7 — indexed proof pages vanished; the canary auto-files a deduped
# incident) or a probe failure (sitemap unfetchable).
#
# Run as root on the VPS:
#   sudo ops/timeline-coverage-guard/provision-timeline-coverage-guard.sh
#
# Installs:
#   /opt/0509-timeline-coverage-guard/0509-timeline-coverage-guard-run.sh
#   /etc/systemd/system/0509-timeline-coverage-guard.service
#   /etc/systemd/system/0509-timeline-coverage-guard.timer
# The service runs as the `nish` user (owns the repo checkout; ambient gh auth
# backs the canary's --file-issue regression path; no Cloudflare token is
# needed — the canary is a zero-cost public sitemap probe). Failed verdicts
# exit non-zero, marking the unit failed for operators and watchdogs.

set -euo pipefail

readonly INSTALL_ROOT="/opt/0509-timeline-coverage-guard"
readonly SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

die() {
  printf 'timeline-coverage-guard provisioning error: %s\n' "$*" >&2
  exit 1
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || die "run as root"
}

install_files() {
  install -d -o root -g root -m 0755 "${INSTALL_ROOT}"
  install -o root -g root -m 0755 \
    "${SOURCE_DIR}/0509-timeline-coverage-guard-run.sh" \
    "${INSTALL_ROOT}/0509-timeline-coverage-guard-run.sh"
  install -o root -g root -m 0644 \
    "${SOURCE_DIR}/0509-timeline-coverage-guard.service" \
    /etc/systemd/system/0509-timeline-coverage-guard.service
  install -o root -g root -m 0644 \
    "${SOURCE_DIR}/0509-timeline-coverage-guard.timer" \
    /etc/systemd/system/0509-timeline-coverage-guard.timer
  systemctl daemon-reload
}

smoke_guard() {
  # One probe run as the service would. Exit 0 (pass) and exit 0-with-pending
  # note (the documented expected state while the capture pipeline populates)
  # are both fine: the canary reached a live verdict. Exit 2 (probe failure)
  # or 3 (regression) means the install is broken or the metric regressed —
  # provisioning must stop and the operator looks at the journal.
  local code
  set +e
  systemctl start 0509-timeline-coverage-guard.service
  code=$?
  set -e
  if [[ "${code}" -ne 0 ]]; then
    die "smoke run did not observe-OK (exit ${code}); see: journalctl -u 0509-timeline-coverage-guard.service"
  fi
}

verify_timer() {
  local state
  state="$(systemctl is-active 0509-timeline-coverage-guard.timer)" || die "timer is not active"
  [[ "${state}" == "active" ]] || die "timer state was ${state}, expected active"
  systemctl show 0509-timeline-coverage-guard.timer --property=NextElapseOnRealTimeUTC --value
}

main() {
  require_root
  install_files
  smoke_guard
  systemctl enable --now 0509-timeline-coverage-guard.timer
  verify_timer
  printf '0509 timeline-coverage guard installed and scheduled daily.\n'
  printf 'Inspect:  journalctl -u 0509-timeline-coverage-guard.service\n'
}

main "$@"
