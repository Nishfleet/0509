fix(presence): validate `trackingMode` before insert — 400 form error instead of D1 CHECK 500

Closes #2472

## What changed
- `app/routes/app.presence.tsx`: the `create-entity` action now validates the raw `trackingMode` form field before dispatch. Anything other than `competitor`/`self` returns `data({ ok: false, intent, formError: "Choose a valid tracking mode.", message: "Choose a valid tracking mode." }, { status: 400 })` — the entity is never created, so the `CHECK (tracking_mode IN ('self','competitor'))` constraint in the presence migration (0055/0057 — verified by grepping for `tracking_mode IN`, migrations untouched) can no longer be hit by crafted input. `message` is included so the existing FeedbackStrip renders the error; `formError` carries the field-level error named in the finding.

## Test file (per judge edit)
- repro test added to `tests/presence-routes.test.ts` (created; the judge-edited files line), which is reachable by the judge-edited termination command.

## Verification (RED → GREEN, real runs)
- RED before fix: `npx vitest run tests/presence-routes.test.ts` → 1 failed (`rejects an unknown trackingMode with a 400 form error instead of a D1 constraint 500`: action proceeded to insert and returned a redirect, no 400). Shown pre-fix commit state in the worktree; the failure trace hit `app.presence.tsx:161` (`entity.id` after insert).
- GREEN after fix: `npx vitest run tests/presence-routes.test.ts` → 2 passed (2).
- Siblings: `npx vitest run tests/presence-routes.test.ts tests/presence.route.test.ts tests/presence-tracking.test.ts` → 3 files, 44 tests passed.

## Same-pattern sweep (step 3)
- `rg 'as PresenceTrackingMode|form.get("trackingMode")'` across `app/routes/**` and `app/lib/**`: the only raw form-field cast was in `app.presence.tsx`. Every other `trackingMode` use reads it from a D1 row (`row.tracking_mode as PresenceTrackingMode`, trusted DB read) or passes an already-validated value. No other instances to fix.

## run-proof
- run-proof: tests/presence-routes.test.ts + tests/presence.route.test.ts + tests/presence-tracking.test.ts green (44/44) on worktree `/home/nish/workspaces/agent-worktrees/issue-0509-2472`, commit 5f1631a8.

## Test plan
- `npx vitest run tests/presence-routes.test.ts` (2 passed)
- `npx vitest run tests/presence-routes.test.ts tests/presence.route.test.ts tests/presence-tracking.test.ts` (44 passed)
- `npx vitest run tests/presence-language.test.ts` (5 passed after hash refresh)
- `npm run typecheck`: all touched files clean. One PRE-EXISTING error remains in `scripts/verify-post-deploy-release.mjs(788)` — that file is untouched by this diff (present on main at cda450dc; the error was surfaced after installing the repo's own declared deps `@resvg/resvg-wasm` and `axe-core` into a stale worktree node_modules). Not a regression from this PR.

## BL-034 byte-freeze hash update
- `tests/presence-language.test.ts` byte-freezes the action body of `app.presence.tsx`. The fix legitimately edits the action, so the frozen sha256 was refreshed to `f4839646a548f1b8dca3514476be3dabfa087b63e4347077eb26d37e1b13e3d4` in commit 2 (with a `test-removal-justified` trailer: no assertions removed). First CI run on this PR failed exactly there (shard-4, presence-language.test.ts:42); this commit is the fix.

## scope
- files changed: `app/routes/app.presence.tsx`, `tests/presence-routes.test.ts` (new), `tests/presence-language.test.ts` (one hash line). No migrations, no gate-owned paths, no test removals.

net-positive-because: the whole unit is a defect fix that is mostly test — 11 lines in the route (guard + error copy) and a new 74-line RED→GREEN repro test file required by the issue's do-list step 1.

loose-ends: pre-existing typecheck error in scripts/verify-post-deploy-release.mjs is not addressed here (out of scope per must-not).
