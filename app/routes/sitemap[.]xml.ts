import { renderSitemap, sitemapEntries } from "../lib/public-routes";

export function loader() {
  return new Response(renderSitemap(sitemapEntries()), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
