import { renderSitemap, sitemapEntries } from "../lib/public-routes";

/**
 * `/sitemap.xml` (0509#3989) — the search-engine index of public pages, derived
 * from the route manifest in `app/lib/public-routes.ts`.
 *
 * A resource route, not an app page: it returns XML with no React render and no
 * root layout, so the document is the whole contract. `renderSitemap` owns the
 * shape and is tested directly in `tests/public-routes.test.ts`; this file is
 * the edge that serves it.
 *
 * Derived, never hand-maintained: add a row to `PUBLIC_SURFACES` and this
 * document changes with it. When the standing card (`/s/<slug>`, engine P9.1,
 * #3898) lands the enumerable slugs, they arrive as the second argument.
 */
export function loader() {
  return new Response(renderSitemap(sitemapEntries()), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Minutes, not hours: the index flips the day the landing gate lifts and
      // a stale cache would advertise a page set that already changed.
      "Cache-Control": "public, max-age=300",
    },
  });
}
