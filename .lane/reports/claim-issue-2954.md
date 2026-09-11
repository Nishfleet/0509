# Lane evidence: privacy scrub of public tree (issue 2954)

**Branch:** `claim/issue-2954`
**Item:** privacy: scrub personal emails and internal notes from the public repo

## Summary

- Personal emails (`nishant345@gmail.com`, `me@inish.in`) replaced with the role address `alerts@0509.io` in `wrangler.jsonc` (`LAUNCH_CANARY_EMAIL`), `tests/workspace-cleanup.test.ts` fixtures, and three docs.
- Agent memory/state/QA/audit notes removed from the tree (archived at `/home/nish/workspaces/agent-state/0509-scrub-2954/`): `MEMORY.md`, `agent-state/0509-transformation/discovery-panel-coverage.md`, `design-qa.md`, `design-qa-wave1.md`, top-level `docs/*audit*` files.
- Kept with documented exceptions in the guard: `docs/customer-claim-audit-table.json` and `docs/ga-customer-journey-audit.md` — live tests read them (`customer-claim-audit-table.test.ts`, `verify-customer-claim-audit.mjs`, `launch-docs.test.ts`); the issue's own check-first rule stops their removal.
- New guard `tests/docs-no-agent-artifacts.test.ts` fails CI if those paths are re-tracked (reads `git ls-files`, not the filesystem).

## Files changed

- Deleted: `MEMORY.md`, `agent-state/0509-transformation/discovery-panel-coverage.md`, `design-qa.md`, `design-qa-wave1.md`, `docs/INTENT-AUDIT-2026-07-21.md`, `docs/commercial-delight-complete-audit.md`, `docs/dashboard-v2-route-audit.md`, `docs/dashboard-v2-visual-audit.md`, `docs/digest-report-trust-audit.md`, `docs/market-desk-product-audit.md`, `docs/plan-entitlement-audit.md`, `docs/search-relevance-audit.md`
- Edited: `wrangler.jsonc` (canary email), `tests/workspace-cleanup.test.ts` (fixture emails), `docs/ga-incident-runbook.md`, `docs/ops-backup-uptime.md`, `docs/superpowers/artifacts/2026-04-19-commercial-ad-dogfood-set.md`
- Added: `tests/docs-no-agent-artifacts.test.ts`

## Verification

| Check | Result |
|-------|--------|
| targeted vitest (guard + dependents + email fixtures) | 5 files / 57 tests passed |
| `vitest --project node --changed origin/main` | 2 files / 31 tests passed |
| repo-wide email grep | scan complete, clean |
| `prove-one-run-check` | OK (net-negative diff) |
| `fleet-exec-review-canary` | OK |
| `fleet-no-agent-names-check` | OK |
| repo-wide `*audit*` guard scan | no live CI/workers reader of removed paths |

## Reviewer round (product-repo gate)

Seat: opencode/nemotron-3-ultra-free. Verdict PASS. Buckets:
- **Act on** — missing `.lane/reports/claim-issue-2954.md` evidence file → fixed in follow-up commit on this branch.
- **Consider** — tautological exception assertion in guard tightened; `.nishant345.workers.dev` identifier stays out of issue scope, documented in PR body.
- **Noted** — `LAUNCH_CANARY_EMAIL` now delivers to `alerts@0509.io`; Nish should confirm that inbox is watched.
- **Dismissed** — new `docs/*audit*` files failing the guard is the requested behavior.
