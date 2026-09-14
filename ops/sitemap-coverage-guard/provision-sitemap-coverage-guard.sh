#!/usr/bin/env bash
#
# Install the 0509 advertised-URL coverage guard on the fleet VPS.
#
# Issue #3166 observe-to-close: every URL the live sitemap.xml + llms.txt
# advertise is probed daily by scripts/canary-sitemap-coverage.mjs under a
# systemd timer (same rail as the 0509-timeline-coverage-guard). The unit
# SUCCEEDS only when every advertised URL serves 200 with non-empty,
# indexable bodies; it FAILS on any divergence (the canary auto-files a
# deduped incident issue) or probe failure.
#
# Run as root on the VPS:
#   sudo ops/sitemap-coverage-guard/provision-sitemap-coverage-guard.sh
#
# Installs:
#   /opt/0509-sitemap-coverage-guard/0509-sitemap-coverage-guard-run.sh
#   /etc/systemd/system/0509-sitemap-coverage-guard.service
#   /etc/systemd/system/0509-sitemap-coverage-guard.timer
#
# OPTIONAL (operator, not this script): create
#   /etc/0509-sitemap-coverage-guard/env  (root:root, 0600) containing
#   CANARY_BYPASS_TOKEN=<token>
# to switch the daily run to the canary's fast crawl-parity pacing. Without
# the file the guard paces at one request per 5.2s — under the /ads+/timeline
# cohort's 120/10min per-IP budget in the worst case — and a full pass takes
# ~17-20 minutes. The token value is a secret: it is never printed, logged,
# or committed; the operator places it in the env file themselves.
#
# The service runs as the `nish` user (owns the repo checkout; ambient gh
# auth backs the canary's --file-issue divergence path; no Cloudflare token
# is needed — the canary is a zero-cost public probe). Failed verdicts exit
# non-zero, marking the unit failed for operators and watchdogs.

set -euo pipefail

readonly INSTALL_ROOT="/opt/0509-sitemap-coverage-guard"
readonly ENV_FILE="/etc/0509-sitemap-coverage-guard/env"
readonly SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

die() {
  printf 'sitemap-coverage-guard provisioning error: %s\n' "$*" >&2
  exit 1
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || die "run as root"
}

install_files() {
  install -d -o root -g root -m 0755 "${INSTALL_ROOT}"
  install -o root -g root -m 0755 \
    "${SOURCE_DIR}/0509-sitemap-coverage-guard-run.sh" \
    "${INSTALL_ROOT}/0509-sitemap-coverage-guard-run.sh"
  install -o root -g root -m 0644 \
    "${SOURCE_DIR}/0509-sitemap-coverage-guard.service" \
    /etc/systemd/system/0509-sitemap-coverage-guard.service
  install -o root -g root -m 0644 \
    "${SOURCE_DIR}/0509-sitemap-coverage-guard.timer" \
    /etc/systemd/system/0509-sitemap-coverage-guard.timer
  systemctl daemon-reload
}

smoke_guard() {
  # One probe run as the service would, against a tiny 2-URL live fixture
  # (SITEMAP_COVERAGE_GUARD_SMOKE=1) so the smoke reaches a real verdict in
  # seconds instead of a full ~17-minute crawl. Exit 0 means the canary ran
  # against production and judged it. Anything else means the install is
  # broken — provisioning must stop and the operator looks at the journal.
  local code
  set +e
  SITEMAP_COVERAGE_GUARD_SMOKE=1 systemctl start 0509-sitemap-coverage-guard.service
  code=$?
  set -e
  if [[ "${code}" -ne 0 ]]; then
    die "smoke run did not observe-OK (exit ${code}); see: journalctl -u 0509-sitemap-coverage-guard.service"
  fi
}

verify_timer() {
  local state
  state="$(systemctl is-active 0509-sitemap-coverage-guard.timer)" || die "timer is not active"
  [[ "${state}" == "active" ]] || die "timer state was ${state}, expected active"
  systemctl show 0509-sitemap-coverage-guard.timer --property=NextElapseOnRealTimeUTC --value
}

main() {
  require_root
  install_files
  if [[ ! -f "${ENV_FILE}" ]]; then
    printf 'sitemap-coverage-guard: %s not present — running in crawl-parity slow pacing (~17-20 min per pass).\n' "${ENV_FILE}"
    printf 'To enable fast pacing, create that file (root:root 0600) with CANARY_BYPASS_TOKEN=<token> yourself.\n'
  fi
  smoke_guard
  systemctl enable --now 0509-sitemap-coverage-guard.timer
  verify_timer
  printf '0509 sitemap-coverage guard installed and scheduled daily at 10:07 UTC.\n'
  printf 'Inspect:  journalctl -u 0509-sitemap-coverage-guard.service\n'
}

main "$@"
