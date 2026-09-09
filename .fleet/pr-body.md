## Summary

Publishes `/llms-full.txt`, a public full-text AI grounding corpus of dated offer/proof records per tracked brand (issue #2043). Generated read-only from the same D1 `landing_page_snapshot` evidence the `/timeline/:domain` surface reads — same proof gates (screenshot + page-text artifacts), same per-domain window, same bounded read envelope. No new tables, no migrations, no filesystem writes; revert is a pure code revert.

## Honesty gate (north star, BET 10)

- A brand section appears only when at least one stored capture survives the same proof gate the `/timeline/:domain` loader applies (`snapshotRowHasCompleteProof`). Nothing is synthesized; an offer state that was never captured is never written.
- Every "As of" date is the UTC date of the stored capture, and every state links its stored screenshot + page-text evidence.
- Stale proof is labeled with the site's existing freshness vocabulary (`formatBrandPageCheckedAgo`) plus an explicit `STALE` marker beyond the 7-day `BRAND_PAGE_FRESH_FOR_INDEXING_MS` indexability window.
- A fresh D1 without the snapshot table degrades to an honest empty feed, never a 500.

## Discovery wiring

- `llms.txt` references `llms-full.txt` (a Pages-section entry via `LLMS_PAGE_DETAILS`, driven by the same `SITEMAP_PATHS` constant).
- `sitemap.xml` lists `/llms-full.txt` (a `SITEMAP_PATHS` entry, `changefreq=daily`, `priority=0.4`).
- `robots.txt` carries explicit discovery wiring (the wildcard group already allows it).

## Regression test (fleet-ops#366)

- `tests/integration/llms-full-feed.integration.test.ts` applies the real migrations, seeds real snapshot rows, and asserts >=1 tracked brand carries >=1 dated offer state with an evidence link — a future regression that empties the feed fails loudly. It also asserts the discovery wiring (sitemap, llms.txt, robots.txt name the feed).
- `tests/llms-full.server.test.ts` covers the pure honesty-gate renderer: no fabricated states, no unevidenced states, honest empty corpus, stale labeling.

## Verification

Ran the full suite on the rebased branch (`origin/main..HEAD`):

- `npx vitest run --project node` → 632 files / 7501 tests passed (exit 0)
- `npx vitest run --project workers` → 42 files / 206 tests passed (exit 0)
- `npm run typecheck` → exit 0
- `bin/fleet-no-agent-names-check --commit-range origin/main..HEAD` → OK, no agent attribution

run-proof: unit + integration suites green (632 node files / 7501 tests; 42 workers files / 206 tests) covering the new feed route, the honesty-gate renderer, and the discovery wiring; typecheck exit 0.

net-positive-because: adds the requested public full-text AEO feed (route + honesty-gate renderer + discovery wiring) and its regression tests; the only deletions are 2 lines in the offer-timeline proof-gate comment export.

Closes #2043