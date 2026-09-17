#!/usr/bin/env bash
# pi-issue-0509-3356-preflight-tranche — continuation runner (fleet-ops#4804 class)
# Implements the senior auditor's measured-continuation contract committed at
# 6dffa493a (2026-09-13T19:53:44Z) inside .fleet/preflight-3356-tranche-packet.md:
#   1. deadline 300 (5h) — never 150. Measured need: sneaker 10m + fashion 119m
#      + home ~135m = ~4h45m paced; with fashion reused this run needs ~2.5h.
#   2. Deliverable written INCREMENTALLY: after each leg, append that leg's log
#      + a TRANCHE-LEG-COMPLETE line — a mid-run stop still leaves a deliverable.
#   3. sneaker re-run; a 500 = retry-once; gate = 26/26 (19:13Z prior run PROVED
#      26/26; the 194607Z 3x HTTP 500 were transient: kickscrew/solesavy/jdsports).
#   4. fashion: DONE, do NOT re-run — banked PASS 104/125 log is the honest record.
#   5. home-garden: the only missing leg, full fresh run (~135 min).
# Unit exit = sneaker's gate (E1) — the issue's hard gate. If the gate honestly
# fails after the retry, the unit exits non-zero WITH the deliverable + a
# TRANCHE-PREFLIGHT-COMPLETE line recording all three exit codes.
set -u
cd /home/nish/workspaces/agent-worktrees/issue-0509-3356 || exit 9
DELIV=.fleet/preflight-3356-tranche-logs.txt
STAMP=$(date -u +%Y-%m-%dT%H:%MZ)

# --- leg 1: sneaker-resale @26 (the hard gate; retry-once) -------------------
E1=9
{ npm run seed:publisher -- --list=sneaker-resale --dry-run --min-publish=26; } > .fleet/pf-3356-sneaker.log 2>&1
E1=$?
if [ "$E1" -ne 0 ]; then
  sleep 30
  { npm run seed:publisher -- --list=sneaker-resale --dry-run --min-publish=26; } > .fleet/pf-3356-sneaker.log 2>&1
  E1=$?
fi
{
  echo
  echo "== leg1 sneaker-resale @26 — continuation re-run $STAMP (194607Z attempt: 23/26 BELOW GATE on 3x transient HTTP 500; 19:13Z prior run PROVED 26/26)"
  cat .fleet/pf-3356-sneaker.log
  echo "TRANCHE-LEG-COMPLETE sneaker-resale PREFLIGHT-EXIT=$E1"
} >> "$DELIV"

# --- leg 2: fashion-ecommerce @100 — BANKED, do NOT re-run (clause 4) --------
E2=0
{
  echo
  echo "== leg2 fashion-ecommerce @100 — BANKED from the 2026-09-13T17:16Z run (PASS 104/125), not re-run per continuation clause 4"
  cat .fleet/pf-3356-fashion.log
  echo "TRANCHE-LEG-COMPLETE fashion-ecommerce PREFLIGHT-EXIT=0 (publish=104 skip=14 failed=7 gate=100 PASS)"
} >> "$DELIV"

# --- leg 3: home-garden @70 — the only missing leg, full fresh run ------------
E3=9
{ npm run seed:publisher -- --list=home-garden --dry-run --min-publish=70; } > .fleet/pf-3356-home.log 2>&1
E3=$?
{
  echo
  echo "== leg3 home-garden @70 — continuation fresh run $STAMP (194607Z attempt was killed 21min/20-of-90 domains)"
  cat .fleet/pf-3356-home.log
  echo "TRANCHE-LEG-COMPLETE home-garden PREFLIGHT-EXIT=$E3"
} >> "$DELIV"

{
  echo
  echo "TRANCHE-PREFLIGHT-COMPLETE unit=pi-issue-0509-3356-preflight-tranche mode=continuation-4804 legs=3/3 E1_sneaker_at26=$E1 E2_fashion_at100=$E2_banked E3_home_at70=$E3 PREFLIGHT-EXIT=$E1 (unit exit = sneaker gate, issue #3356) runner=.fleet/pf-3356-continuation.sh completed=$STAMP"
} >> "$DELIV"

exit "$E1"
