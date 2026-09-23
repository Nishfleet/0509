import { env } from "cloudflare:workers";
import { renderSitemap, sitemapEntries } from "../lib/public-routes";

export function loader() {
  return new Response(renderSitemap(sitemapEntries(env.BETTER_AUTH_URL)), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
