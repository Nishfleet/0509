import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FREE_PREVIEW_SEARCH_DOMAIN } from "~/lib/demo-brand-pages";

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
      useLoaderData: () => ({ featuredAdsLink: null }),
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("compare meta-ad-library route", () => {
  it("renders the honest Ad Library comparison with a /search start CTA", async () => {
    const { default: CompareMetaAdLibraryRoute } = await import(
      "~/routes/compare.meta-ad-library"
    );
    const markup = renderToStaticMarkup(createElement(CompareMetaAdLibraryRoute));

    // Issue #2141: the H1 mirrors the buyer's words — the missing follow button.
    expect(markup).toContain("Follow any brand");
    expect(markup).toContain("the way you follow people on Instagram.");
    // Sub-line: no follow/save/alert/export, commercial ads drop out once
    // inactive, citing adlibrary.com's limitations post with its date.
    expect(markup).toContain("no follow, save, alert or export");
    expect(markup).toContain("drop out once");
    expect(markup).toContain("May 17, 2026");
    expect(markup).toContain("https://adlibrary.com/posts/limitations-of-meta-ad-library-2026");
    // Generous and honest about the free source we build on.
    expect(markup).toContain("What the Ad Library gives you free.");
    expect(markup).toContain("It is a genuinely good research surface.");
    expect(markup).toContain("the same public archive Five to Nine reads");
    // Manual-checking costs.
    expect(markup).toContain("What manual checking costs you.");
    expect(markup).toContain("You have to remember to check");
    expect(markup).toContain("No memory, no diffs");
    expect(markup).toContain("No evidence trail, no alerts");
    // Issue #2141: the DIY scraper row with its Apify citation.
    expect(markup).toContain("Scheduled scraper or MCP call");
    expect(markup).toContain("jy-labs/meta-ad-library-multi-search-scraper");
    expect(markup).toContain("$10 per 1,000 results");
    expect(markup).toContain("onlyNewAds");
    expect(markup).toContain("new-ad detection");
    expect(markup).toContain("landing-page diff");
    expect(markup).toContain("offer timeline");
    expect(markup).toContain("screenshot proof");
    expect(markup).toContain("worth-action verdict");
    expect(markup).toContain("https://apify.com/jy-labs/meta-ad-library-multi-search-scraper");
    // What Five to Nine adds — claims verified against plan-entitlements.ts.
    expect(markup).toContain("Scheduled checks");
    expect(markup).toContain("every 3–6 hours");
    expect(markup).toContain("Before/after diffs");
    expect(markup).toContain("Saved evidence");
    expect(markup).toContain("Email briefs");
    expect(markup).toContain("daily on Starter and Agency, weekly on Scout");
    // Start CTA goes to the free public search preview — pre-filled with a
    // tracked demo brand (issue #2123 pattern), never the vendor domain.
    expect(markup).toContain('action="/search"');
    expect(markup).toContain(`value="${FREE_PREVIEW_SEARCH_DOMAIN}"`);
    expect(markup).toContain(`href="/search?website=${FREE_PREVIEW_SEARCH_DOMAIN}"`);
    expect(markup).not.toContain('href="/search?website=facebook.com"');
    expect(markup).not.toContain('value="facebook.com"');
    // Shared marketing footer with the compare group and brand line.
    expect(markup).toContain("Named for 05:09");
    expect(markup).toContain('href="/compare/panoramata"');
    // No invented numbers, testimonials, or non-GA channel claims.
    expect(markup).not.toMatch(/\b\d+% of\b/);
    expect(markup).not.toContain("Slack delivery");
    expect(markup).not.toContain("WhatsApp");
    // Must-not (issue #2141): no TikTok/Google/LinkedIn coverage claims and no
    // spend or impression data claims.
    expect(markup).not.toContain("TikTok");
    expect(markup).not.toContain("LinkedIn");
    expect(markup).not.toContain("Google");
    expect(markup).not.toMatch(/spend data|impression data|impressions data/i);
  });

  it("records every cited URL and its check date in the sources doc (issue #2141)", async () => {
    const { readFileSync } = await import("node:fs");
    const doc = readFileSync("docs/compare-meta-ad-library-source.md", "utf8");
    const citations = (await import("~/data/compare/meta-ad-library-citations.json")).default as {
      sources: readonly { href: string; checked: string }[];
    };

    expect(citations.sources.length).toBeGreaterThanOrEqual(4);
    for (const source of citations.sources) {
      expect(doc, `sources doc must record ${source.href}`).toContain(source.href);
      expect(doc, `sources doc must record the check date for ${source.href}`).toContain(
        source.checked,
      );
    }
    // The adlibrary.com limitations post is cited with its publication date.
    expect(doc).toContain("May 17, 2026");
  });

  it("declares the canonical URL and public SEO meta", async () => {
    const { links, meta } = await import("~/routes/compare.meta-ad-library");

    const { buyerSurfaceHreflangLinks } = await import("~/lib/seo");
    expect(links()).toEqual([
      { rel: "canonical", href: "https://0509.io/compare/meta-ad-library" },
      ...buyerSurfaceHreflangLinks("compare/meta-ad-library"),
    ]);

    const tags = meta({} as never) as Array<Record<string, string>>;
    const title = tags.find((tag) => "title" in tag)?.title;
    expect(title).toBe("Five to Nine vs checking the Meta Ad Library by hand");
    expect(tags).toContainEqual({
      property: "og:url",
      content: "https://0509.io/compare/meta-ad-library",
    });
  });

  it("is registered as a route and published in the sitemap", async () => {
    const { readFileSync } = await import("node:fs");
    const routes = readFileSync("app/routes.ts", "utf8");
    expect(routes).toContain(
      'route("compare/meta-ad-library", "routes/compare.meta-ad-library.tsx")',
    );

    const { publicSeoFileForPathname } = await import("~/lib/seo");
    const sitemap = publicSeoFileForPathname("/sitemap.xml");
    expect(sitemap?.body).toContain(
      "<loc>https://0509.io/compare/meta-ad-library</loc>",
    );
  });

  it("emits one FAQPage JSON-LD block whose mainEntity count matches the visible FAQ entries", async () => {
    const { default: CompareMetaAdLibraryRoute, metaAdLibraryFaqEntries } = await import(
      "~/routes/compare.meta-ad-library"
    );
    const markup = renderToStaticMarkup(createElement(CompareMetaAdLibraryRoute));

    const ldBlocks = [...markup.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    const faqBlocks = ldBlocks
      .map((match) => JSON.parse(match[1]))
      .filter((data) => data["@type"] === "FAQPage");

    expect(faqBlocks).toHaveLength(1);
    const mainEntity = faqBlocks[0].mainEntity as Array<{ name: string }>;
    expect(mainEntity).toHaveLength(metaAdLibraryFaqEntries.length);
    expect(mainEntity.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(metaAdLibraryFaqEntries.map((entry) => entry.question)),
    );
    // Issue #2141: the follow-button FAQ with the honest no.
    expect(metaAdLibraryFaqEntries.map((entry) => entry.question)).toContain(
      "Does the Meta Ad Library have alerts or a follow button?",
    );
    const followFaq = metaAdLibraryFaqEntries.find(
      (entry) => entry.question === "Does the Meta Ad Library have alerts or a follow button?",
    );
    expect(followFaq?.answer).toMatch(/^No\./);
  });
});
