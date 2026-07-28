#!/usr/bin/env bash
# Deploy-window lock for heavy work on the shared self-hosted VPS runner.
#
# In-repo production deploys and heavy PR checks use acquire/release. Fleet
# builder lanes join the same exclusion boundary only when their orchestrator
# dispatches them through `run --`; this script cannot enforce unwrapped work.
#
# Usage:
#   deploy-window-lock.sh acquire        # wait, then hold across later CI steps
#   deploy-window-lock.sh release        # release the proven current owner
#   deploy-window-lock.sh run -- <cmd>   # run one heavy command under the lock
#
# GitHub Actions receives the private release capability through $GITHUB_ENV.
# Local callers must set DEPLOY_WINDOW_CAPABILITY_FILE to their own private
# scratch path for the acquire/release pair; no capability is stored beside
# the shared lock where another caller could discover it.
#
# The lock lives outside every checkout so worktrees owned by the same runner
# user share it. The detached holder self-expires after HOLD_CAP seconds. Its
# owner record is written only after it owns the main flock and every owner
# record mutation is serialized by a separate metadata flock.
set -euo pipefail

LOCK_FILE="${DEPLOY_WINDOW_LOCK_FILE:-${HOME}/.local/state/0509/deploy-window.lock}"
OWNER_FILE="${LOCK_FILE}.held"
META_LOCK_FILE="${LOCK_FILE}.meta.lock"
ACQUIRE_TIMEOUT="${DEPLOY_WINDOW_ACQUIRE_TIMEOUT:-10800}"
HOLD_CAP="${DEPLOY_WINDOW_HOLD_CAP:-21600}"
POLL_INTERVAL="${DEPLOY_WINDOW_POLL_INTERVAL:-0.1}"
CAPABILITY_FILE="${DEPLOY_WINDOW_CAPABILITY_FILE:-}"
RELEASE_TOKEN="${DEPLOY_WINDOW_RELEASE_TOKEN:-}"
if [ -n "${DEPLOY_WINDOW_CALLER_ID:-}" ]; then
  CALLER_ID="$DEPLOY_WINDOW_CALLER_ID"
elif [ -n "${GITHUB_RUN_ID:-}" ]; then
  CALLER_ID="gha-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT:-0}-${GITHUB_JOB:-job}"
else
  CALLER_ID="local-${PPID}"
fi

mkdir -p "$(dirname "$LOCK_FILE")"

is_duration() {
  [[ "$1" =~ ^[0-9]+([.][0-9]+)?$ ]]
}

process_start_time() {
  local pid="$1"
  awk '{ print $22 }' "/proc/${pid}/stat" 2>/dev/null || true
}

process_state() {
  local pid="$1"
  awk '{ print $3 }' "/proc/${pid}/stat" 2>/dev/null || true
}

process_group_id() {
  local pid="$1"
  local stat_line stat_fields

  stat_line="$(<"/proc/${pid}/stat")" 2>/dev/null || return 1
  stat_fields="${stat_line##*) }"
  read -r -a stat_fields <<<"$stat_fields"
  printf '%s\n' "${stat_fields[2]:-}"
}

capability_verifier() {
  local token="$1"

  printf '%s' "$token" | sha256sum | awk '{ print $1 }'
}

process_identity_is_live() {
  local pid="$1"
  local expected_start="$2"
  local current_start current_state

  kill -0 "$pid" 2>/dev/null || return 1
  current_start="$(process_start_time "$pid")"
  current_state="$(process_state "$pid")"
  [ "$current_start" = "$expected_start" ] && [ "$current_state" != "Z" ]
}

lock_metadata() {
  exec 8>"$META_LOCK_FILE"
  flock --exclusive 8
}

unlock_metadata() {
  flock --unlock 8
  exec 8>&-
}

read_owner_unlocked() {
  OWNER_PID=""
  OWNER_START=""
  OWNER_TOKEN=""
  OWNER_CALLER=""
  OWNER_EXTRA=""

  if [ -f "$OWNER_FILE" ]; then
    read -r OWNER_PID OWNER_START OWNER_TOKEN OWNER_CALLER OWNER_EXTRA <"$OWNER_FILE" || true
  fi
}

recorded_process_is_alive() {
  [[ "$OWNER_PID" =~ ^[1-9][0-9]*$ ]] || return 1
  [[ "$OWNER_START" =~ ^[1-9][0-9]*$ ]] || return 1
  [ -n "$OWNER_TOKEN" ] || return 1
  [ -n "$OWNER_CALLER" ] || return 1
  [ -z "$OWNER_EXTRA" ] || return 1
  process_identity_is_live "$OWNER_PID" "$OWNER_START"
}

recorded_owner_is_proven() {
  recorded_process_is_alive || return 1
  [ "/proc/${OWNER_PID}/fd/9" -ef "$LOCK_FILE" ] 2>/dev/null || return 1
  awk '
    $1 == "lock:" && $3 == "FLOCK" && $5 == "WRITE" {
      found = 1
    }
    END { exit(found ? 0 : 1) }
  ' "/proc/${OWNER_PID}/fdinfo/9" 2>/dev/null || return 1

  # Kernel proof is paired with an independent contention probe. Success here
  # would mean the recorded process cannot be accepted as the current owner.
  if flock --exclusive --nonblock "$LOCK_FILE" true 2>/dev/null; then
    return 1
  fi
}

remove_records_if_token() {
  local expected_token="$1"
  local expected_verifier capability_token=""

  expected_verifier="$(capability_verifier "$expected_token")"

  lock_metadata
  read_owner_unlocked
  if [ "$OWNER_TOKEN" = "$expected_verifier" ]; then
    rm -f -- "$OWNER_FILE"
  fi
  if [ -n "$CAPABILITY_FILE" ] && [ -f "$CAPABILITY_FILE" ]; then
    read -r capability_token <"$CAPABILITY_FILE" || true
  fi
  if [ "$capability_token" = "$expected_token" ]; then
    rm -f -- "$CAPABILITY_FILE"
  fi
  unlock_metadata
}

publish_capability_unlocked() {
  local token="$1"

  umask 077
  if [ -n "${GITHUB_ENV:-}" ]; then
    printf 'DEPLOY_WINDOW_RELEASE_TOKEN=%s\n' "$token" >>"$GITHUB_ENV"
  fi
  if [ -n "$CAPABILITY_FILE" ]; then
    mkdir -p "$(dirname "$CAPABILITY_FILE")"
    printf '%s\n' "$token" >"$CAPABILITY_FILE"
  fi
}

load_release_token() {
  if [ -n "$RELEASE_TOKEN" ]; then
    return 0
  fi
  if [ -n "$CAPABILITY_FILE" ] && [ -f "$CAPABILITY_FILE" ]; then
    read -r RELEASE_TOKEN <"$CAPABILITY_FILE" || true
  fi
  [ -n "$RELEASE_TOKEN" ]
}

validate_durations() {
  local name value

  for name in ACQUIRE_TIMEOUT HOLD_CAP POLL_INTERVAL; do
    value="${!name}"
    if ! is_duration "$value"; then
      echo "deploy-window-lock: ${name} must be a non-negative number of seconds (got '${value}')." >&2
      exit 64
    fi
  done

  if [[ "$HOLD_CAP" =~ ^0+([.]0+)?$ ]] || [[ "$POLL_INTERVAL" =~ ^0+([.]0+)?$ ]]; then
    echo "deploy-window-lock: HOLD_CAP and POLL_INTERVAL must be greater than zero." >&2
    exit 64
  fi
  if [[ ! "$CALLER_ID" =~ ^[A-Za-z0-9_.-]+$ ]]; then
    echo "deploy-window-lock: caller ID contains unsupported characters: '${CALLER_ID}'." >&2
    exit 64
  fi
}

acquire_window() {
  local existing_pid acquire_token acquire_verifier
  local holder_pid="" holder_start=""
  local acquire_complete=0

  if [ -z "${GITHUB_ENV:-}" ] && [ -z "$CAPABILITY_FILE" ]; then
    echo "deploy-window-lock: acquire needs GITHUB_ENV or DEPLOY_WINDOW_CAPABILITY_FILE to pass its private release capability." >&2
    return 64
  fi

  lock_metadata
  read_owner_unlocked
  if [ -f "$OWNER_FILE" ]; then
    existing_pid="${OWNER_PID:-unknown}"
    if recorded_owner_is_proven; then
      unlock_metadata
      echo "deploy-window-lock: lock already has a proven owner PID ${existing_pid}; refusing a second acquire." >&2
      echo "If no active CI job owns that PID, it is a live orphan; release it explicitly or wait for its hold cap." >&2
      return 1
    fi

    rm -f -- "$OWNER_FILE"
    unlock_metadata
    echo "deploy-window-lock: removed a stale owner record for PID ${existing_pid}; acquire failed safely." >&2
    echo "Re-run acquire now that the stale record has been cleaned." >&2
    return 1
  fi
  unlock_metadata

  acquire_token="$(< /proc/sys/kernel/random/uuid)"
  acquire_verifier="$(capability_verifier "$acquire_token")"

  holder_is_live() {
    [ -n "$holder_pid" ] || return 1
    if [ -n "$holder_start" ]; then
      process_identity_is_live "$holder_pid" "$holder_start"
    else
      kill -0 "$holder_pid" 2>/dev/null
    fi
  }

  cleanup_started_holder() {
    local attempts holder_pgid

    if holder_is_live; then
      holder_pgid="$(process_group_id "$holder_pid")"
      if [ "$holder_pgid" = "$holder_pid" ]; then
        kill -TERM -- "-${holder_pid}" 2>/dev/null || true
      else
        kill -TERM "$holder_pid" 2>/dev/null || true
      fi
    fi

    for attempts in {1..50}; do
      if ! holder_is_live; then
        break
      fi
      sleep 0.02
    done

    if holder_is_live; then
      holder_pgid="$(process_group_id "$holder_pid")"
      if [ "$holder_pgid" = "$holder_pid" ]; then
        kill -KILL -- "-${holder_pid}" 2>/dev/null || true
      else
        kill -KILL "$holder_pid" 2>/dev/null || true
      fi
    fi
    if [ -n "$holder_pid" ]; then
      wait "$holder_pid" 2>/dev/null || true
    fi
    remove_records_if_token "$acquire_token"
  }

  fail_started_acquire() {
    trap - EXIT INT TERM
    cleanup_started_holder
  }

  interrupt_acquire() {
    local exit_code="$1"

    trap - EXIT INT TERM
    cleanup_started_holder
    exit "$exit_code"
  }

  # Traps are live before the detached process exists, so every post-spawn
  # interrupt and unexpected exit cleans the exact holder this caller started.
  trap 'interrupt_acquire 130' INT
  trap 'interrupt_acquire 143' TERM
  trap 'if [ "$acquire_complete" -ne 1 ]; then cleanup_started_holder; fi' EXIT

  # The holder keeps fd 9 open across CI steps. Its flock waiter and capped
  # sleep explicitly do not inherit fd 9, so killing the holder cannot leave a
  # child process holding or later acquiring the main lock.
  setsid bash -c '
    set -euo pipefail

    lock_file="$1"
    acquire_timeout="$2"
    hold_cap="$3"
    owner_file="$4"
    meta_lock_file="$5"
    owner_verifier="$6"
    owner_caller="$7"
    capability_file="$8"
    flock_pid=""
    sleeper_pid=""

    stat_line="$(<"/proc/$$/stat")"
    stat_fields="${stat_line##*) }"
    read -r -a stat_fields <<<"$stat_fields"
    holder_start="${stat_fields[19]}"

    cleanup() {
      local current_pid="" current_start="" current_token="" current_caller="" extra=""
      local capability_token="" capability_hash=""

      trap - EXIT INT TERM
      if [ -n "$flock_pid" ]; then
        kill "$flock_pid" 2>/dev/null || true
        wait "$flock_pid" 2>/dev/null || true
      fi
      if [ -n "$sleeper_pid" ]; then
        kill "$sleeper_pid" 2>/dev/null || true
        wait "$sleeper_pid" 2>/dev/null || true
      fi

      exec 8>"$meta_lock_file"
      flock --exclusive 8 9>&-
      if [ -f "$owner_file" ]; then
        read -r current_pid current_start current_token current_caller extra <"$owner_file" || true
      fi
      if [ "$current_pid" = "$$" ] &&
         [ "$current_start" = "$holder_start" ] &&
         [ "$current_token" = "$owner_verifier" ] &&
         [ "$current_caller" = "$owner_caller" ] &&
         [ -z "$extra" ]; then
        rm -f -- "$owner_file"
      fi
      if [ -n "$capability_file" ] && [ -f "$capability_file" ]; then
        read -r capability_token <"$capability_file" || true
      fi
      if [ -n "$capability_token" ]; then
        read -r capability_hash _ < <(printf "%s" "$capability_token" | sha256sum)
      fi
      if [ "$capability_hash" = "$owner_verifier" ]; then
        rm -f -- "$capability_file"
      fi
      flock --unlock 8 9>&-
      exec 8>&-
    }

    trap cleanup EXIT
    trap "exit 130" INT
    trap "exit 143" TERM

    exec 9>"$lock_file"
    flock --exclusive --wait "$acquire_timeout" 9 </dev/null >/dev/null 2>&1 &
    flock_pid=$!
    if ! wait "$flock_pid"; then
      flock_pid=""
      exit 99
    fi
    flock_pid=""

    exec 8>"$meta_lock_file"
    flock --exclusive 8 9>&-
    if [ -e "$owner_file" ]; then
      flock --unlock 8 9>&-
      exec 8>&-
      exit 98
    fi
    umask 077
    printf "%s %s %s %s\n" "$$" "$holder_start" "$owner_verifier" "$owner_caller" >"$owner_file"
    flock --unlock 8 9>&-
    exec 8>&-

    sleep "$hold_cap" 9>&- </dev/null >/dev/null 2>&1 &
    sleeper_pid=$!
    wait "$sleeper_pid" 2>/dev/null || true
    sleeper_pid=""
  ' holder "$LOCK_FILE" "$ACQUIRE_TIMEOUT" "$HOLD_CAP" "$OWNER_FILE" "$META_LOCK_FILE" "$acquire_verifier" "$CALLER_ID" "$CAPABILITY_FILE" </dev/null >/dev/null 2>&1 &
  holder_pid=$!
  holder_start="$(process_start_time "$holder_pid")"

  while kill -0 "$holder_pid" 2>/dev/null; do
    sleep "$POLL_INTERVAL"
    lock_metadata
    read_owner_unlocked

    if [ -f "$OWNER_FILE" ]; then
      existing_pid="${OWNER_PID:-unknown}"
      if [ "$OWNER_TOKEN" = "$acquire_verifier" ]; then
        if recorded_owner_is_proven &&
           [ "$OWNER_PID" = "$holder_pid" ] &&
           [ "$OWNER_START" = "$holder_start" ] &&
           [ "$OWNER_CALLER" = "$CALLER_ID" ]; then
          publish_capability_unlocked "$acquire_token"
          unlock_metadata
          echo "deploy window acquired (holder pid ${holder_pid}, self-expires in ${HOLD_CAP}s)"
          acquire_complete=1
          exit 0
        fi

        rm -f -- "$OWNER_FILE"
        unlock_metadata
        echo "deploy-window-lock: holder PID ${existing_pid} died or lost its flock after registering; acquire failed safely." >&2
        fail_started_acquire
        return 1
      fi

      if recorded_owner_is_proven; then
        unlock_metadata
        echo "deploy-window-lock: lock became owned by proven owner PID ${existing_pid}; refusing a second acquire." >&2
        fail_started_acquire
        return 1
      fi

      rm -f -- "$OWNER_FILE"
      unlock_metadata
      echo "deploy-window-lock: removed an invalid competing owner record for PID ${existing_pid}; acquire failed safely." >&2
      fail_started_acquire
      return 1
    fi
    unlock_metadata
  done

  wait "$holder_pid" 2>/dev/null || true
  echo "deploy-window-lock: gave up after ${ACQUIRE_TIMEOUT}s; an unregistered fleet lane still holds ${LOCK_FILE}." >&2
  echo "Finish or stop the lane, then re-run this job." >&2
  fail_started_acquire
  return 1
}

release_window() {
  local target_pid target_start target_token release_verifier attempts

  if ! load_release_token; then
    echo "deploy window not released (caller has no successful-acquire capability)"
    return 0
  fi
  release_verifier="$(capability_verifier "$RELEASE_TOKEN")"
  lock_metadata
  read_owner_unlocked

  if [ ! -f "$OWNER_FILE" ]; then
    if [ -n "$CAPABILITY_FILE" ]; then
      rm -f -- "$CAPABILITY_FILE"
    fi
    unlock_metadata
    echo "deploy window already released (no registered owner)"
    return 0
  fi

  target_pid="${OWNER_PID:-unknown}"
  target_start="$OWNER_START"
  target_token="$OWNER_TOKEN"

  if [ "$target_token" != "$release_verifier" ]; then
    if [ -n "$CAPABILITY_FILE" ]; then
      rm -f -- "$CAPABILITY_FILE"
    fi
    unlock_metadata
    echo "deploy window not released (capability does not own PID ${target_pid})"
    return 0
  fi

  if ! recorded_owner_is_proven; then
    if ! recorded_process_is_alive; then
      rm -f -- "$OWNER_FILE"
      if [ -n "$CAPABILITY_FILE" ]; then
        rm -f -- "$CAPABILITY_FILE"
      fi
      unlock_metadata
      echo "deploy-window-lock: cleaned a stale owner record for PID ${target_pid}; no process was signalled." >&2
      return 0
    fi

    unlock_metadata
    echo "deploy-window-lock: refusing to signal live PID ${target_pid}; it is not provably the current lock owner." >&2
    return 1
  fi

  kill -TERM "$target_pid"
  unlock_metadata

  attempts=0
  while [ "$attempts" -lt 10 ]; do
    attempts=$((attempts + 1))
    if ! process_identity_is_live "$target_pid" "$target_start"; then
      break
    fi
    sleep 0.02
  done

  if process_identity_is_live "$target_pid" "$target_start"; then
    # This is still the exact PID/start-time identity proven above.
    kill -KILL "$target_pid" 2>/dev/null || true
  fi

  for attempts in {1..25}; do
    if ! process_identity_is_live "$target_pid" "$target_start"; then
      break
    fi
    sleep 0.02
  done

  if process_identity_is_live "$target_pid" "$target_start"; then
    echo "deploy-window-lock: proven owner PID ${target_pid} did not exit; lock release failed." >&2
    return 1
  fi

  remove_records_if_token "$RELEASE_TOKEN"
  echo "deploy window released (owner pid ${target_pid})"
}

validate_durations

case "${1:-}" in
  acquire)
    acquire_window
    ;;

  release)
    release_window
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
