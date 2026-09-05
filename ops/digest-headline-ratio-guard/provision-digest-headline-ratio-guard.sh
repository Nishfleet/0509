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

# Resolve the node bin dir for the nish user. systemd does not source the
# nish user's login shell, so node/npm (which live under the nish toolchain,
# not /usr/bin) are not on the default service PATH.
#
# A login-shell lookup is NOT reliable here: this host's ~/.bash_profile is an
# empty file, so `bash -lc` never reaches ~/.profile and its PATH misses
# ~/.local/bin entirely. Worse, a stale root-owned /usr/local/bin/node exists
# WITHOUT a matching npm, so `command -v node` alone resolves to a dir the
# guard still cannot run `npm ci` from. Instead, scan candidate dirs and pick
# the first that contains BOTH an executable node AND npm. Fails (non-zero)
# if no such dir exists.
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
  # Then wherever a node resolves for the target user (login shell as root,
  # ambient PATH otherwise), in case the toolchain lives elsewhere.
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

# The full PATH the guard unit runs with: the nish node bin dir first, then
# the standard systemd PATH. Fails (non-zero) if node cannot be resolved.
guard_path() {
  local node_bin_dir
  node_bin_dir="$(resolve_node_bin_dir)" || return 1
  printf '%s:/usr/local/bin:/usr/bin:/bin' "${node_bin_dir}"
}

# Assert that node AND npm both resolve within the given PATH for the user
# the unit runs as. This is the fail-loud guard: if the resolved PATH still
# cannot find npm, provisioning stops with the PATH in the message rather
# than installing a unit that will fail on every start. When run as root the
# check runs AS nish (via runuser), matching the unit's runtime user so
# permission bits are evaluated the same way systemd will.
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
    "${SOURCE_DIR}/0509-digest-headline-ratio-guard-run.sh" \
    "${INSTALL_ROOT}/0509-digest-headline-ratio-guard-run.sh"
  # Render the service unit with the node bin dir discovered at provision
  # time, substituting the __NODE_BIN_DIR__ placeholder in the repo template.
  # Fail loud (with the resolved PATH) if node/npm are still not resolvable.
  local guard_path node_bin_dir
  guard_path="$(guard_path)" \
    || die "could not resolve node/npm on PATH (is node installed for the nish user?)"
  verify_guard_path "${guard_path}" \
    || die "node/npm not resolvable on resolved PATH: ${guard_path}"
  node_bin_dir="${guard_path%%:*}"
  sed "s|__NODE_BIN_DIR__|${node_bin_dir}|" \
    "${SOURCE_DIR}/0509-digest-headline-ratio-guard.service" \
    > /etc/systemd/system/0509-digest-headline-ratio-guard.service
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
  # --resolve-path: print the resolved guard PATH (and assert node/npm resolve
  # within it) without touching the system. Used by the provision drill test
  # to assert PATH resolution without root or systemd.
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
  systemctl enable --now 0509-digest-headline-ratio-guard.timer
  verify_timer
  printf '0509 digest headline-ratio guard installed and scheduled daily.\n'
  printf 'Inspect:  journalctl -u 0509-digest-headline-ratio-guard.service\n'
}

main "$@"
