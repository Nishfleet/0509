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
