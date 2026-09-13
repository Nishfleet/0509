# claim/issue-3330 — Gate C proof-email 503 (run 34728198258)

Pickup: unit `pi-issue-0509-3330`, claim 2026-09-13T20:52:14Z (this run), after the
worker-cheap attempts died (StartLimitBurst 06:31Z; 4th attempt rc=124 at 42m;
difficulty: senior-review). The worktree carried no unique commits — the branch
tip was exactly main @ bd41132f7 — so this run is a fresh diagnosis, not a salvage.

## Found (this run's diagnosis)

The issue's own fault — Gate C `proof_email_dispatch_invalid` 503, proof target
not resolving uniquely — was already fixed on main by #3366 (a4d650cf4, merged
12:21:50Z); the 18:05Z unit proved proof_email green on four production verdicts
and the acceptance's "fault moved to a named next check" clause. What still stood
between a landed deploy and the required "Deploy production reaches conclusion
success" was the deploy conclusion itself, so this run chased that:

- `scripts/commit-deploy-ledger.sh` shipped at mode 100644 in bbccf182f (the
  #2975 review-fix commit), but `.github/workflows/deploy-production.yml:673`
  runs it as `./scripts/commit-deploy-ledger.sh` → exit 126 Permission denied.
- Two consecutive deploys lost to it, same step, same error:
  run 34778207891 (301caf4b0, step at 20:19:07Z) and run 34779307565 (d0ddd3dbc,
  step at 20:56:22Z) — `./scripts/commit-deploy-ledger.sh: Permission denied`,
  `Process completed with exit code 126`. The queued 34780512552 (bd41132f7) is
  the third victim: its checkout is also pre-fix, so it fails the same way.

## Shipped

- Mode-only fix: `scripts/commit-deploy-ledger.sh` 100644 → 100755 (zero content
  diff). Locally proven fails-before (`./scripts/commit-deploy-ledger.sh:
  Permission denied`, exit 126 — byte-identical to the CI failures) and
  passes-after (the script executes; it reaches the `PINNED_SHA is required`
  check, which the Actions step supplies).
- One gate test in the existing `tests/deploy-production-gate.test.ts`: every
  deploy-job `run: ./scripts/...` step must point at an executable checkout —
  red before the bit, green after. The convention now has a home; the next
  100644 ship fails the affected suite, not a production deploy.

## Honest limits

- The bit unblocks the ledger step only. production_meta #3392, proof_cleanup
  #3337, post-Gate-C e2e #3373 and Gate B J2 #2513 still stand between a landed
  deploy and a fully-green one; those own their remaining failures.
- Run 34780512552 still fails (pre-fix head); the first beneficiary is the first
  deploy dispatched after this PR lands. The issue closes via the deploy-fault
  gate on the first fully-green Deploy production run whose SHA contains
  a4d650cf4 (fleet-ops#5785) — it is protected/observe-to-close, not closed here.
- Orphaned 1ea0618b6 (wip(salvage) litter: `.ns-3330.txt`/`.pr-body-3330.md` at
  repo root, now dropped from the branch) — the 20:26Z judge ruled its residual
  test-fidelity delta not merge-critical; retired, not resurrected.
