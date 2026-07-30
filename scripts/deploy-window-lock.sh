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
#   deploy-window-lock.sh run -- <cmd>   # run in one isolated heavy-work slot
#
# GitHub Actions receives the private release capability through $GITHUB_ENV.
# Local callers must set DEPLOY_WINDOW_CAPABILITY_FILE to their own private
# scratch path for the acquire/release pair; no capability is stored beside
# the shared lock where another caller could discover it.
#
# The slot pool lives outside every checkout so worktrees owned by the same
# runner user share it. `run --` owns one slot; acquire/release owns every slot
# in ascending order so deploys keep whole-box exclusivity. The detached holder
# self-expires after HOLD_CAP seconds. Its per-slot owner records are written
# only after it owns every flock, and every owner-record mutation is serialized
# by that slot's separate metadata flock. During the slot-path migration, run
# clients lock both the previous and isolated path for their selected slot so
# old and new checkout generations share one capacity bound.
set -euo pipefail

LOCK_FILE="${DEPLOY_WINDOW_LOCK_FILE:-${HOME}/.local/state/0509/deploy-window.lock}"
LOCK_STEM="${LOCK_FILE%.lock}"
COMMAND="${1:-}"
if [ "$COMMAND" = "release" ]; then
  # Release trusts the persisted pool size, not inherited run-only settings.
  SLOT_COUNT="${DEPLOY_WINDOW_SLOTS:-3}"
else
  SLOT_COUNT="${DEPLOY_WINDOW_SLOTS:-${DEPLOY_WINDOW_VERIFY_SLOTS:-3}}"
fi
POOL_SIZE_FILE="${LOCK_STEM}.slots"
POOL_SIZE_LOCK_FILE="${POOL_SIZE_FILE}.lock"
ADMISSION_LOCK_FILE="${LOCK_STEM}.admission.lock"
DRAIN_SERIAL_LOCK_FILE="${LOCK_STEM}.drain.serial.lock"
DRAIN_INTENT_FILE="${LOCK_STEM}.draining"
DRAIN_INTENT_META_LOCK_FILE="${DRAIN_INTENT_FILE}.meta.lock"
ACQUIRE_TIMEOUT="${DEPLOY_WINDOW_ACQUIRE_TIMEOUT:-10800}"
HOLD_CAP="${DEPLOY_WINDOW_HOLD_CAP:-21600}"
POLL_INTERVAL="${DEPLOY_WINDOW_POLL_INTERVAL:-0.1}"
CANCEL_GRACE="${DEPLOY_WINDOW_CANCEL_GRACE:-5}"
VERIFY_ROOT="${DEPLOY_WINDOW_VERIFY_ROOT:-${LOCK_FILE}.verify}"
VERIFY_TMP_ROOT="${DEPLOY_WINDOW_VERIFY_TMP_ROOT:-${TMPDIR:-/tmp}/0509-verification-$(id -u)}"
VERIFY_PORT_BASE="${DEPLOY_WINDOW_VERIFY_PORT_BASE:-4190}"
CAPABILITY_FILE="${DEPLOY_WINDOW_CAPABILITY_FILE:-}"
RELEASE_TOKEN="${DEPLOY_WINDOW_RELEASE_TOKEN:-}"
ALL_METADATA_FDS=()
if [ -n "${DEPLOY_WINDOW_CALLER_ID:-}" ]; then
  CALLER_ID="$DEPLOY_WINDOW_CALLER_ID"
elif [ -n "${GITHUB_RUN_ID:-}" ]; then
  CALLER_ID="gha-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT:-0}-${GITHUB_JOB:-job}"
else
  CALLER_ID="local-${PPID}"
fi

mkdir -p "$(dirname "$LOCK_FILE")"
mkdir -p "$VERIFY_ROOT"

select_slot() {
  local slot="$1"

  ACTIVE_LOCK_FILE="${VERIFY_ROOT}/slot-${slot}.lock"
  ROLLOUT_LOCK_FILE="${LOCK_STEM}.slot${slot}"
  OWNER_FILE="${ACTIVE_LOCK_FILE}.held"
  META_LOCK_FILE="${ACTIVE_LOCK_FILE}.meta.lock"
}

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

lock_all_metadata() {
  local slot metadata_fd deadline remaining

  ALL_METADATA_FDS=()
  deadline="$(awk -v now="$(date +%s.%N)" -v timeout="$ACQUIRE_TIMEOUT" \
    'BEGIN { printf "%.9f", now + timeout }')"
  for ((slot = 1; slot <= SLOT_COUNT; slot += 1)); do
    select_slot "$slot"
    exec {metadata_fd}>"$META_LOCK_FILE"
    remaining="$(awk -v now="$(date +%s.%N)" -v deadline="$deadline" \
      'BEGIN { left = deadline - now; printf "%.9f", (left > 0 ? left : 0) }')"
    if ! flock --exclusive --wait "$remaining" "$metadata_fd"; then
      eval "exec ${metadata_fd}>&-"
      unlock_all_metadata
      return 1
    fi
    ALL_METADATA_FDS+=("$metadata_fd")
  done
}

unlock_all_metadata() {
  local metadata_fd

  for metadata_fd in "${ALL_METADATA_FDS[@]}"; do
    flock --unlock "$metadata_fd"
    eval "exec ${metadata_fd}>&-"
  done
  ALL_METADATA_FDS=()
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
  local fd_path fd_number

  recorded_process_is_alive || return 1
  for fd_path in "/proc/${OWNER_PID}"/fd/*; do
    if [ "$fd_path" -ef "$ACTIVE_LOCK_FILE" ] 2>/dev/null; then
      fd_number="${fd_path##*/}"
      if awk '
        $1 == "lock:" && $3 == "FLOCK" && $5 == "WRITE" {
          found = 1
        }
        END { exit(found ? 0 : 1) }
      ' "/proc/${OWNER_PID}/fdinfo/${fd_number}" 2>/dev/null; then
        break
      fi
      fd_number=""
    fi
  done
  [ -n "${fd_number:-}" ] || return 1

  # Kernel proof is paired with an independent contention probe. Success here
  # would mean the recorded process cannot be accepted as the current owner.
  if flock --exclusive --nonblock "$ACTIVE_LOCK_FILE" true 2>/dev/null; then
    return 1
  fi
}

remove_all_records_if_token() {
  local expected_token="$1"
  local expected_verifier capability_token="" slot
  local intent_pid="" intent_start="" intent_token="" intent_caller="" intent_extra=""

  expected_verifier="$(capability_verifier "$expected_token")"

  for ((slot = 1; slot <= SLOT_COUNT; slot += 1)); do
    select_slot "$slot"
    exec 8>"$META_LOCK_FILE"
    if flock --exclusive --nonblock 8; then
      read_owner_unlocked
      if [ "$OWNER_TOKEN" = "$expected_verifier" ] ||
         { [ -f "$OWNER_FILE" ] && ! recorded_owner_is_proven; }; then
        rm -f -- "$OWNER_FILE"
      fi
      flock --unlock 8
    fi
    exec 8>&-
  done

  if [ -n "$CAPABILITY_FILE" ] && [ -f "$CAPABILITY_FILE" ]; then
    read -r capability_token <"$CAPABILITY_FILE" || true
  fi
  if [ "$capability_token" = "$expected_token" ]; then
    rm -f -- "$CAPABILITY_FILE"
  fi

  exec 6>"$DRAIN_INTENT_META_LOCK_FILE"
  if flock --exclusive --nonblock 6; then
    if [ -f "$DRAIN_INTENT_FILE" ]; then
      read -r intent_pid intent_start intent_token intent_caller intent_extra <"$DRAIN_INTENT_FILE" || true
    fi
    if [ "$intent_token" = "$expected_verifier" ]; then
      rm -f -- "$DRAIN_INTENT_FILE"
    fi
    flock --unlock 6
  fi
  exec 6>&-
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
  local mode="$1"
  local name value
  local -a names

  case "$mode" in
    acquire)
      names=(ACQUIRE_TIMEOUT HOLD_CAP POLL_INTERVAL)
      ;;
    release)
      names=(ACQUIRE_TIMEOUT)
      ;;
    run)
      names=(ACQUIRE_TIMEOUT POLL_INTERVAL CANCEL_GRACE)
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

  if { [ "$mode" != "release" ] && [[ "$POLL_INTERVAL" =~ ^0+([.]0+)?$ ]]; } ||
     { [ "$mode" = "acquire" ] && [[ "$HOLD_CAP" =~ ^0+([.]0+)?$ ]]; } ||
     { [ "$mode" = "run" ] && [[ "$CANCEL_GRACE" =~ ^0+([.]0+)?$ ]]; }; then
    echo "deploy-window-lock: HOLD_CAP, POLL_INTERVAL, and CANCEL_GRACE must be greater than zero when used." >&2
    exit 64
  fi
  if [[ ! "$SLOT_COUNT" =~ ^[1-9][0-9]*$ ]] || [ "$SLOT_COUNT" -gt 8 ]; then
    echo "deploy-window-lock: slot count must be an integer from 1 through 8 (got '${SLOT_COUNT}')." >&2
    exit 64
  fi
  if [ -n "${DEPLOY_WINDOW_SLOTS:-}" ] &&
     [ -n "${DEPLOY_WINDOW_VERIFY_SLOTS:-}" ] &&
     [ "$DEPLOY_WINDOW_SLOTS" != "$DEPLOY_WINDOW_VERIFY_SLOTS" ]; then
    echo "deploy-window-lock: DEPLOY_WINDOW_SLOTS and DEPLOY_WINDOW_VERIFY_SLOTS must match when both are set." >&2
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

load_pool_size_for_release() {
  local established_slots="" extra=""

  if [ ! -f "$POOL_SIZE_FILE" ]; then
    return 0
  fi
  read -r established_slots extra <"$POOL_SIZE_FILE" || true
  if [[ ! "$established_slots" =~ ^[1-9][0-9]*$ ]] ||
     [ "$established_slots" -gt 8 ] ||
     [ -n "$extra" ]; then
    echo "deploy-window-lock: invalid persisted pool size in ${POOL_SIZE_FILE}." >&2
    return 64
  fi
  SLOT_COUNT="$established_slots"
}

validate_pool_size() {
  local established_slots="" extra="" pool_size_tmp=""

  exec 7>"$POOL_SIZE_LOCK_FILE"
  flock --exclusive 7
  if [ -f "$POOL_SIZE_FILE" ]; then
    read -r established_slots extra <"$POOL_SIZE_FILE" || true
    if [[ ! "$established_slots" =~ ^[1-9][0-9]*$ ]] || [ -n "$extra" ]; then
      flock --unlock 7
      exec 7>&-
      echo "deploy-window-lock: invalid persisted pool size in ${POOL_SIZE_FILE}." >&2
      return 64
    fi
    if [ "$established_slots" != "$SLOT_COUNT" ]; then
      flock --unlock 7
      exec 7>&-
      echo "deploy-window-lock: pool was initialized with ${established_slots} slots; refusing DEPLOY_WINDOW_SLOTS=${SLOT_COUNT}." >&2
      echo "Drain the pool and remove ${POOL_SIZE_FILE} before intentionally resizing it." >&2
      return 64
    fi
  else
    pool_size_tmp="$(umask 077; mktemp "${POOL_SIZE_FILE}.tmp.XXXXXX")"
    if ! printf '%s\n' "$SLOT_COUNT" >"$pool_size_tmp" ||
       ! mv --no-target-directory -- "$pool_size_tmp" "$POOL_SIZE_FILE"; then
      rm -f -- "$pool_size_tmp"
      flock --unlock 7
      exec 7>&-
      echo "deploy-window-lock: failed to initialize ${POOL_SIZE_FILE} atomically." >&2
      return 1
    fi
  fi
  flock --unlock 7
  exec 7>&-
}

acquire_window() {
  local existing_pid acquire_token acquire_verifier slot proven_slots
  local stale_records=0
  local holder_pid="" holder_start=""
  local acquire_complete=0
  local acquire_deadline

  if [ -z "${GITHUB_ENV:-}" ] && [ -z "$CAPABILITY_FILE" ]; then
    echo "deploy-window-lock: acquire needs GITHUB_ENV or DEPLOY_WINDOW_CAPABILITY_FILE to pass its private release capability." >&2
    return 64
  fi

  for ((slot = 1; slot <= SLOT_COUNT; slot += 1)); do
    select_slot "$slot"
    lock_metadata
    read_owner_unlocked
    if [ ! -f "$OWNER_FILE" ]; then
      unlock_metadata
      continue
    fi

    existing_pid="${OWNER_PID:-unknown}"
    if recorded_owner_is_proven; then
      unlock_metadata
      echo "deploy-window-lock: slot ${slot} already has a proven owner PID ${existing_pid}; refusing a second acquire." >&2
      echo "If no active CI job owns that PID, it is a live orphan; release it explicitly or wait for its hold cap." >&2
      return 1
    fi
    rm -f -- "$OWNER_FILE"
    unlock_metadata
    stale_records=$((stale_records + 1))
  done

  if [ "$stale_records" -gt 0 ]; then
    echo "deploy-window-lock: removed ${stale_records} stale slot owner record(s); acquire failed safely." >&2
    echo "Re-run acquire now that the stale records have been cleaned." >&2
    return 1
  fi

  acquire_token="$(< /proc/sys/kernel/random/uuid)"
  acquire_verifier="$(capability_verifier "$acquire_token")"
  acquire_deadline="$(awk -v now="$(date +%s.%N)" -v timeout="$ACQUIRE_TIMEOUT" \
    'BEGIN { printf "%.9f", now + timeout }')"

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

    if [ "${#ALL_METADATA_FDS[@]}" -gt 0 ]; then
      unlock_all_metadata
    fi

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
    remove_all_records_if_token "$acquire_token"
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

  # The holder keeps one fd per slot open across CI steps. Slots are acquired
  # in ascending order, the shared order that prevents all-slot deadlocks.
  # Its active flock waiter is tracked and killed during cleanup; the capped
  # sleep explicitly inherits none of the slot fds.
  # shellcheck disable=SC2016 # The single-quoted program expands in the holder.
  setsid bash -c '
    set -euo pipefail

    verify_root="$1"
    legacy_lock_file="$2"
    admission_lock_file="$3"
    slot_count="$4"
    acquire_deadline="$5"
    hold_cap="$6"
    owner_verifier="$7"
    owner_caller="$8"
    capability_file="$9"
    drain_serial_lock_file="${10}"
    drain_intent_file="${11}"
    drain_intent_meta_lock_file="${12}"
    flock_pid=""
    sleeper_pid=""
    owners_registered=0
    held_fds=()
    # GitHub Runner and other orchestrators may pass private pipe descriptors
    # above stderr. A detached holder must not keep those pipes alive after the
    # acquire client exits, so discard everything before opening our own locks.
    for inherited_fd_path in /proc/$$/fd/*; do
      inherited_fd="${inherited_fd_path##*/}"
      if [[ "$inherited_fd" =~ ^[0-9]+$ ]] && [ "$inherited_fd" -gt 2 ]; then
        eval "exec ${inherited_fd}>&-" 2>/dev/null || true
      fi
    done
    flock_without_held_fds() {
      local held_fd

      (
        for held_fd in "${held_fds[@]}"; do
          eval "exec ${held_fd}>&-"
        done
        exec flock "$@"
      )
    }

    stat_line="$(<"/proc/$$/stat")"
    stat_fields="${stat_line##*) }"
    read -r -a stat_fields <<<"$stat_fields"
    holder_start="${stat_fields[19]}"

    cleanup() {
      local current_pid="" current_start="" current_token="" current_caller="" extra=""
      local capability_token="" capability_hash="" slot slot_file owner_file meta_lock_file
      local intent_pid="" intent_start="" intent_token="" intent_caller="" intent_extra=""

      trap - EXIT INT TERM
      if [ -n "$flock_pid" ]; then
        kill "$flock_pid" 2>/dev/null || true
        wait "$flock_pid" 2>/dev/null || true
      fi
      if [ -n "$sleeper_pid" ]; then
        kill "$sleeper_pid" 2>/dev/null || true
        wait "$sleeper_pid" 2>/dev/null || true
      fi

      # Before registration there is no capability handshake to preserve, so
      # clear (or safely abandon) drain intent first and never block on slot
      # metadata. After registration, blocking slot cleanup is the handshake
      # that keeps the holder live through the parent final proof/publication.
      exec 6>"$drain_intent_meta_lock_file"
      if flock_without_held_fds --exclusive --nonblock 6; then
        if [ -f "$drain_intent_file" ]; then
          read -r intent_pid intent_start intent_token intent_caller intent_extra <"$drain_intent_file" || true
        fi
        if [ "$intent_pid" = "$$" ] &&
           [ "$intent_start" = "$holder_start" ] &&
           [ "$intent_token" = "$owner_verifier" ] &&
           [ "$intent_caller" = "$owner_caller" ] &&
           [ -z "$intent_extra" ]; then
          rm -f -- "$drain_intent_file"
        fi
        flock --unlock 6
      fi
      exec 6>&-

      if [ "$owners_registered" -eq 1 ]; then
        for ((slot = 1; slot <= slot_count; slot += 1)); do
          slot_file="${verify_root}/slot-${slot}.lock"
          owner_file="${slot_file}.held"
          meta_lock_file="${slot_file}.meta.lock"
          current_pid=""
          current_start=""
          current_token=""
          current_caller=""
          extra=""

          exec 8>"$meta_lock_file"
          flock_without_held_fds --exclusive 8
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
          flock --unlock 8
          exec 8>&-
        done
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

    }

    trap cleanup EXIT
    trap "exit 130" INT
    trap "exit 143" TERM

    acquire_flock() {
      local mode="$1"
      local target_fd="$2"
      local remaining held_fd

      remaining="$(awk -v now="$(date +%s.%N)" -v deadline="$acquire_deadline" \
        "BEGIN { remaining = deadline - now; printf \"%.9f\", (remaining > 0 ? remaining : 0) }")"
      (
        for held_fd in "${held_fds[@]}"; do
          if [ "$held_fd" != "$target_fd" ]; then
            eval "exec ${held_fd}>&-"
          fi
        done
        exec flock "$mode" --wait "$remaining" "$target_fd"
      ) </dev/null >/dev/null 2>&1 &
      flock_pid=$!
      if ! wait "$flock_pid"; then
        flock_pid=""
        return 1
      fi
      flock_pid=""
    }

    # New pool clients share the legacy lock so an old exclusive client still
    # excludes them during rollout. Deploy holders then take the admission gate
    # exclusively before draining slots; run clients take it shared.
    exec {legacy_fd}>"$legacy_lock_file"
    held_fds+=("$legacy_fd")
    acquire_flock --shared "$legacy_fd" || exit 99

    exec {drain_serial_fd}>"$drain_serial_lock_file"
    held_fds+=("$drain_serial_fd")
    acquire_flock --exclusive "$drain_serial_fd" || exit 99

    exec 6>"$drain_intent_meta_lock_file"
    acquire_flock --exclusive 6 || exit 99
    # Owning the serialization flock proves no live deploy holder can own an
    # older intent. Anything left here is a crash/partial-write orphan.
    if [ -e "$drain_intent_file" ]; then
      rm -f -- "$drain_intent_file"
    fi
    umask 077
    printf "%s %s %s %s\n" "$$" "$holder_start" "$owner_verifier" "$owner_caller" >"$drain_intent_file"
    flock --unlock 6
    exec 6>&-

    exec {admission_fd}>"$admission_lock_file"
    held_fds+=("$admission_fd")
    acquire_flock --exclusive "$admission_fd" || exit 99

    exec 6>"$drain_intent_meta_lock_file"
    acquire_flock --exclusive 6 || exit 99
    intent_pid=""
    intent_start=""
    intent_token=""
    intent_caller=""
    intent_extra=""
    if [ -f "$drain_intent_file" ]; then
      read -r intent_pid intent_start intent_token intent_caller intent_extra <"$drain_intent_file" || true
    fi
    if [ "$intent_pid" != "$$" ] ||
       [ "$intent_start" != "$holder_start" ] ||
       [ "$intent_token" != "$owner_verifier" ] ||
       [ "$intent_caller" != "$owner_caller" ] ||
       [ -n "$intent_extra" ]; then
      flock --unlock 6
      exec 6>&-
      exit 97
    fi
    rm -f -- "$drain_intent_file"
    flock --unlock 6
    exec 6>&-

    for ((slot = 1; slot <= slot_count; slot += 1)); do
      slot_file="${verify_root}/slot-${slot}.lock"
      exec {slot_fd}>"$slot_file"
      held_fds+=("$slot_fd")
      acquire_flock --exclusive "$slot_fd" || exit 99
    done

    for ((slot = 1; slot <= slot_count; slot += 1)); do
      slot_file="${verify_root}/slot-${slot}.lock"
      owner_file="${slot_file}.held"
      meta_lock_file="${slot_file}.meta.lock"
      exec 8>"$meta_lock_file"
      acquire_flock --exclusive 8 || exit 99
      if [ -e "$owner_file" ]; then
        flock --unlock 8
        exec 8>&-
        exit 98
      fi
      umask 077
      if [ "$slot" -eq "$slot_count" ]; then
        owners_registered=1
      fi
      printf "%s %s %s %s\n" "$$" "$holder_start" "$owner_verifier" "$owner_caller" >"$owner_file"
      flock --unlock 8
      exec 8>&-
    done

    (
      for held_fd in "${held_fds[@]}"; do
        eval "exec ${held_fd}>&-"
      done
      sleep "$hold_cap"
    ) </dev/null >/dev/null 2>&1 &
    sleeper_pid=$!
    wait "$sleeper_pid" 2>/dev/null || true
    sleeper_pid=""
  ' holder "$VERIFY_ROOT" "$LOCK_FILE" "$ADMISSION_LOCK_FILE" "$SLOT_COUNT" "$acquire_deadline" "$HOLD_CAP" "$acquire_verifier" "$CALLER_ID" "$CAPABILITY_FILE" "$DRAIN_SERIAL_LOCK_FILE" "$DRAIN_INTENT_FILE" "$DRAIN_INTENT_META_LOCK_FILE" </dev/null >/dev/null 2>&1 &
  holder_pid=$!
  holder_start="$(process_start_time "$holder_pid")"

  while kill -0 "$holder_pid" 2>/dev/null; do
    sleep "$POLL_INTERVAL"
    proven_slots=0
    for ((slot = 1; slot <= SLOT_COUNT; slot += 1)); do
      select_slot "$slot"
      lock_metadata
      read_owner_unlocked

      if [ ! -f "$OWNER_FILE" ]; then
        unlock_metadata
        continue
      fi

      existing_pid="${OWNER_PID:-unknown}"
      if [ "$OWNER_TOKEN" = "$acquire_verifier" ]; then
        if recorded_owner_is_proven &&
           [ "$OWNER_PID" = "$holder_pid" ] &&
           [ "$OWNER_START" = "$holder_start" ] &&
           [ "$OWNER_CALLER" = "$CALLER_ID" ]; then
          proven_slots=$((proven_slots + 1))
          unlock_metadata
          continue
        fi

        rm -f -- "$OWNER_FILE"
        unlock_metadata
        echo "deploy-window-lock: holder PID ${existing_pid} died or lost slot ${slot} after registering; acquire failed safely." >&2
        fail_started_acquire
        return 1
      fi

      if recorded_owner_is_proven; then
        unlock_metadata
        echo "deploy-window-lock: slot ${slot} became owned by proven owner PID ${existing_pid}; refusing a second acquire." >&2
        fail_started_acquire
        return 1
      fi

      rm -f -- "$OWNER_FILE"
      unlock_metadata
      echo "deploy-window-lock: removed an invalid competing slot ${slot} owner record for PID ${existing_pid}; acquire failed safely." >&2
      fail_started_acquire
      return 1
    done

    if [ "$proven_slots" -eq "$SLOT_COUNT" ]; then
      # Hold every metadata lock while re-proving the pool and publishing the
      # release capability. A self-expiring holder blocks in cleanup and keeps
      # its slot fds open until this atomic proof/publish section is complete.
      if ! lock_all_metadata; then
        echo "deploy-window-lock: gave up after ${ACQUIRE_TIMEOUT}s waiting to prove slot metadata." >&2
        fail_started_acquire
        return 1
      fi
      proven_slots=0
      for ((slot = 1; slot <= SLOT_COUNT; slot += 1)); do
        select_slot "$slot"
        read_owner_unlocked
        if [ -f "$OWNER_FILE" ] &&
           [ "$OWNER_TOKEN" = "$acquire_verifier" ] &&
           [ "$OWNER_PID" = "$holder_pid" ] &&
           [ "$OWNER_START" = "$holder_start" ] &&
           [ "$OWNER_CALLER" = "$CALLER_ID" ] &&
           recorded_owner_is_proven; then
          proven_slots=$((proven_slots + 1))
        fi
      done

      if [ "$proven_slots" -eq "$SLOT_COUNT" ]; then
        publish_capability_unlocked "$acquire_token"
        unlock_all_metadata
        echo "deploy window acquired (${SLOT_COUNT} slots, holder pid ${holder_pid}, self-expires in ${HOLD_CAP}s)"
        acquire_complete=1
        exit 0
      fi
      unlock_all_metadata
    fi
  done

  wait "$holder_pid" 2>/dev/null || true
  echo "deploy-window-lock: gave up after ${ACQUIRE_TIMEOUT}s while draining ${SLOT_COUNT} slots; an unregistered fleet lane still holds the pool." >&2
  echo "Finish or stop the lane, then re-run this job." >&2
  fail_started_acquire
  return 1
}

release_window() {
  local target_pid="" target_start="" release_verifier attempts
  local slot absent_slots=0 matching_slots=0 stale_owner=0

  if ! load_release_token; then
    echo "deploy window not released (caller has no successful-acquire capability)"
    return 0
  fi
  release_verifier="$(capability_verifier "$RELEASE_TOKEN")"

  # The successful acquire published its capability while holding these same
  # metadata locks. Re-take all of them in ascending order so the holder cannot
  # self-expire between proof and the release signal.
  if ! lock_all_metadata; then
    echo "deploy-window-lock: gave up after ${ACQUIRE_TIMEOUT}s waiting to verify release metadata." >&2
    return 1
  fi
  for ((slot = 1; slot <= SLOT_COUNT; slot += 1)); do
    select_slot "$slot"
    read_owner_unlocked

    if [ ! -f "$OWNER_FILE" ]; then
      absent_slots=$((absent_slots + 1))
      continue
    fi

    if [ "$OWNER_TOKEN" != "$release_verifier" ]; then
      target_pid="${OWNER_PID:-unknown}"
      if [ -n "$CAPABILITY_FILE" ]; then
        rm -f -- "$CAPABILITY_FILE"
      fi
      unlock_all_metadata
      echo "deploy window not released (capability does not own slot ${slot} PID ${target_pid})"
      return 0
    fi

    if [ -z "$target_pid" ]; then
      target_pid="${OWNER_PID:-unknown}"
      target_start="$OWNER_START"
    elif [ "$OWNER_PID" != "$target_pid" ] || [ "$OWNER_START" != "$target_start" ]; then
      unlock_all_metadata
      echo "deploy-window-lock: refusing release; capability records disagree across slots." >&2
      return 1
    fi

    matching_slots=$((matching_slots + 1))
    if ! recorded_owner_is_proven; then
      if ! recorded_process_is_alive; then
        rm -f -- "$OWNER_FILE"
        stale_owner=1
        continue
      fi

      unlock_all_metadata
      echo "deploy-window-lock: refusing to signal live PID ${target_pid}; slot ${slot} is not provably owned." >&2
      return 1
    fi
  done

  if [ "$absent_slots" -eq "$SLOT_COUNT" ]; then
    if [ -n "$CAPABILITY_FILE" ]; then
      rm -f -- "$CAPABILITY_FILE"
    fi
    unlock_all_metadata
    echo "deploy window already released (no registered owner)"
    return 0
  fi

  if [ "$stale_owner" -eq 1 ]; then
    for ((slot = 1; slot <= SLOT_COUNT; slot += 1)); do
      select_slot "$slot"
      read_owner_unlocked
      if [ "$OWNER_TOKEN" = "$release_verifier" ]; then
        rm -f -- "$OWNER_FILE"
      fi
    done
    if [ -n "$CAPABILITY_FILE" ]; then
      rm -f -- "$CAPABILITY_FILE"
    fi
    unlock_all_metadata
    echo "deploy-window-lock: cleaned stale owner records for PID ${target_pid}; no process was signalled." >&2
    return 0
  fi

  if [ "$matching_slots" -ne "$SLOT_COUNT" ]; then
    unlock_all_metadata
    echo "deploy-window-lock: refusing release; capability owns only ${matching_slots}/${SLOT_COUNT} slot records." >&2
    return 1
  fi

  if ! kill -TERM "$target_pid"; then
    unlock_all_metadata
    echo "deploy-window-lock: proven owner PID ${target_pid} exited before it could be signalled." >&2
    return 1
  fi
  unlock_all_metadata

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

  remove_all_records_if_token "$RELEASE_TOKEN"
  echo "deploy window released (${SLOT_COUNT} slots, owner pid ${target_pid})"
}

run_in_slot() {
  local slot slot_fd rollout_slot_fd selected_slot legacy_fd admission_fd
  local run_deadline remaining now sleep_for lane_tmp default_port result
  local intent_pid intent_start intent_token intent_caller intent_extra
  local lane_holder_pid=""

  interrupt_lane() {
    local exit_code="$1"

    trap - INT TERM
    if [ -n "$lane_holder_pid" ] && kill -0 "$lane_holder_pid" 2>/dev/null; then
      kill -TERM "$lane_holder_pid" 2>/dev/null || true
      wait "$lane_holder_pid" 2>/dev/null || true
    fi
    if [ -n "${slot_fd:-}" ]; then
      flock --unlock "$slot_fd" 2>/dev/null || true
      eval "exec ${slot_fd}>&-"
    fi
    if [ -n "${rollout_slot_fd:-}" ]; then
      flock --unlock "$rollout_slot_fd" 2>/dev/null || true
      eval "exec ${rollout_slot_fd}>&-"
    fi
    if [ -n "${admission_fd:-}" ]; then
      flock --unlock "$admission_fd" 2>/dev/null || true
      eval "exec ${admission_fd}>&-"
    fi
    if [ -n "${legacy_fd:-}" ]; then
      flock --unlock "$legacy_fd" 2>/dev/null || true
      eval "exec ${legacy_fd}>&-"
    fi
    exit "$exit_code"
  }

  run_deadline="$(awk -v now="$(date +%s.%N)" -v timeout="$ACQUIRE_TIMEOUT" \
    'BEGIN { printf "%.9f", now + timeout }')"

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

  exec {legacy_fd}>"$LOCK_FILE"
  remaining="$(awk -v now="$(date +%s.%N)" -v deadline="$run_deadline" \
    'BEGIN { remaining = deadline - now; printf "%.9f", (remaining > 0 ? remaining : 0) }')"
  if ! flock --shared --wait "$remaining" "$legacy_fd"; then
    eval "exec ${legacy_fd}>&-"
    echo "deploy-window-lock: gave up after ${ACQUIRE_TIMEOUT}s waiting for the legacy rollout gate." >&2
    return 1
  fi

  exec {admission_fd}>"$ADMISSION_LOCK_FILE"
  while true; do
    intent_pid=""
    intent_start=""
    intent_token=""
    intent_caller=""
    intent_extra=""

    exec 6>"$DRAIN_INTENT_META_LOCK_FILE"
    remaining="$(awk -v now="$(date +%s.%N)" -v deadline="$run_deadline" \
      'BEGIN { remaining = deadline - now; printf "%.9f", (remaining > 0 ? remaining : 0) }')"
    if ! flock --exclusive --wait "$remaining" 6; then
      exec 6>&-
      eval "exec ${admission_fd}>&-"
      eval "exec ${legacy_fd}>&-"
      echo "deploy-window-lock: gave up after ${ACQUIRE_TIMEOUT}s waiting for lane admission." >&2
      return 1
    fi
    if [ -f "$DRAIN_INTENT_FILE" ]; then
      read -r intent_pid intent_start intent_token intent_caller intent_extra <"$DRAIN_INTENT_FILE" || true
      if [[ ! "$intent_pid" =~ ^[1-9][0-9]*$ ]] ||
         [[ ! "$intent_start" =~ ^[1-9][0-9]*$ ]] ||
         [ -z "$intent_token" ] ||
         [ -z "$intent_caller" ] ||
         [ -n "$intent_extra" ] ||
         ! process_identity_is_live "$intent_pid" "$intent_start"; then
        rm -f -- "$DRAIN_INTENT_FILE"
        intent_pid=""
      fi
    fi

    if [ -z "$intent_pid" ] &&
       flock --shared --nonblock "$admission_fd"; then
      flock --unlock 6
      exec 6>&-
      break
    fi
    flock --unlock 6
    exec 6>&-

    now="$(date +%s.%N)"
    if awk -v now="$now" -v deadline="$run_deadline" \
      'BEGIN { exit(now >= deadline ? 0 : 1) }'; then
      eval "exec ${admission_fd}>&-"
      eval "exec ${legacy_fd}>&-"
      echo "deploy-window-lock: gave up after ${ACQUIRE_TIMEOUT}s waiting for lane admission." >&2
      return 1
    fi
    sleep_for="$(awk -v now="$now" -v deadline="$run_deadline" -v poll="$POLL_INTERVAL" \
      'BEGIN { remaining = deadline - now; printf "%.9f", remaining < poll ? remaining : poll }')"
    sleep "$sleep_for"
  done

  for ((slot = 1; slot <= SLOT_COUNT; slot += 1)); do
    select_slot "$slot"
    exec {rollout_slot_fd}>"$ROLLOUT_LOCK_FILE"
    if ! flock --exclusive --nonblock "$rollout_slot_fd"; then
      eval "exec ${rollout_slot_fd}>&-"
      continue
    fi
    exec {slot_fd}>"$ACTIVE_LOCK_FILE"
    if flock --exclusive --nonblock "$slot_fd"; then
      selected_slot="$slot"
      break
    fi
    eval "exec ${slot_fd}>&-"
    flock --unlock "$rollout_slot_fd"
    eval "exec ${rollout_slot_fd}>&-"
  done

  if [ -z "${selected_slot:-}" ]; then
    selected_slot=$((($$ % SLOT_COUNT) + 1))
    select_slot "$selected_slot"
    exec {rollout_slot_fd}>"$ROLLOUT_LOCK_FILE"
    remaining="$(awk -v now="$(date +%s.%N)" -v deadline="$run_deadline" \
      'BEGIN { remaining = deadline - now; printf "%.9f", (remaining > 0 ? remaining : 0) }')"
    if ! flock --exclusive --wait "$remaining" "$rollout_slot_fd"; then
      eval "exec ${rollout_slot_fd}>&-"
      echo "deploy-window-lock: gave up after ${ACQUIRE_TIMEOUT}s waiting for slot ${selected_slot}/${SLOT_COUNT}." >&2
      return 1
    fi
    exec {slot_fd}>"$ACTIVE_LOCK_FILE"
    remaining="$(awk -v now="$(date +%s.%N)" -v deadline="$run_deadline" \
      'BEGIN { remaining = deadline - now; printf "%.9f", (remaining > 0 ? remaining : 0) }')"
    if ! flock --exclusive --wait "$remaining" "$slot_fd"; then
      eval "exec ${slot_fd}>&-"
      flock --unlock "$rollout_slot_fd"
      eval "exec ${rollout_slot_fd}>&-"
      echo "deploy-window-lock: gave up after ${ACQUIRE_TIMEOUT}s waiting for slot ${selected_slot}/${SLOT_COUNT}." >&2
      return 1
    fi
  fi

  trap 'interrupt_lane 130' INT
  trap 'interrupt_lane 143' TERM
  mkdir -p "${VERIFY_TMP_ROOT}/slot-${selected_slot}"
  lane_tmp="$(mktemp -d "${VERIFY_TMP_ROOT}/slot-${selected_slot}/${CALLER_ID}-$$.XXXXXX")"
  default_port=$((VERIFY_PORT_BASE + selected_slot))
  (
    command_pid=""

    # shellcheck disable=SC2329 # Invoked indirectly from the signal traps.
    terminate_command_group() {
      local exit_code="$1"
      local cancel_deadline now

      trap - INT TERM
      if [ -n "$command_pid" ] && kill -0 "$command_pid" 2>/dev/null; then
        kill -TERM -- "-${command_pid}" 2>/dev/null || true
        cancel_deadline="$(awk -v now="$(date +%s.%N)" -v grace="$CANCEL_GRACE" \
          'BEGIN { printf "%.9f", now + grace }')"
        while kill -0 "$command_pid" 2>/dev/null &&
          [ "$(process_state "$command_pid")" != "Z" ]; do
          now="$(date +%s.%N)"
          if awk -v now="$now" -v deadline="$cancel_deadline" \
            'BEGIN { exit(now >= deadline ? 0 : 1) }'; then
            kill -KILL -- "-${command_pid}" 2>/dev/null || true
            break
          fi
          sleep 0.02
        done
        wait "$command_pid" 2>/dev/null || true
      fi
      exit "$exit_code"
    }

    trap 'terminate_command_group 130' INT
    trap 'terminate_command_group 143' TERM
    trap 'rm -rf -- "$lane_tmp"' EXIT
    export TMPDIR="$lane_tmp"
    export DEPLOY_WINDOW_SLOT="$selected_slot"
    export DEPLOY_WINDOW_VERIFY_SLOT="$selected_slot"
    export E2E_BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:${default_port}}"

    echo "verification lane ${selected_slot}/${SLOT_COUNT} acquired" >&2
    (
      # This wrapper retains every lock. The command and its descendants close
      # them before exec so background work cannot retain pool capacity.
      eval "exec ${slot_fd}>&-"
      eval "exec ${rollout_slot_fd}>&-"
      eval "exec ${admission_fd}>&-"
      eval "exec ${legacy_fd}>&-"
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
  eval "exec ${slot_fd}>&-"
  flock --unlock "$rollout_slot_fd" 2>/dev/null || true
  eval "exec ${rollout_slot_fd}>&-"
  flock --unlock "$admission_fd" 2>/dev/null || true
  eval "exec ${admission_fd}>&-"
  flock --unlock "$legacy_fd" 2>/dev/null || true
  eval "exec ${legacy_fd}>&-"
  return "$result"
}

case "${1:-}" in
  acquire)
    validate_durations acquire
    validate_pool_size
    acquire_window
    ;;

  release)
    validate_durations release
    load_pool_size_for_release
    release_window
    ;;

  run)
    validate_durations run
    validate_pool_size
    shift
    if [ "${1:-}" = "--" ]; then
      shift
    fi
    if [ "$#" -eq 0 ]; then
      echo "deploy-window-lock: run requires a command" >&2
      exit 64
    fi
    run_in_slot "$@"
    ;;

  *)
    echo "usage: deploy-window-lock.sh {acquire|release|run -- <cmd...>}" >&2
    exit 64
    ;;
esac
