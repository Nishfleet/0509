#!/usr/bin/env bash
# Deploy-window lock: serializes heavy work on the shared self-hosted VPS
# runner so production deploys never contend with fleet builder lanes for the
# same CPU/RAM. Adopted 2026-07-28 after every recent hard deploy failure
# correlated with a concurrent heavy lane on the box — run 30318665935 died
# at the job timeout inside setup-node while a builder lane's npm ci + agent
# saturated the machine.
#
# Usage:
#   deploy-window-lock.sh acquire        # CI: wait for the box, then hold the
#                                        # lock in a detached holder process
#                                        # that survives across job steps
#   deploy-window-lock.sh release        # CI: drop the hold (if: always())
#   deploy-window-lock.sh run -- <cmd>   # lane side: run one heavy command
#                                        # under the same lock
#
# The lock file lives in $HOME, outside any checkout, so every worktree and
# the CI runner on the machine share one lock. On ephemeral hosted runners
# the file is per-VM and the lock is inert — the guard costs nothing there.
#
# The holder self-expires after DEPLOY_WINDOW_HOLD_CAP seconds so a crashed
# job that never ran `release` cannot wedge the box forever.
set -euo pipefail

LOCK_FILE="${DEPLOY_WINDOW_LOCK_FILE:-${HOME}/.local/state/0509/deploy-window.lock}"
HOLDER_PID_FILE="${LOCK_FILE}.holder-pid"
HELD_SENTINEL="${LOCK_FILE}.held"
ACQUIRE_TIMEOUT="${DEPLOY_WINDOW_ACQUIRE_TIMEOUT:-10800}"
HOLD_CAP="${DEPLOY_WINDOW_HOLD_CAP:-21600}"

mkdir -p "$(dirname "$LOCK_FILE")"

case "${1:-}" in
  acquire)
    rm -f "$HELD_SENTINEL"
    # setsid detaches the holder from the step's process tree so it keeps
    # holding the flock across subsequent job steps; exec keeps fd 9 (and
    # therefore the lock) open for the lifetime of the capped sleep.
    setsid bash -c '
      exec 9>"$1"
      flock --exclusive --wait "$2" 9 || exit 99
      echo "$$" > "$1.held"
      exec sleep "$3"
    ' holder "$LOCK_FILE" "$ACQUIRE_TIMEOUT" "$HOLD_CAP" &
    holder_pid=$!
    echo "$holder_pid" > "$HOLDER_PID_FILE"

    elapsed=0
    while kill -0 "$holder_pid" 2>/dev/null && [ ! -f "$HELD_SENTINEL" ]; do
      sleep 5
      elapsed=$((elapsed + 5))
      if [ $((elapsed % 60)) -eq 0 ]; then
        echo "deploy window busy — waited ${elapsed}s (max ${ACQUIRE_TIMEOUT}s)"
      fi
    done

    if [ ! -f "$HELD_SENTINEL" ]; then
      echo "deploy-window-lock: gave up after ${ACQUIRE_TIMEOUT}s — a fleet lane still holds ${LOCK_FILE}." >&2
      echo "Finish or stop the lane, then re-run this deploy." >&2
      rm -f "$HOLDER_PID_FILE"
      exit 1
    fi
    echo "deploy window acquired (holder pid ${holder_pid}, self-expires in ${HOLD_CAP}s)"
    ;;

  release)
    if [ -f "$HOLDER_PID_FILE" ]; then
      holder_pid="$(cat "$HOLDER_PID_FILE")"
      if [ -n "$holder_pid" ]; then
        kill "$holder_pid" 2>/dev/null || true
      fi
      rm -f "$HOLDER_PID_FILE"
    fi
    rm -f "$HELD_SENTINEL"
    echo "deploy window released"
    ;;

  run)
    shift
    if [ "${1:-}" = "--" ]; then
      shift
    fi
    if [ "$#" -eq 0 ]; then
      echo "deploy-window-lock: run requires a command" >&2
      exit 64
    fi
    exec flock --exclusive --wait "$ACQUIRE_TIMEOUT" "$LOCK_FILE" "$@"
    ;;

  *)
    echo "usage: deploy-window-lock.sh {acquire|release|run -- <cmd...>}" >&2
    exit 64
    ;;
esac
