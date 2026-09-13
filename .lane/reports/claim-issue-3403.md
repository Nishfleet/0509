# claim/issue-3403 — Gate C e2e:prod:public red + the deploy-ledger 126 (double root cause)

## Resume context

Unit pi-issue-0509-3403 died (exit-code/1) at 2026-09-13T20:07Z; this unit resumed the salvaged
worktree `wip/pi-issue-0509-3403-20260913T200716Z` @ 24560c54f (the prior unit's last local
prod-public run PASSED — `test-results/e2e/.last-run.json: status=passed, failedTests: []`,
20:06Z — it died before it could ship). This unit continues that branch, no re-derivation.

## Root cause (named — two independent blockers, both proven)

1. **Gate C: the 217-anchor reachability walk is sequential under a 420s test budget.**
   #3396 raised the budget 240s→420s but left the walk serial: 217+ anchors × 0.7–2.3s ≈ 150–500s.
   Run 34775660969 (522c79d4, 18:46Z): `Test timeout of 420000ms exceeded` + disposed request +
   the /brands "Sport & footwear" 404 at `expectPublicGetTargetReachable` (spec:107-108). The
   .f9-wk-say 30s failure in the same observed block is a flake, not structural: it passed on
   that run's retry, in the 19:58Z production run, and here (2.9s).
2. **The deploy-ledger recorder lost its +x.** Every Deploy production run since #2975's bbccf182f
   (2026-09-12, when the script was created `100644`) exits 126 at "Record the deploy in the
   on-main ledger" — proven live on run 34779307565 (d0ddd3db, 19:58Z): Deploy ✓, secrets ✓,
   evidence ✓, **the entire e2e:prod:public leg PASSED (14/0/3, 7.2m, smoke 6.8m vs 420s = 12s
   margin)**, then `./scripts/commit-deploy-ledger.sh: Permission denied`, exit 126. All
   workflow-called script siblings are 100755; this one never was. No production deploy on main
   can conclude success until this bit lands — it is the acceptance's last blocker.

## Fix (salvage + one bit; no assertion weakened, nothing removed)

- 24560c54f (prior unit, resumed): `settledProbeResponse` (3 attempts, 1.5s/3s apart, absorbs
  version-flip 404s; final expectations unchanged) + the 217-anchor walk in 6 lanes (under the
  production `MONITORING_FANOUT_MAX_INFLIGHT=8` guard).
- This unit: `git update-index --chmod=+x scripts/commit-deploy-ledger.sh` (100644→100755).
  One bit. Nothing else.

## Proof

- `PLAYWRIGHT_WORKERS=1 npm run e2e:prod:public` (the deploy's own failing command, exactly,
  against https://0509.io) → **EXIT 0, 14 passed / 3 skipped (pre-existing production skips) /
  0 failed, 4.0m**, including the previously-failing smoke (spec:360) and the .f9-wk-say
  header-layout test (2.9s).
- Coupling: `tests/search-display.test.ts` (readFileSync's the edited spec) → 37/37.
- Production A/B without the fix: 34779307565's e2e leg 14/0/3 then the ledger 126 — the exact
  double root cause, on the record. The 20:21Z run (bd41132f) is queued to repeat the 126; it
  carries no fix (verified: `git diff 56a3e3f1d..origin/main -- e2e/` empty; ledger 100644 at
  bd41132f).
- `sgscan` → "No new security findings" (exit 0). `crgate` → exit 0 ("CodeRabbit is not signed in
  on this machine" — named, per precedent; the substantive review is the senior round, recorded
  in the PR body).
- Fleet-ops note: `lib/seat-lib.sh` in `fleet-ops-deploy-clone` has no `find_senior_seat`
  (source+call → exit 127, named); the resolved copy is `fleet-ops-deploy/lib/seat-lib.sh` →
  **nebius / zai-org/GLM-5.3-Flash** ("senior ladder exhausted/walled; falling through to any
  capable seat" — the lookup's own log line), which `fleet-review-arm-check` (exit 0) blessed
  for the reviewer round.

## Acceptance mapping

- "one Deploy production run on main with conclusion success" — the +x restores the last failing
  leg (19:58Z: everything before the ledger passed); the run this merge triggers is the proof
  watch-point (deploy-gated, not claimed here — by design, no deploy without the gates).
- "the brands link assertion either green or explicitly retired" — green, not retired: the
  settled 6-lane walk asserts the same targets; proven above.

test-removal-justified: n/a — zero tests removed, renamed, skipped or .only'd.
