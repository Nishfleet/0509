import type { Route } from "./+types/sitemap[.]xml";
import { PUBLIC_PATHS, sitemapXml } from "../lib/public-routes";
import { listPublishedCardSlugs } from "../lib/card/serve.server";

export async function loader({ request }: Route.LoaderArgs) {
  const paths = [
    ...PUBLIC_PATHS,
    ...(await listPublishedCardSlugs()).map((slug) => `/s/${slug}`),
  ];
  return new Response(sitemapXml(new URL(request.url).origin, paths), {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
