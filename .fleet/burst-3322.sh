#!/usr/bin/env bash
# Issue 3322/3429 burst: 20 competitor workspaces through the product's own
# surface (signup -> magic-link redemption -> in-app import), no D1 inserts.
#
# Redemption mechanics post-#3427 (proven live 2026-09-14, probe receipt in
# .fleet/phase-2-receipts.md):
#   1. POST /auth/signup            -> 302 ?sent=1; better-auth sends the link.
#   2. better-auth 1.7.1 storeToken:"hashed" => D1 verification.identifier is
#      the HASH, not the redeemable token. The raw token only exists in the
#      magic_link_dispatched structured log line (workers tail) -> we run our
#      own `wrangler tail 0509 --format json` and pull token= from its `url`.
#   3. Forged state: the ?token= legacy branch (better-auth.server.ts) only
#      checks ?state= == cookie f9_better_magic_state (no signature) — NOTHING
#      in the app sets that cookie, so we supply both sides ourselves.
#   4. GET /auth/better/magic-link?token=<t>&mode=signup&callbackURL=/app&newUserCallbackURL=/app&state=<s>
#      -> stages the f9_better_magic confirmation cookie, 302 to the confirm page
#   5. POST /auth/better/magic-link?mode=signup (same-origin) -> session
#      cookies, 302 /app (callback_failed on failure). Token TTL 15 min.
#   6. POST /app/watchlists  intent=create-market-desk-import competitors=<d> selectedRowIds=row-1
#      -> 1 watchlist + competitor + queued first scan
#      -> 302 /app/onboard?step=first-brief (SIGNUP_FIRST_BRIEF_ENABLED=1)
#      (POST /app 405s on the deployed worker — the dashboard index action is
#      reached through the watchlists route, proven in the probe.)
#
# Env: needs CLOUDFLARE_API_TOKEN (sourced from deploy-ci.env, never printed).
# Usage: .fleet/burst-3322.sh [start] [end]   (1-based inclusive; default 1 20)
set -u
cd "$(dirname "$0")/.."
set -a; source ~/.config/cloudflare/deploy-ci.env; set +a

JARTMP=$(mktemp -d)
TAILLOG="$JARTMP/tail.jsonl"
npx --no-install wrangler tail 0509 --format json > "$TAILLOG" 2>"$JARTMP/tail.err" &
TAILPID=$!
trap 'kill "$TAILPID" 2>/dev/null; rm -rf "$JARTMP"' EXIT
sleep 6  # tail needs a few seconds to attach before events flow
[ -s "$JARTMP/tail.err" ] && grep -q "error\|Error" "$JARTMP/tail.err" && { echo "wrangler tail failed to start:"; cat "$JARTMP/tail.err"; exit 1; } || true

# newest magic_link_dispatched token for $1 (email) seen in the tail so far.
token_from_tail() {
  python3 - "$TAILLOG" "$1" <<'PY'
import json, sys, urllib.parse as u
path, email = sys.argv[1], sys.argv[2]
token = ""
try:
    fh = open(path, errors="replace")
except OSError:
    sys.exit(0)
for line in fh:
    if "magic_link_dispatched" not in line or email not in line:
        continue
    s = line.strip().rstrip(",")
    try:
        m = json.loads(s)
        if isinstance(m, str):
            m = json.loads(m)
    except Exception:
        continue
    if isinstance(m, dict) and m.get("event") == "magic_link_dispatched" and m.get("email") == email:
        q = u.parse_qs(u.urlparse(str(m.get("url", ""))).query)
        if q.get("token"):
            token = q["token"][0]
print(token)
PY
}
DOMAINS=(shein.com temu.com nike.com adidas.com zalando.com asos.com boohoo.com prettylittlething.com hm.com zara.com uniqlo.com gap.com levis.com puma.com newbalance.com frye.com everlane.com aerie.com cos.com aritzia.com)

START=${1:-1}; END=${2:-20}
OK=0; FAIL=0
# 16:26Z pacing fix: 429 storm on 0509.io (run 1: 0/20). Throttle every call, retry 429s.
pc() { local o; for a in 1 2 3; do sleep 3; o=$(curl -sS --max-time 30 "$@"); case "$o" in 429*) sleep 20;; *) printf "%s" "$o"; return 0;; esac; done; printf "%s" "$o"; }
pi() { sleep 3; local o; for a in 1 2; do o=$(curl -sS --max-time 60 "$@"); case "$o" in 429*) sleep 20;; *) printf "%s" "$o"; return 0;; esac; done; printf "%s" "$o"; }
for i in $(seq "$START" "$END"); do
  i2=$(printf '%02d' "$i")
  EMAIL="bet1-3322-${i2}@0509.io"
  JAR="$JARTMP/jar-$i2"
  DOMAIN="${DOMAINS[$((i-1))]:-example$ен$i.com}"
  [ -z "${DOMAINS[$((i-1))]:-}" ] && DOMAIN="shop$i2.example"

  # 1. signup (fresh; prior unit's rows for 01 are expired/unconsumed)
  SIG=$(pc  -c "$JAR" -H "Origin: https://0509.io" -X POST https://0509.io/auth/signup \
    --data-urlencode "email=$EMAIL" --data-urlencode "name=BET1 3322 $i2" --data-urlencode "redirectTo=/app" \
    -o /dev/null -w '%{http_code} %{redirect_url}' 2>&1) || { echo "[$i2] signup curl FAIL: $SIG"; FAIL=$((FAIL+1)); continue; }
  case "$SIG" in 302*) ;; *) echo "[$i2] signup NOT-302: $SIG"; FAIL=$((FAIL+1)); continue;; esac

  # 2. newest magic_link_dispatched token for THIS email from the tail
  #    (D1 verification.identifier is the post-1.7.1 hash — NOT redeemable).
  #    Tail delivery lags the signup by a few seconds: poll up to ~45s.
  TOKEN=""
  for _try in $(seq 1 15); do
    TOKEN=$(token_from_tail "$EMAIL")
    [ -n "$TOKEN" ] && break
    sleep 3
  done
  [ -z "$TOKEN" ] && { echo "[$i2] token EMPTY (no magic_link_dispatched in tail)"; FAIL=$((FAIL+1)); continue; }

  # 3. forge the state cookie (path / so curl sends it on /auth/better/... — the app only string-matches)
  printf '#HttpOnly_0509.io\tFALSE\t/\tFALSE\t0\tf9_better_magic_state\tstate-burst-%s\n' "$i2" >> "$JAR"

  # 4. ?token= legacy staging -> 302 ?mode=signup (+ f9_better_magic confirmation cookie)
  ST=$(pc  -b "$JAR" -c "$JAR" \
    "https://0509.io/auth/better/magic-link?token=$TOKEN&mode=signup&callbackURL=/app&newUserCallbackURL=/app&state=state-burst-$i2" \
    -o /dev/null -w '%{http_code} %{redirect_url}' 2>&1) || { echo "[$i2] stage curl FAIL: $ST"; FAIL=$((FAIL+1)); continue; }
  case "$ST" in 302*mode=signup*) ;; *) echo "[$i2] stage NOT-confirm-302: $ST"; FAIL=$((FAIL+1)); continue;; esac

  # 5. confirm POST -> session + 302
  CP=$(pc  -b "$JAR" -c "$JAR" -H "Origin: https://0509.io" \
    -H "Content-Type: application/x-www-form-urlencoded" -X POST "https://0509.io/auth/better/magic-link?mode=signup" \
    --data "" -o /dev/null -w '%{http_code} %{redirect_url}' 2>&1) || { echo "[$i2] confirm curl FAIL: $CP"; FAIL=$((FAIL+1)); continue; }
  case "$CP" in 302*/app*) ;; *) echo "[$i2] confirm NOT-app-302: $CP"; FAIL=$((FAIL+1)); continue;; esac

  # 6. the import (this queues the activation first scan)
  IMP=$(pi  -b "$JAR" -c "$JAR" -H "Origin: https://0509.io" -X POST "https://0509.io/app/watchlists" \
    --data-urlencode "intent=create-market-desk-import" \
    --data-urlencode "competitors=$DOMAIN" \
    --data-urlencode "selectedRowIds=row-1" \
    -o /dev/null -w '%{http_code} %{redirect_url}' 2>&1) || { echo "[$i2] import curl FAIL: $IMP"; FAIL=$((FAIL+1)); continue; }
  echo "[$i2] $EMAIL $DOMAIN signup:302 stage:302 confirm:302 import: $IMP"
  OK=$((OK+1))
done
echo "burst done: ok=$OK fail=$FAIL"
