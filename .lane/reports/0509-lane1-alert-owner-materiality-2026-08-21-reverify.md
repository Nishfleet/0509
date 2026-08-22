# Lane 1 evidence: named owner + materiality reason on every alert — re-verified 2026-08-21

Item: "Add a named owner and materiality reason to every alert before delivery"
(research-desk 2026-08-08, risk: amber).
This lane re-verifies the resolution on the current `origin/main` tip; no
product code change was warranted.

## Verdict

Already implemented and merged on `origin/main` — PR #571 (commit
`47db20f4` "feat(alerts): named owner and materiality reason on every
delivered alert", merged 2026-08-11) built on PR #546 (commit `3484e7d8`
"feat(digest): named owner, materiality reason, and next action on every
brief", merged 2026-08-09). Re-verified on 2026-08-21 against the current
`origin/main` SHA `422fbd55`.

## Live-tree verification (not just history)

- `app/lib/change-intelligence.ts` — `alertMaterialityReason()` (line 133)
  derives a non-empty, human-readable materiality reason from the filed
  events (never invented); `digestReviewerLabel()` (line 76) resolves the
  exactly-one accountable reviewer label. Shares the digest event
  classification so alerts and briefs never disagree.
- `app/lib/delivery.server.ts` — `buildInstantAlertContent()` (line 3691)
  attaches materiality reason + reviewer label to every instant alert
  before delivery; Slack renderers carry both lines (`Why this matters:` /
  `Accountable reviewer:` at lines 3836-3837 and 3870-3871).
- `app/lib/monitoring.server.ts` — delivery callers pass the workspace-owner
  profile identity (`userName: profile?.name ?? null`, lines 612, 2252,
  2443), never the watchlist/competitor name.
- Fail-closed P1 follow-up from PR #571 review (commit `dc089bd8`): only
  events whose customer evidence resolves to `verified_change` contribute
  confirmed materiality copy.

## Evidence of correctness on this tip

- `git merge-base --is-ancestor 47db20f4 HEAD` → 0 (ancestor).
- `git merge-base --is-ancestor 3484e7d8 HEAD` → 0 (ancestor).
- Regression suite on the exact tree:
  `npx vitest run tests/delivery.server.test.ts tests/digest-email.test.ts
  tests/watch-event-evaluator.test.ts` → 3 files, 139/139 passed.
- Prior lane records agree: `.lane/reports/0509-lane1-alert-owner-materiality-already-merged.md`,
  docs commits `e44cc38d` (#605), `d173e09d` (#740), `2652fb79`.

## Files

- `.lane/reports/0509-lane1-alert-owner-materiality-2026-08-21-reverify.md` —
  this lane's evidence record only; no product code touched.
