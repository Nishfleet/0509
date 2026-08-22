# Competitor monitoring category page (research-desk 2026-08-08, item: publish a proof-backed category landing page for "competitor monitoring software") — refreshed onto current main, verified green

**Status: delivered — PR #572 refreshed onto origin/main at `389c0e55`, mergeable (only `.lane/report.md` conflicted before; product files apply cleanly), full suite + typecheck + build green on this tip.**

Branch: `feat/cm-category-page-lane11` (this lane), pushed as the PR #572 head
`feat/competitor-monitoring-category-page`
Base: `origin/main` at `389c0e55`
Pull request: https://github.com/Nishfleet/0509/pull/572
Commit: `4e931eac` — `feat(seo): publish proof-backed /competitor-monitoring category page`

## Item

- [ ] Publish a proof-backed category landing page for "competitor monitoring
  software" (research-desk 2026-08-08).

## Outcome

The page work already existed as PR #572 (2026-08-09 lane, commit `7fe91563`),
already reviewed (CodeRabbit SUCCESS) and previously verified, but the PR had
again gone `CONFLICTING`/`DIRTY`: main advanced past the last merge base
(`1c4d8a3a`) and `.lane/report.md` accumulated other lanes' entries. This lane
rebuilt the six product files onto fresh origin/main `389c0e55` and refreshed
the PR head:

- `app/routes/competitor-monitoring.tsx` — the category landing page
  (unchanged from the reviewed `7fe91563` delivery).
- `tests/competitor-monitoring-category.test.ts` — 9 acceptance tests
  (unchanged).
- `app/routes.ts` — route registration (unchanged).
- `app/lib/seo.ts` — sitemap entry only. **Main's AI-crawler robots policy
  (#613, `c997407c`) is preserved this time**: only the
  `"/competitor-monitoring"` `SITEMAP_PATHS` hunk was applied, not the PR
  branch's older whole-file version.
- `docs/customer-claim-surface-registry.json` + `tests/customer-claim-surface-registry.test.ts`
  — G11 `SEO-CANONICAL-INDEXING` drift recorded; contract SHA re-pinned with a
  dated comment (claim stays `assessed_pending_reproof`, no proof fabricated).

The page satisfies the research-desk item: truthful title/description/canonical
(description under 160 chars), WebPage + FAQPage JSON-LD emitted from the same
array as the visible FAQ, internal links to /search, /docs and /#pricing,
every outside claim carrying its source URL and research-desk check date
(2026-08-08), explicit freshness limits, a labeled illustrative sample, no
hardcoded prices, no unsupported superiority claims, and no AI-tool framing.

## Verification (this lane, 2026-08-12)

- `tests/competitor-monitoring-category.test.ts` (9) + `tests/customer-claim-surface-registry.test.ts` (6): **15/15 pass**.
- Full Vitest on this tip: **428 files, 4901/4901 passed**.
- `npm run typecheck`: exit 0.
- `npm run build` (`scripts/build-production.mjs`): exit 0;
  `build/client/assets/competitor-monitoring-*.js` chunk present in the
  production bundle.
- `git diff --check`: clean on the applied changes.
- PR state after refresh: `mergeable` recomputed by GitHub on the pushed head
  (single squashed-style commit `4e931eac` on fresh main).

## Files

- `.lane/report.md` — this evidence record; no product code touched by the report.

---
