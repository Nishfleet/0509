# Lane evidence — claim/issue-3127 (Nishfleet/0509#3127)

## Task

The /guides cluster had six how-to pages but no answer for the
highest-intent API-DIY-vs-monitoring query: what the official Meta Ad
Library API actually covers and where it stops. Ship an owned, cited
explainer at `/guides/meta-ad-library-api-limitations`.

## Approach

Followed the established guide pattern (MarketingNav/Footer,
publicSeoMeta + canonicalLinks, articleJsonLd + faqPageJsonLd +
webPageJsonLd, free /search preview CTA). Every Meta-API claim carries an
inline link to Meta's own docs (Ads Archive API reference, Ad Library API
page, Ad Library). Visible "Facts checked 12 September 2026" line. No
competitor names in the body. Complementary-approach section links to
/capture-rules and /no-phantom-changes.

## Changes

- `app/routes/guides.meta-ad-library-api-limitations.tsx` — the guide.
- `app/routes/$locale.guides.meta-ad-library-api-limitations.tsx` — locale
  re-export (canonical→EN, buyerSurfaceHreflangLinks).
- `app/routes.ts` — EN + locale route registrations.
- `app/routes/guides.tsx` — GUIDE_ENTRIES index card (seventh guide).
- `app/lib/seo.ts` — SITEMAP_PATHS entry.
- `app/lib/sitemap.server.ts` — locale sitemap derivation entry.
- `app/lib/public-markdown.ts` — LLMS_PAGE_DETAILS entry (llms.txt catalog).
- `app/lib/signup-source.ts` — `guide-api-limitations` marker + allowlist.
- `app/routes/docs.tsx`, `app/routes/competitor-monitoring.tsx` — internal
  links to the new guide.
- `tests/guides-routes.test.ts` — dedicated describe (content, citations,
  facts-checked date, SEO meta, JSON-LD parity, CTA marker, no uncited
  competitor claims) + sitemap-guide floor bumped to 7.
- `tests/sitemap.server.test.ts` — locale feed count 6→7.
- `tests/customer-claim-surface-registry.test.ts` — sitemapPaths catalog +
  dated trail line (fail-closed drift check).

## Test run

- `npx vitest run --configLoader runner --project node --changed
  origin/main` → 375 files / 4498 tests passed.

## Live verification (verify-0509 harness, 127.0.0.1:4179)

- `/api/health` → 200 `{"status":"ok","app":"0509"}`.
- `/guides/meta-ad-library-api-limitations` → 200; title, canonical→
  `https://0509.io/guides/meta-ad-library-api-limitations`, per-guide
  `og:image` `/social-card/guides/meta-ad-library-api-limitations.png`,
  Meta doc citation, facts-checked line, `ad_reached_countries`,
  `guide-api-limitations` CTA marker all present in served HTML.
- `/de/guides/meta-ad-library-api-limitations` → 200; canonical→EN,
  hreflang cluster (de/es/fr/ja/pt-br/x-default).
- `/sitemap.xml`, `/guides`, `/llms.txt` → each contains the slug.
- `/social-card/guides/meta-ad-library-api-limitations.png` → 200
  image/png, 33791 bytes.
- Evidence under /tmp/verify-0509-3127/ (server log, HTML, sitemap).
