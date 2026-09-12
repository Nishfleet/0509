#!/usr/bin/env bash
# Issue #3317 — money-path 429 detector for the anonymous signup funnel.
#
# House live-probe pattern (scripts/canary-*.mjs): from a FRESH session, walk
# the four-step anonymous money path on BOTH devices (desktop + mobile):
# search -> result -> pricing -> signup-start, including the passive
# /api/auth/get-session prefetch every page fires and the one /api/demo-proof
# proof fetch the result page loads — then fire the issue's 24-GET/10-min
# burst at /auth/signup at ≤1 rps. Exit 0 ONLY when every single request is
# a 200 (zero 429s anywhere on the walk), printing each code as it goes.
#
# The 2026-09-12 receipts this guards (issue #3317):
#   - desktop /auth/signup -> 429, blank body, after three pages of funnel
#     prefetches had burned the old single 2/60s auth bucket;
#   - 25 × curl /auth/signup at ≤1 rps -> 7×200 / 18×429.
#
# Usage: bash scripts/verify-money-path-200s.sh
#   BASE_URL (default https://0509.io) — probe a different deployment.
#
# Deterministic within its own run: the walk+burst fits one 60s window of
# every scope it touches (auth-anon-get 60/60s after #3317, proof-brief
# 3/60s). Back-to-back reruns inside 60s of a previous run may legitimately
# 429 the proof-brief leg — that is #2964's neighbouring budget, untouched
# here by design.
set -u

BASE_URL="${BASE_URL:-https://0509.io}"
BURST_COUNT=24
BURST_INTERVAL_SECONDS=1.1

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

failures=0

# get <label> <path> <device-ua> [cookie-jar]
get() {
  local label="$1" path="$2" ua="$3" jar="${4:-}"
  local code
  code="$(curl -sS -o /dev/null -m 20 --retry 0 -w '%{http_code}' \
    -A "$ua" \
    ${jar:+-b "$jar" -c "$jar"} \
    "$BASE_URL$path")" || code="000"
  printf '%-34s %s\n' "$label" "$code"
  if [ "$code" != "200" ]; then
    failures=$((failures + 1))
    if [ "$code" = "429" ]; then
      # The 429 must stay honest: show Retry-After (issue #3317 acceptance 4
      # keeps it; #2964's proof-brief 429s report their own window).
      curl -sS -o /dev/null -m 20 -D - -A "$ua" "$BASE_URL$path" 2>/dev/null | grep -i '^retry-after' | head -1
    fi
  fi
}

DESKTOP_UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.18"
MOBILE_UA="Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1"

echo "== money-path walk: $BASE_URL (fresh session, both devices) =="
for device in desktop mobile; do
  if [ "$device" = "desktop" ]; then ua="$DESKTOP_UA"; else ua="$MOBILE_UA"; fi
  jar="$WORKDIR/$device.cookies"   # fresh session: a brand-new, empty cookie jar per device
  : >"$jar"
  # Funnel steps: search -> result -> pricing -> signup-start, plus the
  # passive /api/auth/get-session prefetch each page fires, plus the ONE
  # proof fetch on the result page (the 2026-09-12 walk's 429 subresource).
  get "$device/search"        "/search?query=nykaa"        "$ua" "$jar"
  get "$device/get-session"   "/api/auth/get-session"      "$ua" "$jar"
  get "$device/result/ads"    "/ads/nykaa.com"             "$ua" "$jar"
  get "$device/proof"         "/api/demo-proof?website=nykaa.com" "$ua" "$jar"
  get "$device/pricing"       "/pricing"                   "$ua" "$jar"
  get "$device/signup-start"  "/auth/signup"               "$ua" "$jar"
  get "$device/signup-prefetch" "/api/auth/get-session"    "$ua" "$jar"
done

echo "== signup-start burst: $BURST_COUNT × GET /auth/signup at ~1 rps (desktop) =="
for index in $(seq 1 "$BURST_COUNT"); do
  if [ "$index" -gt 1 ]; then
    sleep "$BURST_INTERVAL_SECONDS"   # ≤1 rps, the issue's own pacing
  fi
  get "burst-$index/$BURST_COUNT" "/auth/signup" "$DESKTOP_UA" "$WORKDIR/burst.cookies"
done

echo "== summary =="
if [ "$failures" -eq 0 ]; then
  echo "PASS: all money-path steps 200, $BURST_COUNT-GET burst without a single 429"
  exit 0
fi
echo "FAIL: $failures money-path step(s) did not return 200 (see codes above; 429s show their Retry-After)"
exit 1
