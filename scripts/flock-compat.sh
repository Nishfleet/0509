#!/usr/bin/env bash
# Compatibility shim for legacy 0509 fleet commands that called `flock`
# directly. Protected deploy-window calls are parsed deliberately: supported
# exclusive waits enter the verification pool, and every other protected form
# is denied rather than silently bypassing the deploy admission barrier.
set -euo pipefail

REAL_FLOCK="${FLOCK_COMPAT_REAL:-/usr/bin/flock}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
VERIFY_RUNNER="${FLOCK_COMPAT_VERIFY_RUNNER:-${SCRIPT_DIR}/deploy-window-lock.sh}"
LOCK_FILE_OVERRIDE="${FLOCK_COMPAT_LOCK_FILE:-}"
DEFAULT_LOCK_FILE="${HOME:+${HOME}/.local/state/0509/deploy-window.lock}"
LOCK_FILE="${LOCK_FILE_OVERRIDE:-$DEFAULT_LOCK_FILE}"

if [ ! -x "$REAL_FLOCK" ]; then
  echo "flock-compat: real flock is unavailable at ${REAL_FLOCK}" >&2
  exit 127
fi

exclusive=0
wait_seconds=""
unsupported=0
target=""
index=1

# Parse only the command form (`flock [options] lock command...`). fd forms do
# not name the protected lock and retain native flock behavior below.
while [ "$index" -le "$#" ]; do
  argument="${!index}"
  case "$argument" in
    --exclusive|-x)
      exclusive=1
      index=$((index + 1))
      ;;
    --wait|--timeout|-w)
      index=$((index + 1))
      if [ "$index" -gt "$#" ] || [[ ! "${!index}" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
        unsupported=1
      else
        wait_seconds="${!index}"
      fi
      index=$((index + 1))
      ;;
    --wait=*|--timeout=*)
      wait_seconds="${argument#*=}"
      [[ "$wait_seconds" =~ ^[0-9]+([.][0-9]+)?$ ]] || unsupported=1
      index=$((index + 1))
      ;;
    -xw|-wx)
      exclusive=1
      index=$((index + 1))
      if [ "$index" -gt "$#" ] || [[ ! "${!index}" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
        unsupported=1
      else
        wait_seconds="${!index}"
      fi
      index=$((index + 1))
      ;;
    -w[0-9]*|-w.*)
      wait_seconds="${argument#-w}"
      [[ "$wait_seconds" =~ ^[0-9]+([.][0-9]+)?$ ]] || unsupported=1
      index=$((index + 1))
      ;;
    --conflict-exit-code|-E)
      unsupported=1
      index=$((index + 2))
      ;;
    --shared|-s|--unlock|-u|--nonblock|-n|--close|-o|--no-fork|-F|--verbose|-V|--conflict-exit-code=*|-E*)
      unsupported=1
      index=$((index + 1))
      ;;
    --)
      index=$((index + 1))
      [ "$index" -le "$#" ] && target="${!index}"
      break
      ;;
    -*)
      # An unknown option before the target might alter exclusion semantics.
      unsupported=1
      index=$((index + 1))
      ;;
    *)
      target="$argument"
      break
      ;;
  esac
done

if [ -n "$LOCK_FILE" ] && [ "$target" = "$LOCK_FILE" ]; then
  if [ "$exclusive" -ne 1 ] || [ -z "$wait_seconds" ] || [ "$unsupported" -ne 0 ]; then
    echo "flock-compat: unsupported protected lock invocation; use an exclusive bounded wait or deploy-window-lock.sh run -- ..." >&2
    exit 64
  fi
  if [ ! -x "$VERIFY_RUNNER" ]; then
    echo "flock-compat: verification runner is unavailable at ${VERIFY_RUNNER}" >&2
    exit 127
  fi
  # Everything following the lock argument is the legacy command. Options are
  # permitted in any order before it, but never forwarded to real flock.
  index=$((index + 1))
  export DEPLOY_WINDOW_ACQUIRE_TIMEOUT="$wait_seconds"
  if [ -n "$LOCK_FILE_OVERRIDE" ]; then
    export DEPLOY_WINDOW_LOCK_FILE="$target"
  else
    unset DEPLOY_WINDOW_LOCK_FILE
  fi
  exec "$VERIFY_RUNNER" run -- "${@:$index}"
fi

exec "$REAL_FLOCK" "$@"
