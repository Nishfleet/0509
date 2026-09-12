#!/usr/bin/env bash
# Issue 3319 acceptance bullet 1: characterize the /search TTFB tail over one
# spaced series (10+ reads, 60s apart) of the SAME probe the issue used.
# Writes progress (JSONL) incrementally to the deliverable so a partial run
# still yields evidence; final line is a verdict summary.
set -u
OUT="${1:-/home/nish/workspaces/agent-worktrees/issue-0509-3319/.fleet/probe-3319-results.jsonl}"
URL="https://0509.io/search?q=calendly.com"
: > "$OUT"

for i in $(seq 1 12); do
  ts=$(date -u +%FT%TZ)
  hdr=$(mktemp); body=$(mktemp)
  # readout = "<ttfb> <total> <http_code>"
  readout=$(curl -sS -o "$body" -w '%{time_starttransfer} %{time_total} %{http_code}' \
    -D "$hdr" --max-time 30 "$URL" 2>/dev/null)
  ttfb=${readout%% *}; rest=${readout#* }
  total=${rest%% *}; code=${rest#* }
  colo=$(awk 'BEGIN{IGNORECASE=1} /^cf-ray:/{gsub("\r","");print $2}' "$hdr" | tail -1)
  cache=$(awk 'BEGIN{IGNORECASE=1} /^cf-cache-status:/{gsub("\r","");print $2}' "$hdr" | tail -1)
  bytes=$(wc -c < "$body")
  rm -f "$hdr" "$body"
  printf '{"i":%s,"ts":"%s","ttfb_s":%s,"total_s":%s,"http":%s,"colo":"%s","cf_cache":"%s","bytes":%s}\n' \
    "$i" "$ts" "$ttfb" "$total" "$code" "$colo" "$cache" "$bytes" >> "$OUT"
  [ "$i" -lt 12 ] && sleep 60
done

awk -F'"ttfb_s":' 'NF>1 && $0 !~ /summary/{split($2,a,","); n++; if (a[1]+0 < 2.0) fast++} END{printf "{\"summary\":\"done\",\"reads\":%d,\"fast_2s\":%d,\"slow_2s\":%d}\n", n, fast, n-fast}' "$OUT" >> "$OUT"
echo "probe-complete"
