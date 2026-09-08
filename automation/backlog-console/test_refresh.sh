#!/usr/bin/env bash
# Hermetic regression test for backlog-console-refresh.sh (2026-08-19).
#
# Guards the defects that made the backlog-console systemd unit page Nish 5+
# times overnight for one root cause (push auth failing):
#   1. CREDENTIALS: the script must source fleet-console/cf.env so wrangler can
#      authenticate under systemd --user (whose env lacks the interactive
#      shell's CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID). Without this the
#      push fails with "assign its value to CLOUDFLARE_API_TOKEN".
#   2. FAIL LOUD: on the repeated-failure path the script must log its failure
#      reason to the journal (via logger) and to stderr - never a silent exit 1.
#   3. RATE LIMIT (2026-08-19): under a forced stale console, two consecutive
#      runs of the SAME cause fire EXACTLY ONE alert (the second is suppressed
#      inside the 6h window). The alert goes to Telegram by default.
#   4. EMAIL WEEKLY FALLBACK (2026-08-19): when Telegram fails, email is used -
#      but at most once per cause per week.
#
# Runs against a throwaway directory; nothing outside it is touched.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

# --- fake fleet-console/cf.env (credentials the unit must load) ---
cat >"$ROOT/cf.env" <<'EOF'
CLOUDFLARE_API_TOKEN=test-token-123
CLOUDFLARE_ACCOUNT_ID=test-account-456
EOF

# --- fake generate.py: writes a fresh data.json (so the only failure is push) ---
cat >"$ROOT/generate.py" <<'EOF'
#!/usr/bin/env python3
import json, pathlib, time
pathlib.Path("data.json").write_text(json.dumps({"t": time.time()}))
print("wrote data.json")
EOF
chmod +x "$ROOT/generate.py"

# --- fake push.sh: records whether the token was visible, then FAILS (stale) ---
cat >"$ROOT/push.sh" <<'EOF'
#!/usr/bin/env bash
echo "push.sh saw CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN:-UNSET}"
echo "push.sh saw CLOUDFLARE_ACCOUNT_ID=${CLOUDFLARE_ACCOUNT_ID:-UNSET}"
echo "PUSH FAILED - console is now STALE: assign its value to CLOUDFLARE_API_TOKEN" >&2
exit 1
EOF
chmod +x "$ROOT/push.sh"

# --- fake telegram (hermes send): counts invocations, honors TG_EXIT ---
cat >"$ROOT/fake-telegram" <<'EOF'
#!/usr/bin/env bash
n=$(cat "$TG_COUNT" 2>/dev/null || echo 0)
echo $(( n + 1 )) >"$TG_COUNT"
exit "${TG_EXIT:-0}"
EOF
chmod +x "$ROOT/fake-telegram"

# --- fake email (notify-email): counts invocations, honors EM_EXIT ---
cat >"$ROOT/fake-email" <<'EOF'
#!/usr/bin/env bash
n=$(cat "$EM_COUNT" 2>/dev/null || echo 0)
echo $(( n + 1 )) >"$EM_COUNT"
exit "${EM_EXIT:-0}"
EOF
chmod +x "$ROOT/fake-email"

# --- fake logger: captures journal lines to a file ---
FAKE_JOURNAL="$ROOT/journal.out"
cat >"$ROOT/fake-logger" <<EOF
#!/usr/bin/env bash
cat >>"$FAKE_JOURNAL"
EOF
chmod +x "$ROOT/fake-logger"

# Run refresh.sh once with the common env. Emits its exit code on stdout.
run_once() {
  cd "$ROOT"
  set +e
  CONSOLE_DIR="$ROOT" \
  CONSOLE_LOG="$ROOT/refresh.log" \
  CONSOLE_TELEGRAM_CMD="$ROOT/fake-telegram" \
  CONSOLE_EMAIL_CMD="$ROOT/fake-email" \
  CONSOLE_PYTHON=python3 \
  CONSOLE_PUSH_SH="$ROOT/push.sh" \
  CONSOLE_CF_ENV="$ROOT/cf.env" \
  CONSOLE_LOGGER="$ROOT/fake-logger" \
  CONSOLE_STATE_DIR="$ROOT/.alerts" \
  TG_COUNT="$ROOT/tg.count" \
  EM_COUNT="$ROOT/em.count" \
    "$SCRIPT_DIR/refresh.sh" >"$ROOT/stdout.txt" 2>"$ROOT/stderr.txt"
  local rc=$?
  set -e
  echo "$rc"
}

# reset counters + alert state for an isolated scenario
reset() {
  rm -f "$ROOT/refresh.log" "$ROOT/tg.count" "$ROOT/em.count" "$ROOT/stderr.txt" "$ROOT/journal.out"
  rm -rf "$ROOT/.alerts"
}

tg() { cat "$ROOT/tg.count" 2>/dev/null || echo 0; }
em() { cat "$ROOT/em.count" 2>/dev/null || echo 0; }

# ---------------------------------------------------------------------------
# Test 1: forced stale, Telegram healthy. Exactly ONE alert across two runs.
# ---------------------------------------------------------------------------
reset
export TG_EXIT=0 EM_EXIT=0
rc1=$(run_once); rc2=$(run_once)
[ "$rc1" -eq 1 ] || fail "expected exit 1 on first stale run, got $rc1"
[ "$rc2" -eq 1 ] || fail "expected exit 1 on second stale run, got $rc2"
[ "$(tg)" -eq 1 ] || fail "expected EXACTLY ONE telegram alert across two stale runs, got $(tg)"
[ "$(em)" -eq 0 ] || fail "expected no email when Telegram succeeds, got $(em)"

# Credentials must be loaded from cf.env (the env/credential difference).
grep -q "push.sh saw CLOUDFLARE_API_TOKEN=test-token-123" "$ROOT/refresh.log" \
  || fail "CLOUDFLARE_API_TOKEN was not sourced from cf.env (push.sh saw it unset)"
grep -q "push.sh saw CLOUDFLARE_ACCOUNT_ID=test-account-456" "$ROOT/refresh.log" \
  || fail "CLOUDFLARE_ACCOUNT_ID was not sourced from cf.env"

# 3. Fail LOUD: the failure reason must reach the journal (fake logger).
grep -q "refresh FAILED after retry" "$ROOT/journal.out" \
  || fail "failure reason was not logged to the journal (journal.out empty)"
# 4. Fail LOUD: the failure reason must also reach stderr (systemd captures it).
grep -q "refresh FAILED after retry" "$ROOT/stderr.txt" \
  || fail "failure reason was not written to stderr"
# 5. The second run must have been rate-limited (logged suppression).
grep -q "alert suppressed" "$ROOT/refresh.log" \
  || fail "second stale run was not rate-limited (no suppression logged)"

# ---------------------------------------------------------------------------
# Scenario 2: Telegram fails -> email used as weekly fallback, also capped.
# ---------------------------------------------------------------------------
reset
export TG_EXIT=1 EM_EXIT=0
rc1=$(run_once); rc2=$(run_once)
[ "$rc1" -eq 1 ] || fail "rc1 should be 1, got $rc1"
[ "$rc2" -eq 1 ] || fail "rc2 should be 1, got $rc2"
[ "$(tg)" -eq 1 ] || fail "expected 1 telegram attempt (failing), got $(tg)"
[ "$(em)" -eq 1 ] || fail "expected exactly ONE weekly-fallback email across two stale runs, got $(em)"

echo "PASS: credentials sourced; fail loud to journal+stderr; exactly one alert per 6h/cause; Telegram primary, email weekly fallback"
