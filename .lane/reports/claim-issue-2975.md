# Lane evidence — claim/issue-2975 (Nishfleet/0509 #2975, reopened)

Unit: pi-issue-0509-2975. Branch: claim/issue-2975.

## What this lane owns

The reopened issue's second, unowned killer: "concurrency cancel-in-progress —
a deploy that takes longer than the merge gap is cancelled by the next push
before it can finish, forever. Nothing detects it."

## What was already true on main (verified live, not assumed)

Deploy-latest is already the shipped design (bbccf182f): workflow-level
`cancel-in-progress: false` on `0509-production-provider-mutations`, no
`queue: max` — a running deploy is never interrupted; newer pushes supersede
the PENDING run only. Live proof, `gh run list` + per-run jobs API,
2026-09-12 ~00:50Z: all 15 cancelled runs in the last 25 had `jobs: []`
(never started = superseded while queued), while run 34662613491 ran
uninterrupted through Deploy Worker. The chain makes progress; the red runs
are Gate C `proof_email_dispatch_invalid` — owned by #2946, out of scope.

## What shipped

- `scripts/verify-deploy-chain-progress.mjs` — the detector the issue says
  does not exist. Emits one line per invocation:
  `deploy_chain: verdict=<ok|breach|unknown> runs=<n> superseded_pending=<n>
  midflight_kills=<ids|none> live=<n> last_terminal=<conclusion>@<id>
  detail=<...>`.
  - `midflight_kill` breach: a cancelled run that had started jobs — a
    deploy killed in flight, exactly the feared class.
  - `starved` breach: nothing live and the newest run cancelled, or every
    run in the window cancelled — the chain stopped attempting.
  - Superseded pendings are counted, never flagged: a deploy for commit N
    being superseded by N+1 is the design.
  - Always exits 0 (sibling contract of deploy-age.mjs): a detector that
    crashes is the silent failure it exists to kill.
- `tests/deploy-chain-progress.test.ts` — the accept bullet's drill:
  fixtures reproduce back-to-back pushes; a mid-flight-kill fixture fails
  (before), a superseded-pending + green-landing fixture passes (after),
  starved fixtures breach, and a wiring test pins the emit step.
- `.github/workflows/deploy-production.yml` — new `Emit deploy-chain
  progress line` step (`if: always()`, after deploy-age, `|| true` —
  detector, not gate: history a run cannot change must not red it or trip
  auto-revert on a good release). Touched a protected verifier →
  required-verifier-integrity needs the admin attestation path (same as
  #3012).
- `tsconfig.node.json` — script added to the typecheck include set.

## Verification

- `node scripts/verify-deploy-chain-progress.mjs` live:
  `deploy_chain: verdict=ok runs=30 superseded_pending=18
  midflight_kills=none live=2 last_terminal=failure@34660893424` — the
  observed window proves progress; the 18 cancellations are superseded
  pendings, zero mid-flight kills.
- `npx vitest run --configLoader runner --project node
  tests/deploy-chain-progress.test.ts` — 7/7 pass.
- `npx vitest run --configLoader runner --project node
  tests/deploy-production-gate.test.ts
  tests/workflow-routing-hardening.test.ts
  tests/production-candidate-workflow.test.ts
  tests/dispatch-deploy-production.test.ts
  tests/workflow-startup-safety.test.ts` — 74/74 pass.

## Not in this PR

- `accept:` bullet 2 (one real green Deploy production run) is blocked by
  #2946 (Gate C proof_email_dispatch_invalid, agent-in-progress) — a green
  deploy cannot land until that class fix merges. This PR proves the
  chain-progress half and ships its detector.
- The fleet-ops measure.sh wiring of deploy-age/deploy_chain lines is
  fleet-ops#5514.
