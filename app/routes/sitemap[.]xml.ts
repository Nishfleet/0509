import type { Route } from "./+types/sitemap[.]xml";
import { SITEMAP_LASTMOD, SITEMAP_PATHS, sitemapXml } from "../lib/public-routes";
export function loader({ request }: Route.LoaderArgs) {
  return new Response(sitemapXml(new URL(request.url).origin, SITEMAP_PATHS, SITEMAP_LASTMOD), {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
