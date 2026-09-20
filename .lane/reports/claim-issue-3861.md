# Lane report — claim/issue-3861 (REBUILD P2 C2 marketing sweep)

Issue: Nishfleet/0509#3861. Unit: devin-issue@0509-3861. Second run (strike 2).

## What happened

- Strike 1's route sweep commit `589130e85` survived on `salvage/issue-3861`; the
  claim branch had been deleted on timeout (fleet-ops#6292). Started from salvage
  per the RESUME note, pushed `claim/issue-3861` + `wip/issue-3861` in the first
  minutes.
- Slice 2 (this run): deleted the tests, e2e specs and fixtures covering the
  swept surfaces — 175 files across two commits.
  - Dead imports: every test file importing a deleted route/lib/component
    (`~/routes/$locale.*`, `compare.*`, `switch.*`, `guides.*`, `timeline.*`,
    `share.*`, `proof`, `ops`, `api.e2e.*`, `api.launch-readiness`,
    `api.release-soak`, `api.demo-proof`, `~/lib/e2e-*`, `report-pdf`,
    `meta-ads-readiness`, `canary-detail`, `sneaker-resale-*`, deleted
    components).
  - Swept-surface coverage without dead imports: sneaker-resale lib tests,
    sitemap-timeline/offer-timeline tests, proof pipeline tests
    (`capture-validity*`, `proof-*`, `public-proof-*`, `external-proof`),
    share/pdf variants, launch-readiness/release-soak/commercial-launch-gate,
    ops/workspace-ops, demo-proof/demo-brand, e2e harness unit tests, locale
    surface tests, seo/* for locale/compare/sitemap-timeline, fs-readers of
    deleted route files (app-rebuild, public-aux-rebuild, marketing-nav,
    customer-claim-audit-table, plan-feature-enforcement-matrix,
    capture-rules-page, global-first-examples,
    signup-source-acquisition-families, funnel-seo, console-hygiene,
    siterep-widget, sitemap.server.test, seo.test, public-markdown.test,
    weekly-public-moves.test, llms-full.server.test).
  - e2e: `journey-1..6-release` (drive deleted `/api/e2e/*` replay endpoints),
    `bl037`/`bl038` (`/api/e2e/j4/replay`), `watchlist-run-history`
    (`/api/e2e/j3/replay`), `prod-public` (asserts swept `/brands` redirect on
    prod), `visual-defect-audit` (audits `/compare/*` prod pages).
  - Fixtures: `sneaker-resale-indexable-domains.snapshot.json`,
    `offer-moves.json` (orphan — zero consumers), `e2e-r2-page-text.html`,
    `e2e-r2-screenshot.png` (orphan — zero consumers).
- Deliberately left for C3 (#3862): tests covering surviving workspace/engine
  surfaces that read dropped tables (watchlist/collections/digest/archive/
  report/agent-action suites), `e2e/helpers/release-*.ts` (still used by
  surviving specs), `e2e/surface-audit.*` + `contrast-audit.mjs` (audit `app.*`
  surfaces), `e2e-local.sql` (used by surviving specs).
- Orphan audit after deletion: zero `app/lib` modules became unreferenced
  (`mention-digest.server.ts` is unreferenced but explicitly keep-listed). No
  `app/components` became unreferenced — the 5 unreferenced components
  (`account-branding-section`, `plan-limit-state`, `permission-state`,
  `evidence-plate`, `evidence/index`) were already orphan on `origin/main`
  before the sweep; they belong to C3's component sweep.

## Verification

- `grep` for any import/fs-read of a deleted route, lib or component across
  `app/`, `workers/`, `tests/`, `e2e/`: zero hits.
- `npx vitest run --project node --changed origin/main`: 2 files, 14 tests, green.
- Spot-run of 18 surviving-surface tests that reference swept URL strings
  (`competitor-monitoring-category`, `ads-brand-page.*`, `canonical-path`,
  `search.route`, `marketing-rebuild`, `funnel-*`, `worker-*`, etc.): 18 files,
  325 tests, green.
- Typecheck: not run locally (worker memory budget; CI's codex-node-checks owns
  it). Dead-import sweep means no dangling `~/routes/*` / `~/lib/*` references
  remain.

## Not done / follow-ups

- Tests of surviving surfaces that read the 97 C4-dropped tables remain — C3
  (#3862) owns that bucket explicitly.
- `sitemap.server.ts` / `llms-full.server.ts` still emit swept-route URLs
  (`/timeline/:domain`, `/compare/*`); still referenced by `workers/app.ts`, so
  kept by the unreferenced-module rule. C3/C4 delete or rewire them.
- Marketing nav/footer still link swept paths; the surviving marketing pages are
  replaced by the C4 skeleton — left as-is per deletions-only scope.
