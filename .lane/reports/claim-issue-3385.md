# Lane evidence — claim/issue-3385 (Nishfleet/0509#3385)

Unit: pi-issue-0509-3385 · manager mode (difficulty: heavy, fleet-ops#3274) · 2026-09-14

## What shipped
- `tests/sitemap.server.test.ts`: two-way /compare/* route↔sitemap parity, enumerated from `app/routes/**` (compare.<slug>.tsx + $locale.compare.<slug>.tsx — never a second hand list). #1481/#1548 losers (/compare/visualping, /compare/foreplay, /compare/visualping-ad-library) pinned as exemptions so a silent drop OR a silent re-add fails. #1878 hardcoded 9-path winners-list folded into the same derivation (9→15 loop iterations). /compare/sneakerping pinned in both directions. Strictly additive: +2 it(), +11 expect() (worker delta count; ~16 by the senior reviewer's source count), 0 removed, 0 skipped, no .skip/.only.
- `app/lib/seo.ts`: untouched — acceptance-4 contingency verified no-op (parity holds on head).

## Run proof
- Phase 1 (salvage 4b149bea0, rebased onto origin/main cff30e908, zero conflicts): `npx vitest run tests/sitemap.server.test.ts` = 90 passed / 0 failed / 0 skipped (03:35:36 IST, 3.91s).
- Phases 2+3 (b0c9ad623): worker run 92 passed / 0 failed / 0 skipped (03:41:50 IST, 6.95s); manager re-run 92/92, VITEST-EXIT=0 (03:44:56 IST, 3.68s).
- Issue verify leg 2 (informational): curl /compare/sneakerping = 200 at 03:41Z — the #3166 deploy gap described in the issue has closed; deploy-side, not this lane's work.

## Review
- ONE senior round (step 8 + the plan's phase-review amendment): litellm/senior via reviewer-3385 — 0 Critical / 0 Warnings / 2 Consider / 2 Noted / 3 Dismissed-with-reason. Full adjudication in `.fleet/plan-3385.md` (Manager ledger). No Act-on findings.

## Plan
- `.fleet/plan-3385.md` (ships in this PR) — phases 1–3 ticked; Manager ledger carries the run + review trail.
