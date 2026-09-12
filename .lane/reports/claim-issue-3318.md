# Lane evidence — claim/issue-3318 (Nishfleet/0509#3318)

## Task

The judge's visitor line jumped between its 17:21Z and 17:42Z reads on
2026-09-12 (quoted on #3318):

- 17:21Z: home 855ms / search 5124ms
- 17:42Z: `visitor: https_redirect=301 home_ttfb_ms=3685 home_edge=NONE
  search_ttfb_ms=6442 manifest=200 dup_routes=0 public_repo_leaks=0`

Context per #3318: production on main since ~08:10Z, no deploy between the
two reads; `home_edge=NONE` was the carried known field. The judge's 18:25Z
comment already read home 308ms / search 1122ms and called the 17:42Z spike
"transient edge/origin latency, not a code regression", directing a 3x
re-probe before any close.

## Finding: the home jump did not persist — transient

Re-probe as required (`/` and `/search` on one visitor line, 3x, ~60s
apart, 2026-09-12; `bash bin/fleet-visitor-probe` from the fleet-ops
checkout, real curl):

```
=== probe 1: 18:37:52Z ===
visitor: https_redirect=301 home_ttfb_ms=933 home_edge=NONE search_ttfb_ms=1264 manifest=200 dup_routes=0 public_repo_leaks=0
=== probe 2: 18:38:57Z ===
visitor: https_redirect=301 home_ttfb_ms=311 home_edge=HIT search_ttfb_ms=1086 manifest=200 dup_routes=0 public_repo_leaks=0
=== probe 3: 18:40:01Z ===
visitor: https_redirect=301 home_ttfb_ms=337 home_edge=HIT search_ttfb_ms=6925 manifest=200 dup_routes=0 public_repo_leaks=0
```

Home: 933 / 311 / 337ms — all three reads under the 1500ms acceptance, the
last two under the 855ms pre-jump baseline. Together with the judge's 308ms
at 18:25Z, the 3685ms reading never repeated. The jump was transient, so
the acceptance's fix branch never fired and no code needed changing.

Noted, not caused by this diff: `home_edge` read `NONE` on the first visit
and `HIT` on the next two — the root document now carries edge-cache state
it historically lacked. #2950 tracks the `home_edge=NONE` history; this
report only records the observation.

## The search half — not all-normal, escalated

Probe 3 spiked `/search` back to 6925ms, so "all normal" did not hold. Four
follow-up diagnostic reads (30s apart, 18:41–18:42Z, `curl -w`) of
`/search?q=calendly.com` reproduced it: one fast (966ms), three slow
(7136 / 6957 / 6297ms). On every read: DNS ≤1.8ms, connect ≤16.6ms,
TLS ≤41ms, `cf-ray` colo HAM, and `ttfb ≈ total` (7.136s of 7.167s) — the
seconds are origin-side, and `/search` carries no `cf-cache-status` at all.
Same URL, same colo, ~40ms of network, yet ~1.0s vs ~7.0s of origin work.

That is an intermittent origin-side stall, and this issue's acceptance
names home only. The full 10-read evidence table (the judge's three reads
plus these seven) and the timing fields are filed as #3319; #3318 stays
scoped to the home jump.

## Acceptance check

- required: re-probe `/` and `/search` 3x each, 60s apart — done, the
  18:37:52Z / 18:38:57Z / 18:40:01Z lines above. With the numbers: the home
  jump did NOT persist; the search tail is intermittent and is #3319.
- accept (persistent-jump branch): never fired — home 933 / 311 / 337ms,
  all under 1500ms on every spaced read; the 17:42Z spike never repeated.
- must-not: no hand redeploy; no cache/config change outside a PR — the
  only artifacts are this report and #3319; nothing was redeployed or
  reconfigured.
