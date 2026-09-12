import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockReactRouter } from "./helpers/mock-react-router";
import { clusterSocialCardUrl, SITEMAP_PATHS } from "~/lib/seo";
import { parseSocialCardPathname } from "~/lib/social-cards.server";

type MetaEntry = Record<string, string>;

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

beforeEach(() => {
  vi.resetModules();
  mockReactRouter();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

/**
 * Route `meta` functions take MetaArgs (`{ loaderData, params, location,
 * matches, ... }`); every in-tree caller passes a stub cast `as never`
 * (see tests/sneaker-resale.route.test.ts). The locale route reads
 * `loaderData.locale`; the standalone routes ignore args.
 */
async function topicalMeta(
  pathname: (typeof TOPICAL_MARKETING_PATHS)[number],
): Promise<readonly MetaEntry[]> {
  if (pathname === "/sneaker-resale" || pathname === "/competitor-monitoring") {
    const routeModule = await import(`~/routes/${pathname.slice(1)}`);
    return routeModule.meta({} as never) as readonly MetaEntry[];
  }
  const locale = pathname.split("/")[1];
  const routeModule = await import("~/routes/$locale.sneaker-resale");
  return routeModule.meta({
    loaderData: { locale },
    params: { locale },
    location: { pathname },
  } as never) as readonly MetaEntry[];
}

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
    for (const pathname of TOPICAL_MARKETING_PATHS) {
      const meta = await topicalMeta(pathname);
      const image = meta.find((entry) => entry.property === "og:image")?.content;
      const type = meta.find((entry) => entry.property === "og:image:type")?.content;
      expect(image, `${pathname} missing og:image`).toBeDefined();
      expect(image, `${pathname} og:image`).toMatch(/\.png$/);
      expect(type, `${pathname} og:image:type`).toBe("image/png");
      expect(type, `${pathname} og:image:type must not be svg`).not.toBe(
        "image/svg+xml",
      );
    }
  });
});
