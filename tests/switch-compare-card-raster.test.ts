import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  compareSocialCardUrl,
  switchSocialCardUrl,
  SITEMAP_PATHS,
} from "~/lib/seo";
import { parseSocialCardPathname } from "~/lib/social-cards.server";

type MetaEntry = { property?: string; name?: string; content?: string; title?: string };

/**
 * /switch/:slug and /compare/:slug pages (issue #2083). These are the BET 8
 * switch/intent pages and the /compare alternative pages — the highest-intent
 * acquisition surfaces, shared via WhatsApp/Slack/X. Facebook/X/LinkedIn
 * scrapers refuse SVG og:images, so a regression that re-introduces an SVG
 * og card on any of them fails CI.
 */
const SWITCH_SLUGS = ["magicbrief", "panoramata", "visualping"] as const;
const COMPARE_SLUGS = [
  "panoramata",
  "magicbrief",
  "foreplay-spyder",
  "visualping-ad-libraries",
  "meta-ad-library",
  "spyland",
  "pulzifi",
  "adspyder",
  "foreplay",
  "visualping",
  "visualping-ad-library",
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

async function switchMeta(slug: (typeof SWITCH_SLUGS)[number]): Promise<readonly MetaEntry[]> {
  const routeModule = (await import(`~/routes/switch.${slug}`)) as {
    meta: () => readonly MetaEntry[];
  };
  return routeModule.meta();
}

async function compareMeta(slug: (typeof COMPARE_SLUGS)[number]): Promise<readonly MetaEntry[]> {
  const routeModule = (await import(`~/routes/compare.${slug}`)) as {
    meta: () => readonly MetaEntry[];
  };
  return routeModule.meta();
}

describe("/switch and /compare pages raster og:image (issue #2083)", () => {
  it("pins the switch and sitemap-listed compare pages in the sitemap", () => {
    for (const slug of SWITCH_SLUGS) {
      expect(SITEMAP_PATHS as readonly string[]).toContain(`/switch/${slug}`);
    }
    // The canonical losers (/compare/visualping, /compare/foreplay,
    // /compare/visualping-ad-library) are dropped from the sitemap (issue
    // #1481) but still serve a raster card via their canonical winner's meta.
    const sitemapCompareSlugs = COMPARE_SLUGS.filter(
      (slug) => !["visualping", "foreplay", "visualping-ad-library"].includes(slug),
    );
    for (const slug of sitemapCompareSlugs) {
      expect(SITEMAP_PATHS as readonly string[]).toContain(`/compare/${slug}`);
    }
  });

  it("switchSocialCardUrl and compareSocialCardUrl point at png, not svg", () => {
    for (const slug of SWITCH_SLUGS) {
      expect(switchSocialCardUrl(slug)).toBe(
        `https://0509.io/social-card/switch/${slug}.png`,
      );
    }
    for (const slug of COMPARE_SLUGS) {
      expect(compareSocialCardUrl(slug)).toBe(
        `https://0509.io/social-card/compare/${slug}.png`,
      );
    }
  });

  it("does not intercept the png paths as generated SVG cards", () => {
    for (const slug of SWITCH_SLUGS) {
      expect(parseSocialCardPathname(`/social-card/switch/${slug}.png`)).toBeNull();
    }
    for (const slug of COMPARE_SLUGS) {
      expect(parseSocialCardPathname(`/social-card/compare/${slug}.png`)).toBeNull();
    }
  });

  it("no /switch/:slug page emits an image/svg+xml og:image:type", async () => {
    for (const slug of SWITCH_SLUGS) {
      const meta = await switchMeta(slug);
      const image = requireOgImage(meta, `/switch/${slug}`);
      const type = ogImageType(meta);
      expect(type, `/switch/${slug} og:image:type`).not.toBe("image/svg+xml");
      expect(type, `/switch/${slug} og:image:type`).toBe("image/png");
      expect(image, `/switch/${slug} og:image`).toMatch(/\.png$/);
      expect(image, `/switch/${slug} og:image still points at svg`).not.toMatch(/\.svg(\?|$)/);
      assertPngFile(pngPathForCardUrl(image));
    }
  });

  it("no /compare/:slug page emits an image/svg+xml og:image:type", async () => {
    for (const slug of COMPARE_SLUGS) {
      const meta = await compareMeta(slug);
      const image = requireOgImage(meta, `/compare/${slug}`);
      const type = ogImageType(meta);
      expect(type, `/compare/${slug} og:image:type`).not.toBe("image/svg+xml");
      expect(type, `/compare/${slug} og:image:type`).toBe("image/png");
      expect(image, `/compare/${slug} og:image`).toMatch(/\.png$/);
      expect(image, `/compare/${slug} og:image still points at svg`).not.toMatch(/\.svg(\?|$)/);
      assertPngFile(pngPathForCardUrl(image));
    }
  });

  it("every committed switch/compare PNG twin exists and is a 1200x630 raster", () => {
    const expected = [
      ...SWITCH_SLUGS.map((slug) => `public/social-card/switch/${slug}.png`),
      ...COMPARE_SLUGS.map((slug) => `public/social-card/compare/${slug}.png`),
    ];
    for (const path of expected) {
      assertPngFile(path);
    }
  });
});
