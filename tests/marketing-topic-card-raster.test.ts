import { describe, expect, it } from "vitest";

import {
  clusterSocialCardUrl,
  SITEMAP_PATHS,
  type MetaEntry,
} from "~/lib/seo";
import { parseSocialCardPathname } from "~/lib/social-cards.server";

/**
 * Sitemap-listed topical marketing pages (issue #2101). These are the
 * remaining cluster surfaces outside #2083 (/switch, /compare) and
 * #2089 (/ads/:domain, /timeline/:domain) — this slice stays broken even
 * after both land, so it gets its own regression guard.
 */
const TOPICAL_MARKETING_PATHS = [
  "/sneaker-resale",
  "/competitor-monitoring",
  "/de/sneaker-resale",
  "/ja/sneaker-resale",
  "/pt-br/sneaker-resale",
] as const;

/**
 * Every route meta built via `publicSeoMeta` derives `og:image:type` from the
 * card URL extension, so a regression that re-introduces an SVG card on any
 * sitemap-listed topical marketing page fails CI here (issue #2101, fleet-ops#366).
 */
describe("sitemap-listed topical marketing pages raster og:image (issue #2101)", () => {
  it("pins the topical marketing pages in the sitemap", () => {
    for (const pathname of TOPICAL_MARKETING_PATHS) {
      expect(SITEMAP_PATHS as readonly string[]).toContain(pathname);
    }
  });

  it("clusterSocialCardUrl builds .png card URLs, not .svg", () => {
    expect(clusterSocialCardUrl("sneaker-resale")).toBe(
      "https://0509.io/social-card/sneaker-resale.png",
    );
    expect(clusterSocialCardUrl("competitor-monitoring")).toBe(
      "https://0509.io/social-card/competitor-monitoring.png",
    );
  });

  it("parses both cluster .png and legacy cluster .svg as raster-cluster requests", () => {
    expect(parseSocialCardPathname("/social-card/sneaker-resale.png")).toMatchObject({
      kind: "cluster",
      slug: "sneaker-resale",
    });
    expect(parseSocialCardPathname("/social-card/competitor-monitoring.svg")).toMatchObject({
      kind: "cluster",
      slug: "competitor-monitoring",
    });
  });

  it("no sitemap-listed topical marketing page emits an image/svg+xml og:image:type", async () => {
    const routes = await Promise.all(
      TOPICAL_MARKETING_PATHS.map(async (pathname) => {
        const module = await import(
          pathname.endsWith("sneaker-resale") && pathname !== "/sneaker-resale"
            ? "~/routes/$locale.sneaker-resale"
            : pathname === "/sneaker-resale"
              ? "~/routes/sneaker-resale"
              : "~/routes/competitor-monitoring"
        ) as { meta: (args?: unknown) => readonly MetaEntry[] };
        return { pathname, meta: module.meta(buildMetaArgs(pathname)) };
      }),
    );

    for (const { pathname, meta } of routes) {
      const image = meta.find((entry) => entry.property === "og:image")
        ?.content;
      const type = meta.find((entry) => entry.property === "og:image:type")
        ?.content;
      expect(image, `${pathname} og:image`).toBeDefined();
      expect(type, `${pathname} og:image:type`).toBe("image/png");
      expect(type, `${pathname} og:image:type must not be svg`).not.toBe(
        "image/svg+xml",
      );
    }
  });
});

function buildMetaArgs(pathname: string): { loaderData?: { locale?: string } } {
  if (pathname.startsWith("/") && pathname.split("/").length > 2) {
    return { loaderData: { locale: pathname.split("/")[1] } };
  }
  return {};
}
