#!/usr/bin/env bash
# Hermetic regression test for backlog-console-refresh.sh (2026-08-19).
#
# Guards the two defects that made the systemd --user unit fail while the same
# script exited 0 by hand:
#   1. CREDENTIALS: the script must source fleet-console/cf.env so wrangler can
#      authenticate under systemd --user (whose env lacks the interactive
#      shell's CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID). Without this the
#      push fails with "assign its value to CLOUDFLARE_API_TOKEN".
#   2. FAIL LOUD: on the repeated-failure path the script must log its failure
#      reason to the journal (via logger) and to stderr - never a silent exit 1.
#
# Runs against a throwaway directory; nothing outside it is touched.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT

# --- fake fleet-console/cf.env (credentials the unit must load) ---
cat >"$ROOT/cf.env" <<'EOF'
CLOUDFLARE_API_TOKEN=test-token-123
CLOUDFLARE_ACCOUNT_ID=test-account-456
EOF

# --- fake generate.py: writes a fresh data.json ---
cat >"$ROOT/generate.py" <<'EOF'
#!/usr/bin/env python3
import json, pathlib, time
pathlib.Path("data.json").write_text(json.dumps({"t": time.time()}))
print("wrote data.json")
EOF
chmod +x "$ROOT/generate.py"

# --- fake push.sh: records whether the token was visible, then FAILS ---
cat >"$ROOT/push.sh" <<'EOF'
#!/usr/bin/env bash
echo "push.sh saw CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN:-UNSET}"
echo "push.sh saw CLOUDFLARE_ACCOUNT_ID=${CLOUDFLARE_ACCOUNT_ID:-UNSET}"
echo "PUSH FAILED - console is now STALE: assign its value to CLOUDFLARE_API_TOKEN" >&2
exit 1
EOF
chmod +x "$ROOT/push.sh"

# --- fake notify-email: no-op ---
cat >"$ROOT/notify-email" <<'EOF'
#!/usr/bin/env bash
echo "emailed: $1"
EOF
chmod +x "$ROOT/notify-email"

# --- fake logger: captures journal lines to a file ---
FAKE_JOURNAL="$ROOT/journal.out"
cat >"$ROOT/fake-logger" <<EOF
#!/usr/bin/env bash
cat >>"$FAKE_JOURNAL"
EOF
chmod +x "$ROOT/fake-logger"

# --- fake stat/date helpers are real; run the script from $ROOT so the fake
# generate.py writes data.json into $DIR ---
cd "$ROOT"
set +e
CONSOLE_DIR="$ROOT" \
CONSOLE_LOG="$ROOT/refresh.log" \
CONSOLE_PAGE_CMD="$ROOT/notify-email" \
CONSOLE_PYTHON=python3 \
CONSOLE_PUSH_SH="$ROOT/push.sh" \
CONSOLE_CF_ENV="$ROOT/cf.env" \
CONSOLE_LOGGER="$ROOT/fake-logger" \
FAKE_JOURNAL="$ROOT/journal.out" \
  "$SCRIPT_DIR/refresh.sh" >"$ROOT/stdout.txt" 2>"$ROOT/stderr.txt"
rc=$?
set -e

fail() { echo "FAIL: $*" >&2; exit 1; }

# 1. The script must exit 1 on repeated failure (not silently succeed).
[ "$rc" -eq 1 ] || fail "expected exit 1, got $rc"

# 2. Credentials must be loaded from cf.env (the env/credential difference).
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

echo "PASS: credentials sourced from cf.env; failure logged to journal + stderr; exit 1"
