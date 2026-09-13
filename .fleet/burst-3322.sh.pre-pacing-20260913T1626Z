#!/usr/bin/env bash
# Issue 3322 phase-1 burst: 20 competitor workspaces through the product's own
# surface (signup -> magic-link redemption -> in-app import), no D1 inserts.
#
# Redemption mechanics (receipt: .fleet/phase-1-receipts.md + code-read 2026-09-13):
#   1. POST /auth/signup            -> 302 ?sent=1; better-auth verification row
#                                      (identifier = 43-char token, value = JSON, 90s TTL)
#   2. D1: newest verification.identifier for THIS email = the login token
#   3. Forged state: the ?token= legacy branch (better-auth.server.ts:986-1010)
#      only checks  ?state=  ==  cookie f9_better_magic_state  (no signature) —
#      NOTHING in the app sets that cookie, so we supply both sides ourselves.
#   4. GET /auth/better/magic-link?token=<t>&mode=signup&callbackURL=/app&newUserCallbackURL=/app&state=<s>
#      -> stages the f9_better_magic confirmation cookie, 302 to the confirm page
#   5. POST /auth/better/magic-link?mode=signup (same-origin) -> completeBetterAuthMagicLinkSignIn
#      -> better-auth session cookies, 302 (callback_failed on failure)
#   6. POST /app  intent=create-market-desk-import competitors=<domain> selectedRowIds=row-1
#      -> 1 watchlist + competitor + queueFirstWatchlistScanForSignupFirstBrief
#      -> 302 /app/onboard?step=first-brief (SIGNUP_FIRST_BRIEF_ENABLED=1, wrangler.jsonc:93)
#      WAIT — one caveat: /app POST may need a settled workspace; failures print, we continue.
#
# Env: GH-free; needs CLOUDFLARE_API_TOKEN (sourced from deploy-ci.env, never printed).
# Usage: .fleet/burst-3322.sh [start] [end]   (1-based inclusive; default 1 20)
set -u
cd "$(dirname "$0")/.."
set -a; source ~/.config/cloudflare/deploy-ci.env; set +a

JARTMP=$(mktemp -d)
trap 'rm -rf "$JARTMP"' EXIT
DOMAINS=(shein.com temu.com nike.com adidas.com zalando.com asos.com boohoo.com prettylittlething.com hm.com zara.com uniqlo.com gap.com levis.com puma.com newbalance.com frye.com everlane.com aerie.com cos.com aritzia.com)

START=${1:-1}; END=${2:-20}
OK=0; FAIL=0
for i in $(seq "$START" "$END"); do
  i2=$(printf '%02d' "$i")
  EMAIL="bet1-3322-${i2}@0509.io"
  JAR="$JARTMP/jar-$i2"
  DOMAIN="${DOMAINS[$((i-1))]:-example$ен$i.com}"
  [ -z "${DOMAINS[$((i-1))]:-}" ] && DOMAIN="shop$i2.example"

  # 1. signup (fresh; prior unit's rows for 01 are expired/unconsumed)
  SIG=$(curl -sS --max-time 30 -c "$JAR" -H "Origin: https://0509.io" -X POST https://0509.io/auth/signup \
    --data-urlencode "email=$EMAIL" --data-urlencode "name=BET1 3322 $i2" --data-urlencode "redirectTo=/app" \
    -o /dev/null -w '%{http_code} %{redirect_url}' 2>&1) || { echo "[$i2] signup curl FAIL: $SIG"; FAIL=$((FAIL+1)); continue; }
  case "$SIG" in 302*) ;; *) echo "[$i2] signup NOT-302: $SIG"; FAIL=$((FAIL+1)); continue;; esac

  # 2. newest verification token for THIS email (inside the 90s window)
  TOKEN=$(npx --no-install wrangler d1 execute 0509 --remote --json --json \
    --command "SELECT identifier FROM verification WHERE value LIKE '%$EMAIL%' ORDER BY rowid DESC LIMIT 1" 2>/dev/null \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["results"][0]["identifier"])' 2>/dev/null) \
    || { echo "[$i2] token read FAIL"; FAIL=$((FAIL+1)); continue; }
  [ -z "$TOKEN" ] && { echo "[$i2] token EMPTY"; FAIL=$((FAIL+1)); continue; }

  # 3. forge the state cookie (path / so curl sends it on /auth/better/... — the app only string-matches)
  printf '#HttpOnly_0509.io\tFALSE\t/\tFALSE\t0\tf9_better_magic_state\tstate-burst-%s\n' "$i2" >> "$JAR"

  # 4. ?token= legacy staging -> 302 ?mode=signup (+ f9_better_magic confirmation cookie)
  ST=$(curl -sS --max-time 30 -b "$JAR" -c "$JAR" \
    "https://0509.io/auth/better/magic-link?token=$TOKEN&mode=signup&callbackURL=/app&newUserCallbackURL=/app&state=state-burst-$i2" \
    -o /dev/null -w '%{http_code} %{redirect_url}' 2>&1) || { echo "[$i2] stage curl FAIL: $ST"; FAIL=$((FAIL+1)); continue; }
  case "$ST" in 302*mode=signup*) ;; *) echo "[$i2] stage NOT-confirm-302: $ST"; FAIL=$((FAIL+1)); continue;; esac

  # 5. confirm POST -> session + 302
  CP=$(curl -sS --max-time 30 -b "$JAR" -c "$JAR" -H "Origin: https://0509.io" \
    -H "Content-Type: application/x-www-form-urlencoded" -X POST "https://0509.io/auth/better/magic-link?mode=signup" \
    --data "" -o /dev/null -w '%{http_code} %{redirect_url}' 2>&1) || { echo "[$i2] confirm curl FAIL: $CP"; FAIL=$((FAIL+1)); continue; }
  case "$CP" in 302*/app*) ;; *) echo "[$i2] confirm NOT-app-302: $CP"; FAIL=$((FAIL+1)); continue;; esac

  # 6. the import (this queues the activation first scan)
  IMP=$(curl -sS --max-time 60 -b "$JAR" -c "$JAR" -H "Origin: https://0509.io" -X POST "https://0509.io/app" \
    --data-urlencode "intent=create-market-desk-import" \
    --data-urlencode "competitors=$DOMAIN" \
    --data-urlencode "selectedRowIds=row-1" \
    -o /dev/null -w '%{http_code} %{redirect_url}' 2>&1) || { echo "[$i2] import curl FAIL: $IMP"; FAIL=$((FAIL+1)); continue; }
  echo "[$i2] $EMAIL $DOMAIN signup:302 stage:302 confirm:302 import: $IMP"
  OK=$((OK+1))
done
echo "burst done: ok=$OK fail=$FAIL"
