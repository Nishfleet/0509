# Lane evidence — claim/issue-3421

Issue `Nishfleet/0509#3421`: eighth `/guides/*` page answering the buyer's
first question — "can my AI (ChatGPT/an agent) just check this?" — with the
three already-verified fact blocks, exiting to the free anonymous `/search`
preview.

## What shipped

- `app/routes/guides.can-chatgpt-monitor-competitor-ads.tsx` — the guide
  (381 lines). Three structural limits (403 to a plain HTTP client, one
  point in time, no 03:00 vigilance), the honest AI-strengths half, what
  only an always-on watch owns, FAQ + WebPage/Article/FAQPage JSON-LD,
  `#3098` og:image PNG auto-derived by `publicSeoMeta`, CTA =
  `/search?source=guide-can-chatgpt-monitor-ads`.
- `app/routes/guides.can-ChatGPT-monitor-competitor-ads.tsx` +
  `$locale.` twin — exact-slug re-export shims. The issue-specified
  uppercase slug stays registered verbatim in `app/routes.ts` and 301s to
  the lowercase canonical under #2955 (`workers/canonical-path.ts` 301s
  every uppercase public GET; `renderSitemapXml` lowercases every `<loc>` —
  a canonical pointing at a redirect is a broken SEO contract, so the
  lowercase path is the served canonical everywhere).
- Registry wiring: `routes.ts` (EN + `$locale`, both casings),
  `SITEMAP_PATHS`, `BUYER_SURFACE_GUIDE_PATHS`, `LLMS_PAGE_DETAILS`,
  `GUIDE_ENTRIES` hub card, inbound links from `/docs` and
  `/competitor-monitoring`, `GUIDE_CAN_CHATGPT_MONITOR_ADS_SIGNUP_SOURCE`
  allowlisted.
- Tests: `tests/guides-can-ChatGPT-monitor-competitor-ads.route.test.ts`
  (new, 177 lines, filename verbatim per the issue's termination command),
  `tests/guides-routes.test.ts` extended (render/canonical/registration/
  sitemap/JSON-LD/marker/inbound-link + the #3122 floor grown 7→8),
  `sitemap.server.test.ts` locale count 7→8, `social-cards.routes.test.ts`
  derives the expected slug through `canonicalPathFor`,
  `customer-claim-surface-registry.test.ts` sitemap catalog +1.

## Manager-mode history (multi-unit resume)

The unit died repeatedly to seat 401/402 outages (fleet-ops#2772 claim-cap
park, twice orchestrator-released). Work survived via salvage branches; the
final local state carried phases 1–3b plus a reviewer act-on commit. This
run: verified all boxes real, merged `origin/main` (db1dfa399), re-ran the
contract green, opened the PR.

## Runs

```
VITEST_MAX_WORKERS=2 npx vitest run tests/guides-routes.test.ts \
  tests/guides-can-ChatGPT-monitor-competitor-ads.route.test.ts
  Test Files 2 passed (2) / Tests 50 passed (50)

VITEST_MAX_WORKERS=2 npx vitest run tests/section-parents.test.ts \
  tests/guides-how-to-track.route.test.ts tests/canonical-path.test.ts \
  tests/sitemap.server.test.ts
  Test Files 4 passed (4) / Tests 117 passed (117)

VITEST_MAX_WORKERS=2 npx vitest run tests/customer-claim-surface-registry.test.ts \
  tests/social-cards.routes.test.ts tests/guides-how-to-monitor.route.test.ts
  Test Files 3 passed (3) / Tests 64 passed (64)

# post-merge re-run:
VITEST_MAX_WORKERS=2 npx vitest run tests/guides-routes.test.ts \
  tests/guides-can-ChatGPT-monitor-competitor-ads.route.test.ts \
  tests/section-parents.test.ts tests/canonical-path.test.ts \
  tests/sitemap.server.test.ts
  Test Files 5 passed (5) / Tests 162 passed (162)
```

## Lane discipline / dedupe

- #3166 owns the deploy/404 pipe this rides — not touched.
- #3304/#3353 own AI-visibility measurement — this ships the content they
  measure; nothing absorbed.
- #3326 owns edge-serve — untouched. No migrations, no D1, no gate-owned
  paths (0 matches across the 9 protected verifier/deploy files).
- Rollback: single-PR revert — route files + test + registry/sitemap lines,
  no data.
