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
#   deploy-window-lock.sh run -- <cmd>   # run in the bounded verification pool
#
# Every caller must provide DEPLOY_WINDOW_CAPABILITY_FILE: a private, mode-0600
# scratch file shared only by its acquire/release steps. Never put the release
# capability in GITHUB_ENV, which exposes it to every later workflow step.
#
# The lock lives outside every checkout so worktrees owned by the same runner
# user share it. The detached holder self-expires after HOLD_CAP seconds. Its
# owner record is written only after it owns the main flock and every owner
# record mutation is serialized by a separate metadata flock.
set -euo pipefail

LOCK_FILE="${DEPLOY_WINDOW_LOCK_FILE:-${HOME}/.local/state/0509/deploy-window.lock}"
OWNER_FILE="${LOCK_FILE}.held"
META_LOCK_FILE="${LOCK_FILE}.meta.lock"
ADMISSION_LOCK_FILE="${LOCK_FILE}.admission.lock"
ACQUIRE_TIMEOUT="${DEPLOY_WINDOW_ACQUIRE_TIMEOUT:-10800}"
HOLD_CAP="${DEPLOY_WINDOW_HOLD_CAP:-21600}"
POLL_INTERVAL="${DEPLOY_WINDOW_POLL_INTERVAL:-0.1}"
VERIFY_SLOTS="${DEPLOY_WINDOW_VERIFY_SLOTS:-3}"
VERIFY_ROOT="${DEPLOY_WINDOW_VERIFY_ROOT:-${LOCK_FILE}.verify}"
VERIFY_TMP_ROOT="${DEPLOY_WINDOW_VERIFY_TMP_ROOT:-${TMPDIR:-/tmp}/0509-verification-$(id -u)}"
VERIFY_POLL_INTERVAL="${DEPLOY_WINDOW_VERIFY_POLL_INTERVAL:-0.1}"
VERIFY_PORT_BASE="${DEPLOY_WINDOW_VERIFY_PORT_BASE:-4190}"
CAPABILITY_FILE="${DEPLOY_WINDOW_CAPABILITY_FILE:-}"
RELEASE_TOKEN=""
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

  if [ -s "$OWNER_FILE" ]; then
    read -r OWNER_PID OWNER_START OWNER_TOKEN OWNER_CALLER OWNER_EXTRA <"$OWNER_FILE" || true
  fi
}

owner_record_present() {
  [ -s "$OWNER_FILE" ]
}

clear_owner_record_unlocked() {
  # `.held` can be pre-created root:gha0509-lock 0660. Truncate instead of
  # unlinking so a different runner user neither changes its inode nor needs
  # directory ownership to recover a stale record.
  : >"$OWNER_FILE"
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
    clear_owner_record_unlocked
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
  local token="$1" capability_directory capability_temp

  [ -n "$CAPABILITY_FILE" ] || return 1
  if [ -L "$CAPABILITY_FILE" ]; then
    echo "deploy-window-lock: refusing symlinked capability file ${CAPABILITY_FILE}." >&2
    return 1
  fi
  capability_directory="$(dirname "$CAPABILITY_FILE")"
  umask 077
  mkdir -p "$capability_directory"
  capability_temp="$(mktemp "${capability_directory}/.deploy-window-capability.XXXXXX")"
  printf '%s\n' "$token" >"$capability_temp"
  chmod 600 "$capability_temp"
  mv -f -- "$capability_temp" "$CAPABILITY_FILE"
}

load_release_token() {
  if [ -n "$CAPABILITY_FILE" ] && [ -f "$CAPABILITY_FILE" ]; then
    read -r RELEASE_TOKEN <"$CAPABILITY_FILE" || true
  fi
  [ -n "$RELEASE_TOKEN" ]
}

validate_durations() {
  local mode="$1"
  local name value
  local -a names

  case "$mode" in
    acquire)
      names=(ACQUIRE_TIMEOUT HOLD_CAP POLL_INTERVAL)
      ;;
    run)
      names=(ACQUIRE_TIMEOUT VERIFY_POLL_INTERVAL)
      ;;
    *)
      echo "deploy-window-lock: unsupported validation mode '${mode}'." >&2
      exit 64
      ;;
  esac

  for name in "${names[@]}"; do
    value="${!name}"
    if ! is_duration "$value"; then
      echo "deploy-window-lock: ${name} must be a non-negative number of seconds (got '${value}')." >&2
      exit 64
    fi
  done

  if [ "$mode" = "acquire" ] &&
     { [[ "$HOLD_CAP" =~ ^0+([.]0+)?$ ]] || [[ "$POLL_INTERVAL" =~ ^0+([.]0+)?$ ]]; }; then
    echo "deploy-window-lock: HOLD_CAP and POLL_INTERVAL must be greater than zero." >&2
    exit 64
  fi
  if [ "$mode" = "run" ] && [[ "$VERIFY_POLL_INTERVAL" =~ ^0+([.]0+)?$ ]]; then
    echo "deploy-window-lock: VERIFY_POLL_INTERVAL must be greater than zero." >&2
    exit 64
  fi
  if [ "$mode" = "run" ] &&
     { [[ ! "$VERIFY_SLOTS" =~ ^[1-9][0-9]*$ ]] || [ "$VERIFY_SLOTS" -gt 8 ]; }; then
    echo "deploy-window-lock: DEPLOY_WINDOW_VERIFY_SLOTS must be an integer from 1 through 8." >&2
    exit 64
  fi
  if [ "$mode" = "run" ] &&
     { [[ ! "$VERIFY_PORT_BASE" =~ ^[0-9]+$ ]] ||
       [ "$VERIFY_PORT_BASE" -lt 1024 ] ||
       [ "$VERIFY_PORT_BASE" -gt 65527 ]; }; then
    echo "deploy-window-lock: DEPLOY_WINDOW_VERIFY_PORT_BASE must be an integer from 1024 through 65527." >&2
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

  if [ -z "$CAPABILITY_FILE" ]; then
    echo "deploy-window-lock: acquire needs DEPLOY_WINDOW_CAPABILITY_FILE for its private release capability." >&2
    return 64
  fi

  lock_metadata
  read_owner_unlocked
  if owner_record_present; then
    existing_pid="${OWNER_PID:-unknown}"
    if recorded_owner_is_proven; then
      unlock_metadata
      echo "deploy-window-lock: lock already has a proven owner PID ${existing_pid}; refusing a second acquire." >&2
      echo "If no active CI job owns that PID, it is a live orphan; release it explicitly or wait for its hold cap." >&2
      return 1
    fi

    clear_owner_record_unlocked
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
  # shellcheck disable=SC2016 # The single-quoted program expands in the holder.
  setsid bash -c '
    set -euo pipefail

    lock_file="$1"
    admission_lock_file="$2"
    acquire_timeout="$3"
    hold_cap="$4"
    owner_file="$5"
    meta_lock_file="$6"
    owner_verifier="$7"
    owner_caller="$8"
    capability_file="$9"
    flock_pid=""
    sleeper_pid=""
    deadline=""
    remaining=""

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
      flock --exclusive 8 7>&- 9>&-
      if [ -s "$owner_file" ]; then
        read -r current_pid current_start current_token current_caller extra <"$owner_file" || true
      fi
      if [ "$current_pid" = "$$" ] &&
         [ "$current_start" = "$holder_start" ] &&
         [ "$current_token" = "$owner_verifier" ] &&
         [ "$current_caller" = "$owner_caller" ] &&
         [ -z "$extra" ]; then
        : >"$owner_file"
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
      flock --unlock 8 7>&- 9>&-
      exec 8>&-
    }

    trap cleanup EXIT
    trap "exit 130" INT
    trap "exit 143" TERM

    deadline="$(awk -v now="$(date +%s.%N)" -v wait="$acquire_timeout" \
      "BEGIN { printf \"%.9f\", now + wait }")"

    # Production takes the admission turnstile before the deploy gate. New
    # shared entrants stop here while already-admitted lanes drain.
    exec 7>"$admission_lock_file"
    remaining="$(awk -v now="$(date +%s.%N)" -v deadline="$deadline" \
      "BEGIN { left = deadline - now; printf \"%.9f\", (left > 0 ? left : 0) }")"
    flock --exclusive --wait "$remaining" 7 9>&- </dev/null >/dev/null 2>&1 &
    flock_pid=$!
    if ! wait "$flock_pid"; then
      flock_pid=""
      exit 99
    fi
    flock_pid=""

    exec 9>"$lock_file"
    remaining="$(awk -v now="$(date +%s.%N)" -v deadline="$deadline" \
      "BEGIN { left = deadline - now; printf \"%.9f\", (left > 0 ? left : 0) }")"
    flock --exclusive --wait "$remaining" 9 7>&- </dev/null >/dev/null 2>&1 &
    flock_pid=$!
    if ! wait "$flock_pid"; then
      flock_pid=""
      exit 99
    fi
    flock_pid=""

    exec 8>"$meta_lock_file"
    flock --exclusive 8 7>&- 9>&-
    if [ -s "$owner_file" ]; then
      flock --unlock 8 7>&- 9>&-
      exec 8>&-
      exit 98
    fi
    umask 077
    printf "%s %s %s %s\n" "$$" "$holder_start" "$owner_verifier" "$owner_caller" >"$owner_file"
    flock --unlock 8 7>&- 9>&-
    exec 8>&-

    sleep "$hold_cap" 7>&- 9>&- </dev/null >/dev/null 2>&1 &
    sleeper_pid=$!
    wait "$sleeper_pid" 2>/dev/null || true
    sleeper_pid=""
  ' holder "$LOCK_FILE" "$ADMISSION_LOCK_FILE" "$ACQUIRE_TIMEOUT" "$HOLD_CAP" "$OWNER_FILE" "$META_LOCK_FILE" "$acquire_verifier" "$CALLER_ID" "$CAPABILITY_FILE" </dev/null >/dev/null 2>&1 &
  holder_pid=$!
  holder_start="$(process_start_time "$holder_pid")"

  while kill -0 "$holder_pid" 2>/dev/null; do
    sleep "$POLL_INTERVAL"
    lock_metadata
    read_owner_unlocked

    if owner_record_present; then
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

        clear_owner_record_unlocked
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

      clear_owner_record_unlocked
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

  if ! owner_record_present; then
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
      clear_owner_record_unlocked
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

run_in_verification_lane() {
  local deadline now remaining slot candidate_fd slot_fd="" admission_fd gate_fd result lane_tmp default_port
  local lane_holder_pid="" queue_lock_fd="" queue_ticket="" queue_ticket_start=""
  local queue_dir="${VERIFY_ROOT}/queue" queue_lock_file="${VERIFY_ROOT}/queue.lock"

  remove_queue_ticket() {
    local ticket="$queue_ticket"

    [ -n "$ticket" ] || return 0
    exec {queue_lock_fd}>"$queue_lock_file"
    flock --exclusive "$queue_lock_fd"
    rm -f -- "$ticket"
    flock --unlock "$queue_lock_fd"
    exec {queue_lock_fd}>&-
    queue_lock_fd=""
    queue_ticket=""
  }

  purge_stale_queue_tickets_locked() {
    local candidate name candidate_pid candidate_start
    local -a candidates

    candidates=("$queue_dir"/*)
    for candidate in "${candidates[@]}"; do
      [ -e "$candidate" ] || continue
      name="$(basename "$candidate")"
      if [ "$name" = "next-ticket" ]; then
        continue
      fi
      if [[ ! "$name" =~ ^[0-9]{20}[.][1-9][0-9]*[.][1-9][0-9]*$ ]]; then
        rm -f -- "$candidate"
        continue
      fi
      candidate_pid="${name#*.}"
      candidate_pid="${candidate_pid%%.*}"
      candidate_start="${name##*.}"
      if ! process_identity_is_live "$candidate_pid" "$candidate_start"; then
        rm -f -- "$candidate"
      fi
    done
  }

  enqueue_verification_ticket() {
    local next_ticket

    queue_ticket_start="$(process_start_time "$$")"
    if [[ ! "$queue_ticket_start" =~ ^[1-9][0-9]*$ ]]; then
      echo "deploy-window-lock: could not establish verification queue identity." >&2
      return 70
    fi
    exec {queue_lock_fd}>"$queue_lock_file"
    flock --exclusive "$queue_lock_fd"
    purge_stale_queue_tickets_locked
    next_ticket=0
    if [ -f "${queue_dir}/next-ticket" ]; then
      read -r next_ticket <"${queue_dir}/next-ticket" || true
    fi
    if [[ ! "$next_ticket" =~ ^[0-9]+$ ]]; then
      flock --unlock "$queue_lock_fd"
      exec {queue_lock_fd}>&-
      queue_lock_fd=""
      echo "deploy-window-lock: verification queue counter is invalid; refusing admission." >&2
      return 70
    fi
    next_ticket=$((10#$next_ticket + 1))
    # `next-ticket` may be pre-created root:gha0509-lock 0660. Keep its
    # inode stable so recovery never depends on a runner owning this dir.
    printf '%020d\n' "$next_ticket" >"${queue_dir}/next-ticket"
    queue_ticket="${queue_dir}/$(printf '%020d' "$next_ticket").$$.${queue_ticket_start}"
    (umask 007; : >"$queue_ticket")
    flock --unlock "$queue_lock_fd"
    exec {queue_lock_fd}>&-
    queue_lock_fd=""
  }

  claim_next_verification_slot() {
    local candidate name head=""
    local -a candidates

    exec {queue_lock_fd}>"$queue_lock_file"
    flock --exclusive "$queue_lock_fd"
    purge_stale_queue_tickets_locked
    candidates=("$queue_dir"/*.*.*)
    for candidate in "${candidates[@]}"; do
      [ -e "$candidate" ] || continue
      name="$(basename "$candidate")"
      [[ "$name" =~ ^[0-9]{20}[.][1-9][0-9]*[.][1-9][0-9]*$ ]] || continue
      head="$candidate"
      break
    done
    if [ "$head" = "$queue_ticket" ]; then
      for ((slot = 1; slot <= VERIFY_SLOTS; slot += 1)); do
        exec {candidate_fd}>"${VERIFY_ROOT}/slot-${slot}.lock"
        if flock --exclusive --nonblock "$candidate_fd"; then
          slot_fd="$candidate_fd"
          rm -f -- "$queue_ticket"
          queue_ticket=""
          break
        fi
        exec {candidate_fd}>&-
      done
    fi
    flock --unlock "$queue_lock_fd"
    exec {queue_lock_fd}>&-
    queue_lock_fd=""
  }

  reap_lane_holder() {
    local attempts=0

    [ -n "$lane_holder_pid" ] || return 0
    if kill -0 "$lane_holder_pid" 2>/dev/null; then
      kill -TERM "$lane_holder_pid" 2>/dev/null || true
    fi
    # The lane holder gets extra time beyond its child-session grace period to
    # perform its own TERM -> KILL cleanup before this final fail-safe kill.
    while kill -0 "$lane_holder_pid" 2>/dev/null && [ "$attempts" -lt 35 ]; do
      attempts=$((attempts + 1))
      sleep 0.02
    done
    if kill -0 "$lane_holder_pid" 2>/dev/null; then
      kill -KILL "$lane_holder_pid" 2>/dev/null || true
    fi
    wait "$lane_holder_pid" 2>/dev/null || true
    lane_holder_pid=""
  }

  interrupt_lane() {
    local exit_code="$1"

    trap - INT TERM
    remove_queue_ticket
    reap_lane_holder
    if [ -n "$slot_fd" ]; then
      flock --unlock "$slot_fd" 2>/dev/null || true
      exec {slot_fd}>&-
    fi
    exit "$exit_code"
  }

  # Shared queue and slot state is pre-created root:gha0509-lock. Do not
  # tighten directory modes here: separate runner users need the shared group.
  mkdir -p "$VERIFY_ROOT"
  if [ -L "$VERIFY_TMP_ROOT" ]; then
    echo "deploy-window-lock: refusing symlinked verification tmp root ${VERIFY_TMP_ROOT}." >&2
    return 73
  fi
  if [ ! -e "$VERIFY_TMP_ROOT" ]; then
    (umask 077; mkdir -p "$VERIFY_TMP_ROOT")
  fi
  if [ ! -d "$VERIFY_TMP_ROOT" ] || [ ! -O "$VERIFY_TMP_ROOT" ]; then
    echo "deploy-window-lock: refusing unowned verification tmp root ${VERIFY_TMP_ROOT}." >&2
    return 73
  fi
  chmod 700 "$VERIFY_TMP_ROOT"
  mkdir -p "$queue_dir"
  deadline="$(awk -v now="$(date +%s.%N)" -v wait="$ACQUIRE_TIMEOUT" 'BEGIN { printf "%.9f", now + wait }')"

  trap 'interrupt_lane 130' INT
  trap 'interrupt_lane 143' TERM
  enqueue_verification_ticket

  while [ -z "$slot_fd" ]; do
    claim_next_verification_slot

    if [ -n "$slot_fd" ]; then
      break
    fi

    now="$(date +%s.%N)"
    if awk -v now="$now" -v deadline="$deadline" 'BEGIN { exit(now >= deadline ? 0 : 1) }'; then
      remove_queue_ticket
      echo "deploy-window-lock: verification pool stayed full for ${ACQUIRE_TIMEOUT}s." >&2
      return 75
    fi
    sleep "$VERIFY_POLL_INTERVAL"
  done

  mkdir -p "${VERIFY_TMP_ROOT}/slot-${slot}"
  lane_tmp="$(mktemp -d "${VERIFY_TMP_ROOT}/slot-${slot}/${CALLER_ID}-$$.XXXXXX")"
  default_port=$((VERIFY_PORT_BASE + slot))
  now="$(date +%s.%N)"
  remaining="$(awk -v now="$now" -v deadline="$deadline" \
    'BEGIN { left = deadline - now; printf "%.9f", (left > 0 ? left : 0) }')"
  (
    command_pid=""

    # shellcheck disable=SC2329 # Invoked indirectly from the signal traps.
    terminate_command_group() {
      local exit_code="$1" attempts=0

      trap - INT TERM
      if [ -n "$command_pid" ] && kill -0 "$command_pid" 2>/dev/null; then
        kill -TERM -- "-${command_pid}" 2>/dev/null || true
      fi
      while [ -n "$command_pid" ] && kill -0 "$command_pid" 2>/dev/null && [ "$attempts" -lt 15 ]; do
        attempts=$((attempts + 1))
        sleep 0.02
      done
      if [ -n "$command_pid" ] && kill -0 "$command_pid" 2>/dev/null; then
        kill -KILL -- "-${command_pid}" 2>/dev/null || true
      fi
      [ -z "$command_pid" ] || wait "$command_pid" 2>/dev/null || true
      exit "$exit_code"
    }

    trap 'terminate_command_group 130' INT
    trap 'terminate_command_group 143' TERM
    trap 'rm -rf -- "$lane_tmp"' EXIT
    export TMPDIR="$lane_tmp"
    export DEPLOY_WINDOW_SLOT="$slot"
    export DEPLOY_WINDOW_VERIFY_SLOT="$slot"
    export E2E_BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:${default_port}}"

    exec {admission_fd}>"$ADMISSION_LOCK_FILE"
    if ! flock --shared --wait "$remaining" "$admission_fd"; then
      echo "deploy-window-lock: deploy admission barrier stayed locked for the ${ACQUIRE_TIMEOUT}s total acquire budget." >&2
      exit 75
    fi

    now="$(date +%s.%N)"
    remaining="$(awk -v now="$now" -v deadline="$deadline" \
      'BEGIN { left = deadline - now; printf "%.9f", (left > 0 ? left : 0) }')"
    exec {gate_fd}>"$LOCK_FILE"
    if ! flock --shared --wait "$remaining" "$gate_fd"; then
      echo "deploy-window-lock: shared deploy gate stayed locked for the ${ACQUIRE_TIMEOUT}s total acquire budget." >&2
      exit 75
    fi

    flock --unlock "$admission_fd"
    exec {admission_fd}>&-
    echo "verification lane ${slot}/${VERIFY_SLOTS} acquired"
    (
      # The wrapper retains the gate and slot descriptors. The command and any
      # descendants must not be able to outlive those locks.
      exec {gate_fd}>&-
      exec {slot_fd}>&-
      exec setsid "$@"
    ) &
    command_pid=$!
    if wait "$command_pid"; then
      exit 0
    else
      exit $?
    fi
  ) &
  lane_holder_pid=$!

  if wait "$lane_holder_pid"; then
    result=0
  else
    result=$?
  fi
  trap - INT TERM

  flock --unlock "$slot_fd" 2>/dev/null || true
  exec {slot_fd}>&-
  return "$result"
}

case "${1:-}" in
  acquire)
    validate_durations acquire
    acquire_window
    ;;

  release)
    release_window
    ;;

  run)
    validate_durations run
    shift
    if [ "${1:-}" = "--" ]; then
      shift
    fi
    if [ "$#" -eq 0 ]; then
      echo "deploy-window-lock: run requires a command" >&2
      exit 64
    fi
    run_in_verification_lane "$@"
    ;;

  *)
    echo "usage: deploy-window-lock.sh {acquire|release|run -- <cmd...>}" >&2
    exit 64
    ;;
esac
