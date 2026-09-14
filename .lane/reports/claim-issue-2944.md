# Lane report — claim/issue-2944

Issue: Nishfleet/0509#2944 — `fix(e2e): Gate-B journey-2 mobile — entity
context detached from its title (58.8px > 48px limit) blocks every production
deploy`.

Checkout: `8d8723b9d` (origin/main) + this evidence file.

This branch is the deploy-fault-gate delivery leg for #2944. The code fix is
already on main and production already ran green on a SHA containing it — but
the gate cannot see that delivery, because the `mergeCommit` GitHub recorded
for the delivery PR is an orphan. This file is the evidence record; the PR's
merge commit is the missing on-main delivery the gate needs.

## The fix is real and on main

- Fix commit: `602b86723` (`fix(e2e): read the entity-context gap in one
  layout pass`, 2026-09-11). `gh api compare 602b86723...main` → `ahead`.
- Mechanism (per the earlier triage, `.lane/reports/claim-issue-3406.md`):
  `e2e/journey-2-release.spec.ts:285-315` waits for
  `document.fonts.status === "loaded"` and reads both boxes in ONE synchronous
  `page.evaluate`. The 58.8px was a stale `boundingBox().y` between two reads
  (run 34595877209), not a layout regression. The 48px threshold is unchanged.
- Green production proof: `Deploy production` run **34798996355**
  (https://github.com/Nishfleet/0509/actions/runs/34798996355) — conclusion
  `success`, head `16bd92843`, all six jobs green including the
  local-release e2e stage. `compare c26c55ce9...16bd92843` → `ahead` and
  `compare 602b86723...16bd92843` → `ahead`: the green run exercised the fix.

## Why the gate (fleet-ops#5785) cannot see it

`deploy_fault_fix_shas` resolves the delivery merge from
`gh pr view --json mergeCommit`. For PR #2947 that oid is **`9cc3f3bab`** —
a `Merge pull request #2947` commit (parents `ec6e615da` + `a1f1e43eb`,
committer 2026-09-11T13:48:16Z) that **diverged** from main
(`compare 9cc3f3bab...main` → `diverged`). The real on-main merge of the same
PR is **`c26c55ce9`** — same message, same timestamp, parents `d5fc3eec3` +
`602b86723`; `compare c26c55ce9...main` → `ahead`. Main's history was
rewound/re-merged on 2026-09-11 and the recorded oid stayed behind.

Consequence: every `DF_FIX_SHAS` resolution path (claim-branch merged-PR
lookup AND the merged-PR trailer scan) returns only `9cc3f3bab`, and no
`Deploy production` run can ever contain it — the only run on that sha,
34607797872 (2026-09-11T14:02Z), was **cancelled**. `deploy_fault_has_proof`
therefore returns 1 forever for this delivery; two legal-looking closes were
reopened:

- 01:40:50Z close citing run 34779307565 — that run failed at the ledger
  step; correctly rejected.
- 08:36:55Z close citing run 34798996355 — green and containing the REAL fix,
  but not the recorded `mergeCommit`; rejected again.

## What this PR changes

Adds this lane-evidence file only — zero product/test code. On merge, its
merge commit lands ON main and enters `DF_FIX_SHAS` via the
`--head claim/issue-2944 --state merged` source; the next green
`Deploy production` run on a descendant SHA then satisfies
`deploy_fault_has_proof`, and #2944 can be closed with a comment citing that
run — the gate's defined legal close.

Underlying gate gap filed as **Nishfleet/fleet-ops#6779**.
