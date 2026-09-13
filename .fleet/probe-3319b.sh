#!/usr/bin/env bash
# Issue 3319, round 2: the 60s-spaced characterization series PLUS per-read
# discrimination the banked series lacked:
#   - cf-placement (smart-placement flap: local vs remote-XXX)
#   - discovery-branch signature (which resolver branch served the read)
#   - set-cookie presence (#1972 fresh-anon posture)
# Plus one 3-read 3s-apart burst first (isolate/warm-contrast) and one after
# the series. 200s grace. Writes one JSONL line per read, then a summary.
set -u
OUT="${1:-/home/nish/workspaces/agent-worktrees/issue-0509-3319/.fleet/probe-3319b-results.jsonl}"
BODYDIR=/tmp/probe3319b
mkdir -p "$BODYDIR"
URL="https://0509.io/search?q=calendly.com"

probe() { # $1=phase $2=index $3=sleep_after_s
  local ts hdr body readout ttfb total code placement ray len
  ts=$(date -u +%FT%TZ)
  hdr=$(mktemp); body="$BODYDIR/$(date -u +%H%M%S)-$1-$$-body.html"
  readout=$(curl -sS --compressed -o "$body" -w '%{time_starttransfer} %{time_total} %{http_code} %{size_download}' \
    -D "$hdr" --max-time 30 "$URL" 2>/dev/null)
  ttfb=${readout%% *}; rest=${readout#* }
  total=${rest%% *}; rest=${rest#* }
  code=${rest%% *}; size=${rest#* }
  placement=$(awk 'BEGIN{IGNORECASE=1} /^cf-placement:/{gsub("\r","");print $2}' "$hdr" | tail -1)
  ray=$(awk 'BEGIN{IGNORECASE=1} /^cf-ray:/{gsub("\r","");print $2}' "$hdr" | tail -1)
  freshcookie=$(awk 'BEGIN{IGNORECASE=1} /^set-cookie:/{gsub("\r","");if($0 ~ /f9_anon_search/) print "yes"; }' "$hdr" | tail -1)
  rm -f "$hdr"
  # Discovery-branch signature: which summary string did the SSR render?
  if   grep -q "Showing previously captured results while refreshing this query in the background" "$body"; then branch="stale_bg"
  elif grep -q "Showing previously captured results while this query refreshes in the background" "$body"; then branch="stale_waiter"
  elif grep -q "Commercial discovery is already warming this query" "$body"; then branch="warming_miss"
  elif grep -q "Showing the first ads while we load more" "$body"; then branch="partial"
  elif grep -q "Ad Library" "$body"; then branch="healthy_or_other"
  else branch="unknown"; fi
  # Keep the first fast and first slow body of the run for the diff proof.
  if awk -v t="$ttfb" 'BEGIN{exit !(t+0>=4)}'; then [ -f /tmp/probe3319b/slow-body.html ] || cp "$body" /tmp/probe3319b/slow-body.html; fi
  [ -f /tmp/probe3319b/fast-body.html ] || cp "$body" /tmp/probe3319b/fast-body.html
  printf '{"phase":"%s","ts":"%s","ttfb_s":%s,"total_s":%s,"http":%s,"bytes":%s,"placement":"%s","ray":"%s","fresh_set_cookie":"%s","branch":"%s"}\n' \
    "$1" "$ts" "$ttfb" "$total" "$code" "$size" "$placement" "$ray" "${freshcookie:-no}" "$branch" >> "$OUT"
  [ -n "${3:-}" ] && [ "$3" -gt 0 ] && sleep "$3"
}

: > "$OUT"
# Phase A: 3 back-to-back reads, 3s apart (isolate/placement flip test).
probe burstA 1 3
probe burstA 2 3
probe burstA 3 62
# Phase B: 12 spaced reads ~62s apart (the acceptance characterization).
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do probe spaced "$i" 62; done
# Phase C: 3 back-to-back reads after the last spaced one.
probe burstC 1 3
probe burstC 2 3
probe burstC 3 0
awk -F'"ttfb_s":' 'NF>1 && $0 !~ /summary/{split($2,a,","); n++; if (a[1]+0 < 2.0) fast++} END{printf "{\"summary\":\"done\",\"reads\":%d,\"fast_2s\":%d,\"slow_2s\":%d}\n", n, fast, n-fast}' "$OUT" >> "$OUT"
echo "probe2-complete"
