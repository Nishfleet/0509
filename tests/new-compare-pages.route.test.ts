import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockReactRouter } from "./helpers/mock-react-router";

const NEW_COMPARE_PAGES = [
  {
    slug: "panoramata",
    title: "Five to Nine vs Panoramata",
    pricing: ["€99", "€379"],
    competitor: "Panoramata",
    claims: [],
  },
  {
    slug: "foreplay-spyder",
    title: "Five to Nine vs Foreplay Spyder",
    pricing: ["$59", "$459"],
    competitor: "Foreplay Spyder",
    claims: [],
  },
  {
    slug: "adspyder",
    title: "Five to Nine vs AdSpyder",
    pricing: ["$10", "$99"],
    competitor: "AdSpyder",
    claims: [],
  },
  {
    slug: "adspy",
    title: "Five to Nine vs AdSpy",
    pricing: ["$149"],
    competitor: "AdSpy",
    claims: ["2.4", "self-service cancel"],
  },
  {
    slug: "visualping-ad-libraries",
    title: "Five to Nine vs Visualping for ad libraries",
    pricing: ["free", "$350"],
    competitor: "Visualping",
    claims: [],
  },
  {
    slug: "keeptabz",
    title: "Five to Nine vs KeepTabz",
    pricing: ["$49.99", "$99.99"],
    competitor: "KeepTabz",
    claims: [],
  },
  {
    // Issue #2866: the issue's "free tier / free-plan MCP" wording was not
    // verifiable on gethookd.ai (2026-09-11: 7-day free trial, API & MCP with
    // annual plans), so the page states only the observed facts — no pricing.
    slug: "gethookd",
    title: "Five to Nine vs GetHookd",
    pricing: [],
    competitor: "GetHookd",
    claims: ["7-day free trial", "API", "MCP"],
  },
] as const;

beforeEach(() => {
  vi.resetModules();
  mockReactRouter();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadCompareModule(slug: string) {
  switch (slug) {
    case "panoramata":
      return import("~/routes/compare.panoramata");
    case "foreplay-spyder":
      return import("~/routes/compare.foreplay-spyder");
    case "adspyder":
      return import("~/routes/compare.adspyder");
    case "adspy":
      return import("~/routes/compare.adspy");
    case "visualping-ad-libraries":
      return import("~/routes/compare.visualping-ad-libraries");
    case "keeptabz":
      return import("~/routes/compare.keeptabz");
    case "gethookd":
      return import("~/routes/compare.gethookd");
    default:
      throw new Error(`unknown compare slug: ${slug}`);
  }
}

describe("new compare pages (issue 1107)", () => {
  it.each(NEW_COMPARE_PAGES)(
    "$slug is registered, returns comparison markup, has one plain h1, and emits JSON-LD",
    async ({ slug, title, pricing, competitor, claims }) => {
      const routes = readFileSync("app/routes.ts", "utf8");
      expect(routes).toContain(`route("compare/${slug}", "routes/compare.${slug}.tsx")`);

      const mod = await loadCompareModule(slug);
      const markup = renderToStaticMarkup(createElement(mod.default));

      expect(markup).toContain("<h1");
      const h1Matches = [...markup.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)];
      expect(h1Matches).toHaveLength(1);
      expect(h1Matches[0][1]).not.toMatch(/<[^>]+>/);
      expect(h1Matches[0][1].trim().length).toBeGreaterThan(0);

      expect(markup).toContain(competitor);
      for (const fragment of pricing) {
        expect(markup).toContain(fragment);
      }
      for (const claim of claims ?? []) {
        expect(markup).toContain(claim);
      }

      const ldBlocks = [...markup.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      expect(ldBlocks.length).toBeGreaterThanOrEqual(1);
      const parsed = ldBlocks.map((match) => JSON.parse(match[1]));
      expect(parsed.some((data) => data["@type"] === "WebPage")).toBe(true);
      const faqBlocks = parsed.filter((data) => data["@type"] === "FAQPage");
      expect(faqBlocks).toHaveLength(1);
      expect(faqBlocks[0].mainEntity).toHaveLength(mod.faqEntries.length);

      expect(mod.links()).toEqual([{ rel: "canonical", href: `https://0509.io/compare/${slug}` }]);
      const tags = (mod.meta({} as never) ?? []) as Array<Record<string, string>>;
      expect(tags.find((tag) => "title" in tag)?.title).toBe(title);

      expect(markup).not.toContain("Slack delivery");
      expect(markup).not.toContain("WhatsApp");
      expect(markup).not.toMatch(/\b\d+% of\b/);
    },
  );

  it("publishes each new page in the sitemap and llms.txt", async () => {
    const { publicSeoFileForPathname } = await import("~/lib/seo");
    const sitemap = publicSeoFileForPathname("/sitemap.xml");
    const { LLMS_TEXT } = await import("~/lib/public-markdown");

    for (const { slug } of NEW_COMPARE_PAGES) {
      expect(sitemap?.body).toContain(`<loc>https://0509.io/compare/${slug}</loc>`);
      expect(sitemap?.body).not.toContain("<changefreq>");
      expect(sitemap?.body).not.toContain("<priority>");
      expect(LLMS_TEXT).toContain(`https://0509.io/compare/${slug}`);
    }
  });

  it("links each new page from the marketing footer", async () => {
    const { MarketingFooter } = await import("~/components/marketing-footer");
    const markup = renderToStaticMarkup(createElement(MarketingFooter));

    for (const { slug } of NEW_COMPARE_PAGES) {
      expect(markup).toContain(`href="/compare/${slug}"`);
    }
  });
});
