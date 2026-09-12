# Lane evidence — claim/issue-3093 (Nishfleet/0509 #3093)

Unit: pi-issue-0509-3093. Branch: claim/issue-3093.

## What shipped

Three new `/guides/*` how-to pages, one per uncovered differentiator query:

- `/guides/how-to-get-alerted-when-a-competitor-changes-their-offer` — the
  alert-as-deliverable intent (email that names the field that moved).
- `/guides/how-to-prove-what-changed-on-a-competitor-website` — the
  evidence intent (dated before/after with source links; Wayback + own record
  as the free route).
- `/guides/how-to-turn-a-one-off-competitor-check-into-a-standing-watch` —
  the cadence intent (baseline + schedule + diff + record).

Each follows the shipped guide pattern (#2152/#2867/#2888): honest manual +
DIY/monitor routes, break points, free-first-check positioning with the
corrected plan truth (Free = one first check + one first brief; recurring
checks paid), FAQ JSON-LD + Article + WebPage, /search preview CTA with a
distinct allowlisted `source=` marker, cross-links to sibling guides +
/capture-rules + /no-phantom-changes (+/compare/visualping-ad-libraries where
the page-monitor class is discussed).

## Registration surface (all updated)

- `app/routes.ts` — EN + `$locale` route entries (the guides serve 200 under
  every buyer-surface locale prefix, matching their locale-sitemap entries).
- `app/lib/seo.ts` — `SITEMAP_PATHS` (root sitemap).
- `app/lib/sitemap.server.ts` — locale-feed guides cluster.
- `app/lib/public-markdown.ts` — llms.txt title/description entries
  (`_llmsDetailsCoverSitemap` compile-time coverage).
- `app/lib/signup-source.ts` — three marker constants in
  `ALLOWED_SIGNUP_SOURCES` (hyphen slugs, inside the open slug shape — no
  migration literal needed).
- `app/routes/guides.tsx` — hub entries + meta description.
- `app/routes/docs.tsx`, `app/routes/competitor-monitoring.tsx` — internal
  links.
- `tests/guides-routes.test.ts` — table-driven describe over the trio:
  copy assertions, canonical/meta, route+sitemap registration, FAQPage +
  Article JSON-LD, signup-source allowlist, internal links.
- `tests/sitemap.server.test.ts` — locale derived count 3→6 and the
  derived-paths list.
- `tests/customer-claim-surface-registry.test.ts` — `sitemapPaths` expected
  catalog (claims flow through the SEO-CANONICAL-INDEXING claim's sources —
  same convention as #2888; the JSON itself needs no new rows).

## Proof

- `npx vitest run --configLoader runner --project node --changed origin/main`
  → 369 test files passed, 4435 tests, 0 failures (2026-09-12, ~200s).
- No `migrations/**` or `tests/integration/**` changes → workers project not
  run locally; CI owns coverage + typecheck.

## Non-goals

- No claim text invented beyond the live plan facts the pages restate.
- Wayback Machine named as a method (a public archive, not a competitor
  tool); Visualping cited only via its own published 83% figure (same source
  the #2888 guide links).
