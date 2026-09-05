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
# failure pages Nish. Paging (2026-08-19): at most ONE alert per distinct
# cause per 6h, sent via Telegram (hermes send -> outbound gate) instead of
# email; email remains as a weekly fallback only (notify-email -> ops-notify
# Worker -> email).
#
# Every path/threshold is overridable via env so the hermetic regression test
# (test_refresh.sh) can run this against a throwaway directory.
set -euo pipefail
umask 077

DIR=${CONSOLE_DIR:-/home/nish/workspaces/agent-state/backlog-console}
LOG=${CONSOLE_LOG:-$DIR/refresh.log}
PYTHON=${CONSOLE_PYTHON:-python3}
PUSH_SH=${CONSOLE_PUSH_SH:-$DIR/push.sh}
CF_ENV=${CONSOLE_CF_ENV:-/home/nish/.config/fleet-console/cf.env}
LOGGER=${CONSOLE_LOGGER:-logger}
# Paging channels (2026-08-19): Telegram is the primary alert path (hermes send
# via the outbound gate); email (notify-email -> ops-notify Worker) is only a
# weekly fallback. Both overridable so the hermetic regression test can run
# against fakes.
TELEGRAM=${CONSOLE_TELEGRAM_CMD:-/home/nish/.local/bin/hermes}
EMAIL=${CONSOLE_EMAIL_CMD:-/home/nish/.local/bin/notify-email}
# Alert rate limit (2026-08-19): at most ONE alert per distinct cause per
# ALERT_MIN_INTERVAL_S (6h). Email is additionally capped to at most once per
# cause per EMAIL_WEEKLY_S (7d) - a weekly fallback only. State is stored in
# STATE_DIR keyed by a hash of the normalised failure, so the same root cause
# (e.g. "push auth failing") maps to the same key even as data.json ages drift.
ALERT_MIN_INTERVAL_S=${CONSOLE_ALERT_MIN_INTERVAL_S:-21600}
EMAIL_WEEKLY_S=${CONSOLE_EMAIL_WEEKLY_S:-604800}
STATE_DIR=${CONSOLE_STATE_DIR:-$DIR/.alerts}
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
# --- paging (2026-08-19): rate-limited Telegram alert, email weekly fallback ---
#
# A distinct-cause key for the alert rate limiter. The same root cause (e.g.
# "push auth failing") must map to the same key even as data.json / .last-push-ok
# ages drift between runs, so we strip timestamps, drop digits/whitespace, and
# lowercase the last log lines before hashing.
cause_key() {
  local out
  out=$(tail -n 10 "$LOG" 2>/dev/null \
    | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+ ?//' \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[0-9]+//g; s/[[:space:]]+/ /g; s/^ //; s/ $//' \
    | grep -v '^$') || true
  printf '%s\n' "$out" | sha1sum | cut -d' ' -f1
}

# Primary alert channel: Telegram. Subject + body go through `hermes send` so
# the outbound gate classifies/logs them (console-failure vocabulary is treated
# as a hard failure). Returns the hermes exit code.
telegram_page() {
  local subject=$1 body=$2 tmp rc
  tmp=$(mktemp "${TMPDIR:-/tmp}/backlog-console-alert.XXXXXX") || return 1
  printf '%s\n' "$body" >"$tmp"
  "$TELEGRAM" send --subject "$subject" --file "$tmp" >>"$LOG" 2>&1
  rc=$?
  rm -f -- "$tmp"
  return $rc
}

# Weekly-fallback channel: email via notify-email -> ops-notify Worker.
email_page() {
  "$EMAIL" "$1" "$2" >>"$LOG" 2>&1
}

# Page Nish for a repeated staleness failure. Rate-limited to ONE alert per
# distinct cause per ALERT_MIN_INTERVAL_S; Telegram is primary, email is only a
# weekly fallback (used when Telegram fails, at most once per cause per
# EMAIL_WEEKLY_S). Freshness DETECTION above is untouched - only the paging
# channel and rate change.
page_nish() {
  local key now last_alert last_email telegram_ok
  key=$(cause_key)
  mkdir -p "$STATE_DIR"
  now=$(date +%s)
  last_alert=$(cat "$STATE_DIR/$key.alert" 2>/dev/null || echo 0)
  if [ $(( now - last_alert )) -lt "$ALERT_MIN_INTERVAL_S" ]; then
    log "alert suppressed: same cause already paged $(( now - last_alert ))s ago (< ${ALERT_MIN_INTERVAL_S}s)"
    jlog "refresh FAILED after retry (alert suppressed - already paged this cause within ${ALERT_MIN_INTERVAL_S}s)"
    return 0
  fi
  telegram_ok=0
  if telegram_page "$1" "$2"; then
    telegram_ok=1
    log "paged via Telegram"
  else
    log "Telegram page failed - trying weekly email fallback"
  fi
  last_email=$(cat "$STATE_DIR/$key.email" 2>/dev/null || echo 0)
  if [ "$telegram_ok" -eq 0 ] \
    && [ $(( now - last_email )) -ge "$EMAIL_WEEKLY_S" ]; then
    if email_page "$1" "$2"; then
      log "emailed (weekly fallback)"
      echo "$now" >"$STATE_DIR/$key.email"
    else
      log "email page delivery failed"
    fi
  fi
  echo "$now" >"$STATE_DIR/$key.alert"
  return 0
}

# Repeated failure -> page Nish. Only now, never on the first failure. The page
# is rate-limited to at most ONE alert per distinct cause per ALERT_MIN_INTERVAL_S
# and routed via Telegram with email as a weekly fallback only (2026-08-19).
log "refresh FAILED after retry - paging"
jlog "refresh FAILED after retry: $(tail -n 3 "$LOG" 2>/dev/null | tr '\n' ' ')"
page_nish "Fleet Backlog Console refresh FAILED" "$(diag)"
exit 1
