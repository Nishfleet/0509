import { renderRobots } from "../lib/public-routes";

/**
 * `/robots.txt` (0509#3989) — the crawler policy, derived from the same route
 * manifest as `/sitemap.xml` (`docs/engines/api-mcp.md` §4).
 *
 * `renderRobots` owns the text and is tested directly; this file is the edge.
 * The policy is `Allow: /` plus an explicit `Disallow` for every non-public
 * prefix, then `Sitemap:`. It deliberately does NOT carry a global
 * `Disallow: /`: the landing's indexing is controlled by the page-level
 * `robots: noindex` meta (`public/index.html`, until the rebuild gate lifts),
 * and a global disallow would block the fetch that reads that meta — a noindex
 * that cannot be read is indistinguishable from one that was obeyed.
 */
export function loader() {
  return new Response(renderRobots(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
