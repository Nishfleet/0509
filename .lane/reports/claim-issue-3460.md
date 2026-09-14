# Lane report — claim/issue-3460

Issue: Nishfleet/0509#3460 — `tests: product-assertion rot cluster A (split of
#3406) — #3081 #3097 #3124 #2944: prove alive-or-stale on current main; fix
the alive, close the stale with evidence`.

Checkout: `8d8723b9d` (origin/main) + this evidence file.
Metric: all four issues closed, each with a reproduced-and-fixed red or a
proof-of-green; required unit context green on the last landing commit.

## Per-issue state

- **#3081** — CLOSED (completed). Shared proof-of-green re-verified below.
- **#3097** — CLOSED (completed). Same shared proof.
- **#3124** — CLOSED (completed). Same shared proof.
- **#2944** — fix on main (`602b86723`, delivered by the REAL on-main merge
  `c26c55ce9` of PR #2947); green production run exists
  (34798996355, head `16bd92843`, contains both). Reopened twice by the
  deploy-fault gate — see below; closed for good once a green `Deploy
  production` run contains a `claim/issue-2944` delivery merge (sibling PR).

## Proof-of-green, re-verified on `8d8723b9d` this run

`npx vitest run --configLoader runner --project node tests/marketing-proof-brief.test.tsx`

```
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

This is the homepage hero-capture assertion family named by #3081/#3097/#3124
(the `was/is the hook on N Meta ads` span in `app/routes/marketing.tsx`; the
30-day `PROOF_CAPTURE_FRESH_DAYS` freshness window made the old fixed-date
fixture age out — the current fixture pins `hoursAgo: 4` relative to
`Date.now()`). Full per-issue triage: `.lane/reports/claim-issue-3406.md`
(merged in PR #3463).

## #2944 — the deploy-fault-gate blind spot

`deploy_fault_fix_shas` (fleet-ops#5785) resolves delivery via
`mergeCommit.oid`; for PR #2947 that is `9cc3f3bab`, an orphaned merge commit
that `diverged` from main after the 2026-09-11 history rewrite (real on-main
merge: `c26c55ce9`, same message + timestamp). No `Deploy production` run can
ever contain `9cc3f3bab` — its only run was cancelled — so the gate reopened
both prior closes even though green run 34798996355 contains the real fix.
Sibling branch `claim/issue-2944` lands the evidence file + a fresh on-main
delivery merge; gate gap filed as **Nishfleet/fleet-ops#6779**.

## This branch's role

Metric/tracking issue — zero product code. The merged PR gives the gate an
on-main delivery merge for `claim/issue-3460`
(`--head claim/issue-3460 --state merged` source), so the issue's close with
a comment citing the green run containing it is gate-legal.
