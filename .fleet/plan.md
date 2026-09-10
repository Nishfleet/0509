# Plan — issue 2218 (sources seam)

Manager mode (heavy/keystone). Base: salvaged worktree `issue-0509-2218-fresh` on
origin/main (30cdf07e) with uncommitted seam work. The salvaged work covers most
of the issue; the binding "Judge edits, batch 2" gaps remain.

## Phase 1 — Assess salvaged work, verify it builds/tests green
- [x] Verify salvaged work compiles and the seam tests pass (registry, budget, presence coverage, claim surface)
- [x] Confirm the six stub adapters + six stub sections exist at the exact ownership-map paths
- [x] Confirm migration 0088 is the next number and the integration test references it correctly

## Phase 2 — Close binding judge-edit gaps (types, runSources, action, renderer)
- [x] Add `competitorUpdate` return channel to `SourceFetchResult`; `runSources` persists it to the seam's competitor columns
- [x] Add generic source action on the competitor route (`sourceId`, field, value → writes seam columns) for #2199's manual Job board URL
- [x] SourceSections renders one locked line per plan-disabled source from `getPlanEntitlements(plan).sources`; pass `plan` from competitor-detail
- [x] Document the files line: competitor page route file, per-competitor check file, Meta helper file

## Phase 3 — Tests for the new judge-edit behavior
- [x] Test `competitorUpdate` persistence in runSources (fake adapter)
- [x] Test the generic source action endpoint
- [x] Test locked-source renderer in SourceSections
- [x] Fix migration number references (0087 → 0088) in the integration test

## Phase 4 — Full verification (termination criteria)
- [x] `npx vitest run tests/sources/registry.test.ts tests/decodo-budget*.test.ts` green
- [x] `npm run typecheck` green
- [x] Migration applies on a fresh D1 in CI (integration test green)

## Phase 5 — Review each phase (reviewer), land findings
- [x] Reviewer on the full diff vs origin/main; land every finding in a bucket
- [x] Fix Act-on findings

## Phase 6 — Open PR, arm auto-merge
- [x] PR body with Verification / run-proof / research / help-first / Closes #2218
- [x] Arm auto-merge
