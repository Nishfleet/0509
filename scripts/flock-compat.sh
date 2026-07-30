#!/usr/bin/env bash
# Compatibility shim for legacy 0509 fleet commands that called `flock`
# directly. Exact exclusive waits on the shared deploy-window path are routed
# into the bounded verification pool. Every other flock invocation passes
# through unchanged, including fd-based production acquire/release calls.
set -euo pipefail

REAL_FLOCK="${FLOCK_COMPAT_REAL:-/usr/bin/flock}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
VERIFY_RUNNER="${FLOCK_COMPAT_VERIFY_RUNNER:-${SCRIPT_DIR}/deploy-window-lock.sh}"
LOCK_FILE_OVERRIDE="${FLOCK_COMPAT_LOCK_FILE:-}"
# Coupled to deploy-window-lock.sh's canonical default. When no override is
# supplied, do not export DEPLOY_WINDOW_LOCK_FILE below: the runner resolves
# its own default, so the integration test catches either side drifting.
DEFAULT_LOCK_FILE="${HOME:+${HOME}/.local/state/0509/deploy-window.lock}"
LOCK_FILE="${LOCK_FILE_OVERRIDE:-$DEFAULT_LOCK_FILE}"

if [ ! -x "$REAL_FLOCK" ]; then
  echo "flock-compat: real flock is unavailable at ${REAL_FLOCK}" >&2
  exit 127
fi

if [ "${FLOCK_COMPAT_DISABLE:-0}" != "1" ] &&
   [ "${1:-}" = "--exclusive" ] &&
   [ "${2:-}" = "--wait" ] &&
   [[ "${3:-}" =~ ^[0-9]+([.][0-9]+)?$ ]] &&
   [ -n "$LOCK_FILE" ] &&
   [ "${4:-}" = "$LOCK_FILE" ] &&
   [ "$#" -ge 5 ]; then
  if [ ! -x "$VERIFY_RUNNER" ]; then
    echo "flock-compat: verification runner is unavailable at ${VERIFY_RUNNER}" >&2
    exit 127
  fi
  export DEPLOY_WINDOW_ACQUIRE_TIMEOUT="$3"
  if [ -n "$LOCK_FILE_OVERRIDE" ]; then
    export DEPLOY_WINDOW_LOCK_FILE="$4"
  else
    unset DEPLOY_WINDOW_LOCK_FILE
  fi
  shift 4
  exec "$VERIFY_RUNNER" run -- "$@"
fi

exec "$REAL_FLOCK" "$@"
