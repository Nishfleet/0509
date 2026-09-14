<!-- fleet-ops#1204 salvage resume -->
The previous worker died. Continue from `wip/pi-issue-0509-3356-preflight-tranche-c2-20260913T223450Z` (local). Verify that work, finish it. Do not start from zero.
<!-- /fleet-ops#1204 salvage resume -->

# pi-issue-0509-3356 — tranche floor preflight (detached)

Issue: Nishfleet/0509#3356. Runs the #1549 dry-run preflight (the issue's own
verify, unchanged mechanism) sequentially over:

1. sneaker-resale @ --min-publish=26 — the issue's hard gate; unit exit = this.
2. fashion-ecommerce @ --min-publish=100 — recorded, tranche-window floors
   stay with the #1549 nightly telemetry (accept #2).
3. home-garden @ --min-publish=70 — recorded, same honesty rule.

Paced by the existing anonymous /search budget (20 req/10 min); 429s wait out
Retry-After. Deliverable: .fleet/preflight-3356-tranche-logs.txt (always
written; concatenated). A TRANCHE-PREFLIGHT-COMPLETE line records the three
exit codes. sneaker@26 failing => non-zero unit exit (real failed gate).

## Continuation arithmetic (senior auditor 2026-09-14T20:10Z — WHY 194607Z tripped)

MEASURED from the dead run (.fleet/pf-3356-*.log): sneaker 10 min, fashion
125 domains = 119 min, home-garden 90 domains ~1.5 min/domain = ~135 min;
cold-total ~4h45m. The dispatched deadline was 150 min — killed 21 min into
home-garden, and the deliverable was written only at the END, so the kill
left nothing (4804 precedent: the dead-man deadline must cover the WHOLE
paced run AND see a deliverable at stop). Banked evidence lives in
.fleet/preflight-3356-tranche-logs.txt (TRANCHE-PREFLIGHT-PARTIAL) and
branch wip/pi-issue-0509-3356-preflight-tranche-20260913T194607Z (local +
origin, tip = this packet's measured-continuation commit).

1. Dispatch the detached re-run with --deadline 300 (5 h), NEVER 150.
2. Write the deliverable INCREMENTALLY: after EACH leg, append that leg's
   log + a `TRANCHE-LEG-COMPLETE <list>` line to
   .fleet/preflight-3356-tranche-logs.txt — a mid-run stop must still
   leave a deliverable for the dead-man.
3. sneaker (10 min): 19:13Z already PROVED 26/26 (PREFLIGHT-EXIT=0,
   .fleet/preflight-3356-sneaker-resale.log); the 3x HTTP 500 in 194607Z
   (kickscrew/solesavy/jdsports) were transient — re-run the leg, 500 =
   retry-once, gate = 26/26.
4. fashion: DONE, do NOT re-run — the banked pf-3356-fashion.log is a
   COMPLETE record (PASS 104/125) and accept #2's honest-record rule is
   satisfied by that log; reuse it in the concatenated deliverable.
5. home-garden (the only missing leg, ~135 min): full fresh run, then
   concatenate all three + `TRANCHE-PREFLIGHT-COMPLETE <3 exit codes>`.
   Reuse => total ~2.5 h inside the 300-min deadline; re-running fashion
   too = ~4.4 h, still inside but no further legs after it.
