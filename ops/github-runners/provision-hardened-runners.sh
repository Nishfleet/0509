#!/usr/bin/env bash
set -euo pipefail
set +x

readonly REPOSITORY_URL="${REPOSITORY_URL:-https://github.com/Nishfleet/0509}"
readonly RUNNER_VERSION="${RUNNER_VERSION:-2.336.0}"
readonly RUNNER_ARCHIVE_SHA256="${RUNNER_ARCHIVE_SHA256:-04cf0be1aff4c3ec3554466c39124ca250e3effd8873bb7e8d68535aa9505d5d}"
readonly RUNNER_REGISTRATION_TOKEN_FILE="${RUNNER_REGISTRATION_TOKEN_FILE:-/run/0509-runner-registration.token}"
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SOURCE_DIR
readonly STATE_ROOT="/var/lib/github-runners"
readonly TOOL_ROOT="/opt/0509-runner"
readonly LOCK_GROUP="gha0509-lock"
readonly INSTANCES=(verify1 verify2 verify3)

die() {
  printf 'runner provisioning error: %s\n' "$*" >&2
  exit 1
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || die "run as root"
}

secure_token_file() {
  [[ -f "${RUNNER_REGISTRATION_TOKEN_FILE}" ]] || die "registration token file is missing"
  [[ "$(stat -c '%u' "${RUNNER_REGISTRATION_TOKEN_FILE}")" == "0" ]] ||
    die "registration token file must be owned by root"
  local mode
  mode="$(stat -c '%a' "${RUNNER_REGISTRATION_TOKEN_FILE}")"
  [[ "${mode}" == "600" || "${mode}" == "400" ]] ||
    die "registration token file mode must be 0600 or 0400"
}

destroy_token_file() {
  if [[ -f "${RUNNER_REGISTRATION_TOKEN_FILE}" ]]; then
    shred -u "${RUNNER_REGISTRATION_TOKEN_FILE}"
  fi
}

account_for() {
  printf 'gha0509-%s\n' "$1"
}

labels_for() {
  case "$1" in
    verify*) printf 'vps-verify,0509-%s\n' "$1" ;;
    *) die "unknown runner instance: $1" ;;
  esac
}

assert_runner_drain() {
  local active_services unit exec_start description

  if pgrep -f 'Runner\.(Listener|Worker)' >/dev/null; then
    die "a GitHub Actions Runner.Listener or Runner.Worker is still active; drain jobs before registration"
  fi

  if ! active_services="$(systemctl list-units --type=service --state=active --no-legend --plain --full)"; then
    die "could not inspect active systemd services before runner registration"
  fi

  while read -r unit; do
    unit="${unit%% *}"
    [[ -n "${unit}" ]] || continue
    if ! exec_start="$(systemctl show --property=ExecStart --value "${unit}")"; then
      die "could not inspect ExecStart for active service ${unit} before runner registration"
    fi
    if ! description="$(systemctl show --property=Description --value "${unit}")"; then
      die "could not inspect Description for active service ${unit} before runner registration"
    fi
    if [[ "${exec_start}" == *"Runner.Listener"* ||
      "${exec_start}" == *"Runner.Worker"* ||
      "${exec_start}" == *"/actions-runner/"*"run.sh"* ||
      "${exec_start}" == *"/actions-runner/"*"runsvc.sh"* ||
      "${exec_start}" == *"/github-runners/"*"run.sh"* ||
      "${exec_start}" == *"/github-runners/"*"runsvc.sh"* ||
      "${description}" =~ [Gg]it[Hh]ub.*[Aa]ctions.*[Rr]unner ]]; then
      die "GitHub Actions runner service ${unit} is active; stop all runners before registration"
    fi
  done <<<"${active_services}"
}

limits_for() {
  case "$1" in
    verify*) printf 'CPUQuota=125%%\nMemoryHigh=2500M\nMemoryMax=3G\n' ;;
    *) die "unknown runner instance: $1" ;;
  esac
}

create_accounts() {
  getent group "${LOCK_GROUP}" >/dev/null ||
    groupadd --system "${LOCK_GROUP}"

  local instance account
  for instance in "${INSTANCES[@]}"; do
    account="$(account_for "${instance}")"
    if ! id "${account}" >/dev/null 2>&1; then
      useradd --system --user-group --home-dir "${STATE_ROOT}/${instance}" \
        --shell /usr/sbin/nologin "${account}"
    fi
    usermod --append --groups "${LOCK_GROUP}" "${account}"
    install -d -o "${account}" -g "${account}" -m 0700 "${STATE_ROOT}/${instance}"
  done
}

install_policy_files() {
  install -d -o root -g root -m 0755 "${TOOL_ROOT}/bin"
  install -o root -g root -m 0755 "${SOURCE_DIR}/../../scripts/deploy-window-lock.sh" \
    "${TOOL_ROOT}/bin/deploy-window-lock"
  install -o root -g root -m 0644 "${SOURCE_DIR}/github-0509.slice" \
    /etc/systemd/system/github-0509.slice
  install -o root -g root -m 0644 "${SOURCE_DIR}/github-0509-verify.slice" \
    /etc/systemd/system/github-0509-verify.slice
  install -o root -g root -m 0644 "${SOURCE_DIR}/github-runner-0509@.service" \
    /etc/systemd/system/github-runner-0509@.service
  install -o root -g root -m 0644 "${SOURCE_DIR}/github-runner-0509.tmpfiles" \
    /etc/tmpfiles.d/github-runner-0509.conf
  systemd-tmpfiles --create /etc/tmpfiles.d/github-runner-0509.conf
}

download_runner() {
  local archive="/var/cache/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
  install -d -o root -g root -m 0755 /var/cache
  if [[ ! -f "${archive}" ]]; then
    curl --fail --silent --show-error --location \
      "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" \
      --output "${archive}"
  fi
  printf '%s  %s\n' "${RUNNER_ARCHIVE_SHA256}" "${archive}" | sha256sum --check --status ||
    die "runner archive digest mismatch"
  printf '%s\n' "${archive}"
}

configure_instance() {
  local instance="$1" archive="$2" account labels state token
  account="$(account_for "${instance}")"
  labels="$(labels_for "${instance}")"
  state="${STATE_ROOT}/${instance}"
  if [[ -e "${state}/.runner" ]]; then
    local configured_name configured_url
    configured_name="$(jq -r '.agentName // empty' "${state}/.runner")"
    configured_url="$(jq -r '.gitHubUrl // empty' "${state}/.runner")"
    [[ "${configured_name}" == "0509-hardened-${instance}" ]] ||
      die "${instance} has an unexpected existing runner identity"
    [[ "${configured_url}" == "${REPOSITORY_URL}" ]] ||
      die "${instance} has an unexpected existing repository binding"
    printf 'Validated existing runner identity for %s; skipping registration.\n' "${instance}"
    return 0
  fi

  tar --extract --gzip --file "${archive}" --directory "${state}"
  chown -R "${account}:${account}" "${state}"
  token="$(<"${RUNNER_REGISTRATION_TOKEN_FILE}")"
  [[ -n "${token}" ]] || die "registration token is empty"
  runuser -u "${account}" -- "${state}/config.sh" \
    --unattended \
    --url "${REPOSITORY_URL}" \
    --token "${token}" \
    --name "0509-hardened-${instance}" \
    --labels "${labels}" \
    --work "_work" \
    --disableupdate
  unset token
}

install_limits() {
  local instance dropin
  for instance in "${INSTANCES[@]}"; do
    dropin="/etc/systemd/system/github-runner-0509@${instance}.service.d"
    install -d -o root -g root -m 0755 "${dropin}"
    {
      printf '[Service]\n'
      printf 'Slice=github-0509-verify.slice\n'
      limits_for "${instance}"
    } >"${dropin}/limits.conf"
    chmod 0644 "${dropin}/limits.conf"
  done
}

main() {
  require_root
  secure_token_file
  trap destroy_token_file EXIT
  assert_runner_drain
  create_accounts
  install_policy_files
  install_limits

  local archive instance
  archive="$(download_runner)"
  for instance in "${INSTANCES[@]}"; do
    configure_instance "${instance}" "${archive}"
  done

  destroy_token_file
  trap - EXIT
  systemctl daemon-reload
  printf 'Configured hardened runners. Services remain disabled and stopped for blue-green proof.\n'
  printf 'Enable only after labels, isolation, and one-at-a-time smoke checks pass.\n'
}

main "$@"
