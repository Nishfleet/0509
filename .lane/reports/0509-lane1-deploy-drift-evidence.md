# Deploy production dying on remote_main_drift — already fixed by PRs #556 + #630 (merged)

**Status: evidence record — the item is implemented and merged on origin/main.
No product code touched by this lane.**

Branch: `0509-lane1-deploy-drift-evidence`
Base: `origin/main` at `370e5417` (#717)

## Item

- [ ] Stop Deploy production from dying on `remote_main_drift` after a full
      green gate when main moves mid-run [scout 2026

## Verdict

The item is **already implemented and merged to main** by two commits, both
verified as ancestors of the current `origin/main` tip in this worktree with
`git merge-base --is-ancestor <sha> origin/main` (true):

- **`c3539abb` — PR #556** (`fix(deploy): stop remote_main_drift from killing a
  deploy after a fully green gate`, landed 2026-08-09): added the opt-in
  `TOLERATE_MAIN_DRIFT=1` downgrade to `scripts/ci-verify-provider-main-cas.sh`
  (drift-only; every other CAS failure stays fail-closed), set it on the two
  post-gate checks that existed then (deploy job's `Reconfirm frozen main
  before provider mutation`, plan's `reconfirm_frozen_main_before_deploy`),
  and pinned the behavior in tests.
- **`f5aabf14` — PR #630** (`ci(deploy): unblock production CAS mid-pipeline
  drift and canary sync`, landed 2026-08-11): closed the residual gap where
  the 19–40 minute prepare/evidence window let main advance before the other
  post-pin jobs re-verified — `TOLERATE_MAIN_DRIFT=1` is now set on every
  post-pin CAS step:
  - deploy job: `Verify pinned candidate before repository and secret work`
  - prepare job: `Verify pinned candidate before self-hosted work`
  - generate job: `Reconfirm frozen main before evidence mutation`

The initial pin (`pin_candidate` → `Verify and pin exact main candidate`) and
every non-drift CAS failure remain fail-closed by design.

## Acceptance mapping (item → merged behavior)

- **Deploy production does not die on mid-run drift after a green gate** —
  every post-gate CAS re-verification in `deploy-production.yml` runs with
  `TOLERATE_MAIN_DRIFT: "1"`, so a mid-run move of main prints
  `Deploying pinned SHA <sha> behind main: provider main moved to <sha> while
  the exact candidate was verified.` and continues shipping exactly
  `PINNED_SHA` — the same SHA the gate validated.
- **Fail-closed everywhere else is preserved** — wrong repo/ref, event/head
  mismatch, non-detached checkout, API unavailable, malformed SHA, and the
  initial pre-gate pin all still abort (the script's drift downgrade is
  strictly opt-in and gated on `TOLERATE_MAIN_DRIFT=1`).
- **The plan path is covered too** — `scripts/deploy-production-plan.mjs`
  sets `TOLERATE_MAIN_DRIFT: "1"` on its
  `reconfirm_frozen_main_before_deploy` step immediately before
  `wrangler deploy`.

## Deliberately unchanged (still fail-closed, by design)

The two support workflows keep their "Reconfirm frozen main" steps
fail-closed on drift and their tests pin that exactly:

- `.github/workflows/d1-remote-restore-evidence.yml` — its three
  `Reconfirm frozen main before …` steps (pre-migration backup, migration
  apply, restore mutation) intentionally have no drift flag:
  `tests/d1-remote-restore-evidence.test.ts` asserts their env is exactly
  `{ GH_TOKEN: "${{ github.token }}" }` (lines 410–413, 427–431, 513–516).
  These are unattended/nightly D1 mutation drills where proceeding on a moved
  main would be unsafe — different risk posture from a gated production
  deploy.
- `.github/workflows/d1-backup-r2.yml` — same fail-closed posture for its
  candidate verifications.

The item names **Deploy production** specifically; the restore-evidence
workflow's stricter behavior is a sibling subsystem with its own pinned
contract, not a gap in this item.

## Verification run (this lane)

Run on current main in this worktree (no product changes; report branch only):

```
$ npx vitest run --configLoader runner \
    tests/production-candidate-workflow.test.ts \
    tests/deploy-production-gate.test.ts
 Test Files  2 passed (2)
      Tests  47 passed (47)
```

- `tests/production-candidate-workflow.test.ts` — **5 tests**: asserts the
  initial pin env has no `TOLERATE_MAIN_DRIFT` (line 133), every downstream
  post-pin verify carries `TOLERATE_MAIN_DRIFT: "1"` (lines 179, 201, 215,
  226), the provider CAS script contains the flag (line 473), and drift with
  `TOLERATE_MAIN_DRIFT=1` still fails closed on non-drift remote failures
  (lines 588–604).
- `tests/deploy-production-gate.test.ts` — **42 tests**: pins the full gate
  pipeline including the drift-tolerant `Reconfirm frozen main before
  provider mutation` step.

PR #630's own record reports the full suite plus typecheck green at merge
time.

## Why no new product PR was opened

The packet requires landing the item or reporting plainly why it cannot be
done. The item is already landed: the fix shipped in #556 and was completed
by #630, both merged into `origin/main` ahead of this lane, with behavior
test-pinned on the current tip. A new PR re-implementing it would duplicate
shipped work; the productive action is this evidence record so the backlog
item can be closed — matching the lane pattern used for prior already-resolved
items (e.g. `.lane/reports/0509-lane1-lp-noise-filter.md` for PR #640,
`.lane/reports/0509-lane1-magicbrief-migration-cta.md` for PR #711).

## Files

- `.lane/reports/0509-lane1-deploy-drift-evidence.md` — this evidence record
  (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, pipeline, data, or billing
change.
