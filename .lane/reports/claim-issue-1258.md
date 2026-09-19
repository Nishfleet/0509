# Lane evidence — claim/issue-1258

Issue: Nishfleet/0509#1258 — research-delta: curated brand→peer-category map as the primary auto-discovery signal (difficulty: senior-review).

## What shipped

- `migrations/0105_competitor_graph.sql` — `competitor_graph` table (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at), PK `(brand_id, peer_brand_id)`, CHECKs on self-edge and `confidence BETWEEN 0 AND 100`, covering index `(brand_id, category_id)` + peer index. Expand-only phase 1; generated `INSERT OR IGNORE` seed.
- `app/data/competitor-graph-curated.json` — 1024 curated edges / 99 brands / 50 categories, `source=curated:v1`; allbirds→atoms/vessi/cariuma at confidence 95.
- `scripts/generate-competitor-graph-seed.mjs` — JSON→seed renderer; validates domains/categories/confidence/self-edges and fails loudly on a duplicate `(brand_id, peer_brand_id)` pair (the PK), which `INSERT OR IGNORE` would otherwise swallow.
- `app/lib/competitor-graph.server.ts` — `brandToPeers` symmetric read, slug/domain/URL normalize, max-confidence dedupe, `[]`+warn degrade; `resolveCompetitorGraphBrand`, `listCompetitorGraphCategories`, `listCompetitorGraphBrands`, `competitorGraphCategoryLabel`.
- `/search?related=1` — curated peer chips + category badge under results; `related` absent → `relatedPeers: null`, existing paths byte-identical.
- `/app/competitors` — authenticated browse surface (lookup, category roll-up, per-category brands), registered in `routes.ts` + customer nav catalog.

## Evidence

- `node scripts/generate-competitor-graph-seed.mjs` → `1024 edges across 99 brands (unchanged)` — idempotent.
- `npx vitest run tests/competitor-graph.test.ts` → 7/7 pass (real migration on node:sqlite).
- `npx vitest run --project workers tests/integration/competitor-graph.integration.test.ts` → 2/2 pass on real workerd D1 (READ seed + WRITE/read-back through the real binding).
- `npx vitest run --configLoader runner --project node --changed origin/main` → 564/564 pass (51 files).
- `semgrep --config p/default --baseline-commit $(git merge-base HEAD origin/main)` → 0 findings.
- Fixture-server drive (`npm run e2e:serve:local`): `/api/health` 200, deep `"d1":"ok"`; `/search?website=nykaa.com&related=1` renders "Curated peers of nykaa.com:" with 17 badged peer chips; same URL without `related` renders none; invalid/unmapped inputs keep the alert / honest empty line; anonymous `/app/competitors` → 302 `/auth/login?redirectTo=%2Fapp%2Fcompetitors`.

## Review

- Senior reviewer round (`senior` LiteLLM group, pareto glm-5.3-flash): clean, non-blocking, all 5 acceptance items MET. Act-on items applied (confidence CHECK; PK-keyed duplicate guard). Consider items deferred to follow-up issue (`related=1` through load-more params; "N edges" wording).
- History: re-ship of closed PR #3672 (claim branch was deleted on the remote pre-review, auto-closing it); rebased onto `main` @ `4216efa9`.
