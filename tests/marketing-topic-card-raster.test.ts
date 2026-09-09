import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  clusterSocialCardUrl,
  SITEMAP_PATHS,
} from "~/lib/seo";
import { parseSocialCardPathname } from "~/lib/social-cards.server";

type MetaEntry = { property?: string; name?: string; content?: string; title?: string };

/**
 * Sitemap-listed topical marketing pages (issue #2101). These are the
 * remaining cluster surfaces outside #2083 (/switch, /compare) and #2089
 * (/ads, /timeline). A regression that re-introduces an SVG og card on
 * any of them fails CI.
 */
const TOPICAL_MARKETING_PATHS = [
  "/sneaker-resale",
  "/competitor-monitoring",
  "/de/sneaker-resale",
  "/ja/sneaker-resale",
  "/pt-br/sneaker-resale",
] as const;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function ogImage(entries: readonly MetaEntry[]): string | undefined {
  return entries.find((entry) => entry.property === "og:image")?.content;
}

function ogImageType(entries: readonly MetaEntry[]): string | undefined {
  return entries.find((entry) => entry.property === "og:image:type")?.content;
}

function pngPathForCardUrl(url: string): string {
  const parsed = new URL(url);
  expect(parsed.pathname.startsWith("/social-card/")).toBe(true);
  expect(parsed.pathname.endsWith(".png")).toBe(true);
  return `public${parsed.pathname}`;
}

function requireOgImage(entries: readonly MetaEntry[], pathname: string): string {
  const image = ogImage(entries);
  if (typeof image !== "string" || image.length === 0) {
    throw new Error(`${pathname} missing og:image`);
  }
  return image;
}

function assertPngFile(path: string) {
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 8).equals(PNG_MAGIC), `${path} is not a PNG`).toBe(true);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  expect(width, `${path} width`).toBe(1200);
  expect(height, `${path} height`).toBe(630);
}

async function topicalMeta(pathname: (typeof TOPICAL_MARKETING_PATHS)[number]): Promise<readonly MetaEntry[]> {
  if (pathname === "/sneaker-resale") {
    const routeModule = (await import("~/routes/sneaker-resale")) as {
      meta: () => readonly MetaEntry[];
    };
    return routeModule.meta();
  }
  if (pathname === "/competitor-monitoring") {
    const routeModule = (await import("~/routes/competitor-monitoring")) as {
      meta: () => readonly MetaEntry[];
    };
    return routeModule.meta();
  }
  const localeByPath = {
    "/de/sneaker-resale": "de",
    "/ja/sneaker-resale": "ja",
    "/pt-br/sneaker-resale": "pt-br",
  } as const;
  const locale = localeByPath[pathname];
  const routeModule = (await import("~/routes/$locale.sneaker-resale")) as {
    meta: (args: { loaderData: { locale: string } }) => readonly MetaEntry[];
  };
  return routeModule.meta({ loaderData: { locale } });
}

describe("sitemap-listed topical marketing pages raster og:image (issue #2101)", () => {
  it("pins the topical cluster pages in the sitemap", () => {
    for (const pathname of TOPICAL_MARKETING_PATHS) {
      expect(SITEMAP_PATHS as readonly string[]).toContain(pathname);
    }
  });

  it("clusterSocialCardUrl points at png, not svg", () => {
    expect(clusterSocialCardUrl("sneaker-resale")).toBe(
      "https://0509.io/social-card/sneaker-resale.png",
    );
    expect(clusterSocialCardUrl("competitor-monitoring")).toBe(
      "https://0509.io/social-card/competitor-monitoring.png",
    );
  });

  it("does not intercept the png path as a generated SVG card", () => {
    expect(parseSocialCardPathname("/social-card/sneaker-resale.png")).toBeNull();
    expect(parseSocialCardPathname("/social-card/competitor-monitoring.png")).toBeNull();
  });

  it("no sitemap-listed topical marketing page emits an image/svg+xml og:image:type", async () => {
    for (const pathname of TOPICAL_MARKETING_PATHS) {
      const meta = await topicalMeta(pathname);
      const image = requireOgImage(meta, pathname);
      const type = ogImageType(meta);
      expect(type, `${pathname} og:image:type`).not.toBe("image/svg+xml");
      expect(type, `${pathname} og:image:type`).toBe("image/png");
      expect(image, `${pathname} og:image`).toMatch(/\.png$/);
      expect(image, `${pathname} og:image still points at svg`).not.toMatch(/\.svg(\?|$)/);
      assertPngFile(pngPathForCardUrl(image));
    }
  });
});
