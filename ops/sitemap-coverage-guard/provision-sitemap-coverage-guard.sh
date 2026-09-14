#!/usr/bin/env bash
#
# Install the 0509 advertised-URL coverage guard on the fleet VPS.
#
# Issue #3166 observe-to-close: every URL the live sitemap.xml + llms.txt
# advertise is probed daily by scripts/canary-sitemap-coverage.mjs under a
# systemd timer (same rail as the 0509-digest-headline-ratio guard). The
# unit SUCCEEDS only when every advertised URL serves 200 with non-empty,
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
# the file the guard paces at one request per 5.2s — under the /ads +
# /timeline cohort's 60/60s per-IP edge budget (#2985, raised by #3156)
# even in the worst case — and a full pass over the ~360-URL advertised set
# takes ~31-35 minutes. The token value is a secret: it is never printed,
# logged, or committed; the operator places it in the env file themselves.
#
# OPTIONAL (provisioning from a branch checkout, pre-merge): export
#   SITEMAP_COVERAGE_GUARD_CHECKOUT=<path to a checkout carrying the canary>
# and the smoke run probes the live fixture through THAT tree's canary —
# otherwise the smoke defers with "has the PR landed on main?" until the
# first post-merge timer fire picks the canary up from the guard's own
# origin/main-synced checkout.
#
# The service runs as the `nish` user (owns the guard checkout; ambient gh
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

# Resolve the toolchain bin dir(s) for the nish user. systemd does not
# source the nish user's login shell, so node/gh (which live under the nish
# toolchain, not /usr/bin) are not on the default service PATH.
#
# A login-shell lookup is NOT reliable here: this host's ~/.bash_profile is
# an empty file, so `bash -lc` never reaches ~/.profile and its PATH misses
# ~/.local/bin entirely. Worse, a stale root-owned /usr/local/bin/node
# exists, so `command -v node` alone can resolve to a dir the guard still
# cannot file an issue from. Instead, scan candidate dirs and pick the
# first that contains BOTH an executable node AND gh — the single-dir shape
# the nish toolchain has (~/.local/bin). On hosts where the tools are split
# across dirs (CI runners keep node in a toolcache dir and gh in /usr/bin),
# emit a "<node-dir>:<gh-dir>" prefix from the same candidate order rather
# than failing — the leading node dir is still the toolchain dir, so the
# stale /usr/local/bin/node can only win when nothing earlier carries node.
# Fails (non-zero) if node or gh cannot be resolved at all.
resolve_toolchain_prefix() {
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
    if [[ -x "${dir}/node" && -x "${dir}/gh" ]]; then
      printf '%s\n' "${dir}"
      return 0
    fi
  done
  local node_dir="" gh_dir=""
  for dir in "${candidates[@]}"; do
    if [[ -z "${node_dir}" && -x "${dir}/node" ]]; then node_dir="${dir}"; fi
    if [[ -z "${gh_dir}" && -x "${dir}/gh" ]]; then gh_dir="${dir}"; fi
  done
  if [[ -z "${node_dir}" || -z "${gh_dir}" ]]; then
    return 1
  fi
  if [[ "${node_dir}" == "${gh_dir}" ]]; then
    printf '%s\n' "${node_dir}"
  else
    printf '%s:%s\n' "${node_dir}" "${gh_dir}"
  fi
}

# The full PATH the guard unit runs with: the resolved toolchain prefix
# (one dir, or <node-dir>:<gh-dir> on split-toolchain hosts) followed by
# the standard systemd PATH. Fails (non-zero) if node or gh cannot be
# resolved.
guard_path() {
  local prefix
  prefix="$(resolve_toolchain_prefix)" || return 1
  printf '%s:/usr/local/bin:/usr/bin:/bin' "${prefix}"
}

# Assert that node AND gh both resolve within the given PATH for the user
# the unit runs as. This is the fail-loud guard: if the resolved PATH still
# cannot find gh, provisioning stops with the PATH in the message rather
# than installing a unit that will fail on every start. When run as root
# the check runs AS nish (via runuser), matching the unit's runtime user so
# permission bits are evaluated the same way systemd will.
verify_guard_path() {
  local guard_path="$1"
  if [[ "$(id -u)" -eq 0 ]]; then
    runuser -u nish -- env PATH="${guard_path}" bash -c \
      'command -v node >/dev/null 2>&1 && command -v gh >/dev/null 2>&1'
  else
    PATH="${guard_path}" bash -c \
      'command -v node >/dev/null 2>&1 && command -v gh >/dev/null 2>&1'
  fi
}

install_files() {
  install -d -o root -g root -m 0755 "${INSTALL_ROOT}"
  install -o root -g root -m 0755 \
    "${SOURCE_DIR}/0509-sitemap-coverage-guard-run.sh" \
    "${INSTALL_ROOT}/0509-sitemap-coverage-guard-run.sh"
  # Render the service unit with the toolchain bin dir discovered at
  # provision time, substituting the __NODE_BIN_DIR__ placeholder in the
  # repo template. Fail loud (with the resolved PATH) if node/gh are still
  # not resolvable.
  local guard_path toolchain_prefix
  guard_path="$(guard_path)" \
    || die "could not resolve node/gh on PATH (is the toolchain installed for the nish user?)"
  verify_guard_path "${guard_path}" \
    || die "node/gh not resolvable on resolved PATH: ${guard_path}"
  toolchain_prefix="${guard_path%:/usr/local/bin:/usr/bin:/bin}"
  sed "s|__NODE_BIN_DIR__|${toolchain_prefix}|" \
    "${SOURCE_DIR}/0509-sitemap-coverage-guard.service" \
    > /etc/systemd/system/0509-sitemap-coverage-guard.service
  install -o root -g root -m 0644 \
    "${SOURCE_DIR}/0509-sitemap-coverage-guard.timer" \
    /etc/systemd/system/0509-sitemap-coverage-guard.timer
  systemctl daemon-reload
}

smoke_guard() {
  # One probe run as the service would: same user (nish via runuser), same
  # resolved PATH, same installed run script — SITEMAP_COVERAGE_GUARD_SMOKE=1
  # probes a 2-URL live fixture so the smoke reaches a real verdict in
  # seconds instead of a full ~31-minute crawl. `systemctl start` cannot
  # carry the smoke flag (a caller's env never reaches the unit), so the
  # smoke runs the installed script directly.
  #
  # Exit 2 with "has the PR landed on main?" is the ONE tolerated failure:
  # provisioning before the canary PR has merged leaves the timer armed and
  # the first post-merge fire picks the canary up from the guard's own
  # synced checkout. Any other non-zero is a broken install and
  # provisioning must stop.
  local guard_path output code
  guard_path="$(guard_path)" || die "could not resolve node/gh on PATH"
  set +e
  output="$(runuser -u nish -- env \
    PATH="${guard_path}" \
    SITEMAP_COVERAGE_GUARD_SMOKE=1 \
    ${SITEMAP_COVERAGE_GUARD_CHECKOUT:+SITEMAP_COVERAGE_GUARD_CHECKOUT="${SITEMAP_COVERAGE_GUARD_CHECKOUT}"} \
    "${INSTALL_ROOT}/0509-sitemap-coverage-guard-run.sh" 2>&1)"
  code=$?
  set -e
  printf '%s\n' "${output}"
  if [[ "${code}" -ne 0 ]]; then
    if [[ "${code}" -eq 2 ]] && grep -q "has the PR landed on main" <<<"${output}"; then
      printf 'smoke deferred: canary is not on origin/main yet (pre-merge); timer is armed and the first post-merge fire picks it up.\n' >&2
      return 0
    fi
    die "smoke run did not observe-OK (exit ${code}); re-run the installed run script as nish to inspect"
  fi
}

verify_timer() {
  local state
  state="$(systemctl is-active 0509-sitemap-coverage-guard.timer)" || die "timer is not active"
  [[ "${state}" == "active" ]] || die "timer state was ${state}, expected active"
  systemctl show 0509-sitemap-coverage-guard.timer --property=NextElapseOnRealTimeUTC --value
}

main() {
  # --resolve-path: print the resolved guard PATH (and assert node/gh
  # resolve within it) without touching the system. Used by the provision
  # drill test to assert PATH resolution without root or systemd.
  if [[ "${1:-}" == "--resolve-path" ]]; then
    local guard_path
    guard_path="$(guard_path)" || die "could not resolve node/gh on PATH"
    verify_guard_path "${guard_path}" \
      || die "node/gh not resolvable on resolved PATH: ${guard_path}"
    printf '%s\n' "${guard_path}"
    return 0
  fi
  require_root
  install_files
  if [[ ! -f "${ENV_FILE}" ]]; then
    printf 'sitemap-coverage-guard: %s not present — running in crawl-parity slow pacing (~31-35 min per pass).\n' "${ENV_FILE}"
    printf 'To enable fast pacing, create that file (root:root 0600) with CANARY_BYPASS_TOKEN=<token> yourself.\n'
  fi
  smoke_guard
  systemctl enable --now 0509-sitemap-coverage-guard.timer
  verify_timer
  printf '0509 sitemap-coverage guard installed and scheduled daily at 10:07 UTC.\n'
  printf 'Inspect:  journalctl -u 0509-sitemap-coverage-guard.service\n'
}

main "$@"
