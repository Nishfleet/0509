#!/usr/bin/env bash
# Deterministic zero-token Fleet Backlog Console refresh.
#
# Replaces the hourly Claude Haiku call that used to run generate.py and
# republish the console (backlog-console-refresh.service). This script does the
# same job with ZERO tokens and no LLM: it assembles the console directly from
# fleet2 var state, git, and systemd (via generate.py), deploys it to nish.sh
# (via push.sh -> fleet-console Worker KV), then runs a freshness self-check
# that re-runs once on failure and only pages Nish after a REPEATED failure.
#
# Freshness contract (2026-08-12): stale must never look fresh. The self-check
# verifies the published payload is actually current before declaring success;
# a single transient blip is retried once, and only a second consecutive
# failure pages Nish (notify-email -> ops-notify Worker -> email).
#
# Every path/threshold is overridable via env so the hermetic regression test
# (test_refresh.sh) can run this against a throwaway directory.
set -euo pipefail
umask 077

DIR=${CONSOLE_DIR:-/home/nish/workspaces/agent-state/backlog-console}
LOG=${CONSOLE_LOG:-$DIR/refresh.log}
PAGE=${CONSOLE_PAGE_CMD:-/home/nish/.local/bin/notify-email}
PYTHON=${CONSOLE_PYTHON:-python3}
PUSH_SH=${CONSOLE_PUSH_SH:-$DIR/push.sh}
CF_ENV=${CONSOLE_CF_ENV:-/home/nish/.config/fleet-console/cf.env}
LOGGER=${CONSOLE_LOGGER:-logger}
# Freshness bound. After a successful refresh data.json is < 540s old (the
# push.sh debounce floor) or was already fresh and simply pushed, so 1h is a
# generous ceiling that still catches a multi-hour freeze like the 28h incident
# that motivated this rebuild.
FRESH_MAX_AGE_S=${CONSOLE_FRESH_MAX_AGE_S:-3600}

# Load Cloudflare credentials so wrangler can authenticate under systemd --user,
# whose environment is minimal and does NOT carry the interactive shell's
# CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID. This is the env/credential
# difference that made every timer firing exit 1 (wrangler: "assign its value to
# CLOUDFLARE_API_TOKEN") while the same script exited 0 by hand. Mirrors
# inish-publish-now: prefer an already-set token, else source fleet-console/cf.env.
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  if [[ -r "$CF_ENV" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$CF_ENV"
    set +a
  fi
fi

log() { printf '%s %s\n' "$(date -Is)" "$*" >>"$LOG"; }

# Fail LOUD: write the reason to the journal (logger -> syslog/journald) AND to
# stderr (which systemd captures into the journal). A silent exit 1 is a defect:
# journald must capture the failure reason so the failed-unit alarm is actionable.
jlog() {
  printf '%s %s\n' "$(date -Is)" "$*" | "$LOGGER" -t backlog-console-refresh
  printf '%s\n' "$*" >&2
}

# assemble + deploy once. Returns 0 only if BOTH the generation (console.html
# from fleet2 var state / git / systemd) and the push (nish.sh deploy) succeed.
run_once() {
  "$PYTHON" "$DIR/generate.py" >>"$LOG" 2>&1 || return 1
  "$PUSH_SH" >>"$LOG" 2>&1 || return 1
  return 0
}

# Is the published console fresh? data.json must exist, be younger than
# FRESH_MAX_AGE_S, and .last-push-ok must be newer than data.json (the latest
# payload actually reached KV - stale must never look fresh).
is_fresh() {
  local data_age
  [ -f "$DIR/data.json" ] || return 1
  data_age=$(( $(date +%s) - $(stat -c %Y "$DIR/data.json" 2>/dev/null || echo 0) ))
  [ "$data_age" -lt "$FRESH_MAX_AGE_S" ] || return 1
  [ -f "$DIR/.last-push-ok" ] || return 1
  [ "$DIR/data.json" -nt "$DIR/.last-push-ok" ] && return 1
  return 0
}

# Diagnostic summary for the page (and the log).
diag() {
  local data_age push_age
  data_age=$(( $(date +%s) - $(stat -c %Y "$DIR/data.json" 2>/dev/null || echo 0) ))
  push_age=$(( $(date +%s) - $(stat -c %Y "$DIR/.last-push-ok" 2>/dev/null || echo 0) ))
  printf 'Fleet Backlog Console refresh FAILED after 2 attempts.\n'
  printf 'data.json age: %ss (max %ss)\n' "$data_age" "$FRESH_MAX_AGE_S"
  printf '.last-push-ok age: %ss\n' "$push_age"
  printf 'last log lines:\n'
  tail -n 5 "$LOG" 2>/dev/null || true
}

if run_once && is_fresh; then
  log "refresh ok"
  exit 0
fi
log "refresh not fresh after first attempt - re-running once"
if run_once && is_fresh; then
  log "refresh ok after retry"
  exit 0
fi
# Repeated failure -> page Nish. Only now, never on the first failure.
log "refresh FAILED after retry - paging"
jlog "refresh FAILED after retry: $(tail -n 3 "$LOG" 2>/dev/null | tr '\n' ' ')"
if ! "$PAGE" "Fleet Backlog Console refresh FAILED" "$(diag)" >>"$LOG" 2>&1; then
  log "page delivery failed"
fi
exit 1
