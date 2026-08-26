import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NEW_COMPARE_PAGES = [
  {
    slug: "panoramata",
    title: "Five to Nine vs Panoramata",
    pricing: ["€99", "€379"],
    competitor: "Panoramata",
  },
  {
    slug: "foreplay-spyder",
    title: "Five to Nine vs Foreplay Spyder",
    pricing: ["$59", "$459"],
    competitor: "Foreplay Spyder",
  },
  {
    slug: "adspyder",
    title: "Five to Nine vs AdSpyder",
    pricing: ["$10", "$99"],
    competitor: "AdSpyder",
  },
  {
    slug: "visualping-ad-library",
    title: "Five to Nine vs Visualping for ad libraries",
    pricing: ["free", "$350"],
    competitor: "Visualping",
  },
] as const;

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
        React.createElement("form", props, children),
      useRouteLoaderData: () => undefined,
    };
  });
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
    case "visualping-ad-library":
      return import("~/routes/compare.visualping-ad-library");
    default:
      throw new Error(`unknown compare slug: ${slug}`);
  }
}

describe("new compare pages (issue 1107)", () => {
  it.each(NEW_COMPARE_PAGES)(
    "$slug is registered, returns comparison markup, has one plain h1, and emits JSON-LD",
    async ({ slug, title, pricing, competitor }) => {
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

  it("publishes each new page in the sitemap and llms.txt with weekly 0.7 priority", async () => {
    const { publicSeoFileForPathname } = await import("~/lib/seo");
    const sitemap = publicSeoFileForPathname("/sitemap.xml");
    const { LLMS_TEXT } = await import("~/lib/public-markdown");

    for (const { slug } of NEW_COMPARE_PAGES) {
      expect(sitemap?.body).toContain(`<loc>https://0509.io/compare/${slug}</loc>`);
      const around = sitemap?.body.split(`<loc>https://0509.io/compare/${slug}</loc>`)[1] ?? "";
      expect(around).toContain("<changefreq>weekly</changefreq>");
      expect(around).toContain("<priority>0.7</priority>");
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
