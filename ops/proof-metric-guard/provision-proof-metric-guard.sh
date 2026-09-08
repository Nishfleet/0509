#!/usr/bin/env bash
#
# Install the 0509 proof screenshot-metric guard on the fleet VPS.
#
# Issue #1985 requires the screenshot rate on REAL proof captures ("saves the
# screenshots" is the product's headline proof promise, and acceptance 2 is
# "the rate rises; any budget skip is user-visible with a reason") to be
# continuously observed over a 7-day window. The rate half is already guarded
# on a 48h window by ops/screenshot-rate-guard; this unit runs the SAME proven
# canaries on the issue's 7-day (168h) window AND adds the budget-skip-surface
# leg, which previously had NO scheduled observer. It installs a systemd timer
# (same rail as 0509-digest-headline-ratio-guard), queries production D1,
# fails the unit when a leg's verdict regresses, and auto-files a GitHub issue
# on a failed rate verdict.
#
# Run as root on the VPS:
#   sudo ops/proof-metric-guard/provision-proof-metric-guard.sh
#
# Installs:
#   /opt/0509-proof-metric-guard/0509-proof-metric-guard-run.sh
#   /etc/systemd/system/0509-proof-metric-guard.service
#   /etc/systemd/system/0509-proof-metric-guard.timer
# The service runs as the `nish` user (owns the repo checkout + the sanctioned
# Cloudflare token in ~/.config/cloudflare/deploy-ci.env, which the fleet
# cf-token-canary keeps alive). Guard-fired verdicts exit non-zero, marking
# the unit failed for operators and watchdogs.

set -euo pipefail

readonly INSTALL_ROOT="/opt/0509-proof-metric-guard"
readonly SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

die() {
  printf 'proof-metric-guard provisioning error: %s\n' "$*" >&2
  exit 1
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || die "run as root"
}

# Resolve the node bin dir for the nish user. systemd does not source the
# nish user's login shell, so node/npm (which live under the nish toolchain,
# not /usr/bin) are not on the default service PATH. Mirror of the
# digest-headline-ratio guard's resolver (issue #1660).
resolve_node_bin_dir() {
  local nish_home dir
  local -a candidates=()
  if [[ "$(id -u)" -eq 0 ]]; then
    nish_home="$(getent passwd nish | cut -d: -f6)"
  else
    nish_home="${HOME:-}"
  fi
  if [[ -n "${nish_home}" ]]; then
    candidates+=("${nish_home}/.local/bin" "${nish_home}/bin")
  fi
  local node_bin=""
  if [[ "$(id -u)" -eq 0 ]]; then
    node_bin="$(runuser -u nish -- bash -lc 'command -v node' 2>/dev/null || true)"
    node_bin="${node_bin##*$'\n'}"
  else
    node_bin="$(command -v node 2>/dev/null || true)"
  fi
  [[ -n "${node_bin}" ]] && candidates+=("$(dirname "${node_bin}")")
  candidates+=(/usr/local/bin /usr/bin /bin)
  for dir in "${candidates[@]}"; do
    if [[ -x "${dir}/node" && -x "${dir}/npm" ]]; then
      printf '%s\n' "${dir}"
      return 0
    fi
  done
  return 1
}

guard_path() {
  local node_bin_dir
  node_bin_dir="$(resolve_node_bin_dir)" || return 1
  printf '%s:/usr/local/bin:/usr/bin:/bin' "${node_bin_dir}"
}

verify_guard_path() {
  local guard_path="$1"
  if [[ "$(id -u)" -eq 0 ]]; then
    runuser -u nish -- env PATH="${guard_path}" bash -c \
      'command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1'
  else
    PATH="${guard_path}" bash -c \
      'command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1'
  fi
}

install_files() {
  install -d -o root -g root -m 0755 "${INSTALL_ROOT}"
  install -o root -g root -m 0755 \
    "${SOURCE_DIR}/0509-proof-metric-guard-run.sh" \
    "${INSTALL_ROOT}/0509-proof-metric-guard-run.sh"
  # Render the service unit with the node bin dir discovered at provision
  # time, substituting the __NODE_BIN_DIR__ placeholder in the repo template.
  local guard_path node_bin_dir
  guard_path="$(guard_path)" \
    || die "could not resolve node/npm on PATH (is node installed for the nish user?)"
  verify_guard_path "${guard_path}" \
    || die "node/npm not resolvable on resolved PATH: ${guard_path}"
  node_bin_dir="${guard_path%%:*}"
  sed "s|__NODE_BIN_DIR__|${node_bin_dir}|" \
    "${SOURCE_DIR}/0509-proof-metric-guard.service" \
    > /etc/systemd/system/0509-proof-metric-guard.service
  install -o root -g root -m 0644 \
    "${SOURCE_DIR}/0509-proof-metric-guard.timer" \
    /etc/systemd/system/0509-proof-metric-guard.timer
  systemctl daemon-reload
}

smoke_guard() {
  # One probe run as the service would, so the smoke run uses the real
  # environment. Exit 0 (healthy / nothing to measure) and exit 1 (a real
  # regression detected — the guard working) are both fine: the canaries
  # reached a live verdict. Exit 2 means a canary could not run.
  local code
  set +e
  systemctl start 0509-proof-metric-guard.service
  code=$?
  set -e
  if [[ "${code}" -eq 2 ]]; then
    die "smoke run could not reach a verdict (exit 2); see: journalctl -u 0509-proof-metric-guard.service"
  fi
}

verify_timer() {
  local state
  state="$(systemctl is-active 0509-proof-metric-guard.timer)" || die "timer is not active"
  [[ "${state}" == "active" ]] || die "timer state was ${state}, expected active"
  systemctl show 0509-proof-metric-guard.timer --property=NextElapseOnRealTimeUTC --value
}

main() {
  if [[ "${1:-}" == "--resolve-path" ]]; then
    local guard_path
    guard_path="$(guard_path)" || die "could not resolve node/npm on PATH"
    verify_guard_path "${guard_path}" \
      || die "node/npm not resolvable on resolved PATH: ${guard_path}"
    printf '%s\n' "${guard_path}"
    return 0
  fi
  require_root
  install_files
  smoke_guard
  systemctl enable --now 0509-proof-metric-guard.timer
  verify_timer
  printf '0509 proof screenshot-metric guard installed and scheduled every six hours.\n'
  printf 'Inspect:  journalctl -u 0509-proof-metric-guard.service\n'
}

main "$@"