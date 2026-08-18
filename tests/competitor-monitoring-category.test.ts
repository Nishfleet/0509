import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// feat/competitor-monitoring-category-page test surface. Kept in its own file
// so parallel branches touching marketing tests do not conflict.

const routePath = "app/routes/competitor-monitoring.tsx";

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
      // Route components render in isolation here (no data router), so the
      // real useRouteLoaderData would throw. The nav only reads
      // rootData?.session, which is absent in this static-render context.
      useRouteLoaderData: () => undefined,
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("competitor monitoring category page", () => {
  it("is a landing surface using the shared nav, footer, and hero shell", async () => {
    const source = readFileSync(routePath, "utf8");

    expect(source).toContain("f9-home");
    expect(source).toContain("<MarketingNav />");
    expect(source).toContain("<MarketingFooter />");
    expect(source).toContain('className="ld-hero"');
    expect(source).not.toContain('<footer className="ld-footer">');
  });

  it("carries a truthful title, description, and canonical", async () => {
    const source = readFileSync(routePath, "utf8");

    expect(source).toContain('pathname: "/competitor-monitoring"');
    expect(source).toContain('title: "Competitor monitoring software | Five to Nine"');
    expect(source).toContain("canonicalLinks(\"/competitor-monitoring\")");
    expect(source).toContain("publicSeoMeta({");

    // Description is scoped to what the product actually does and stays under
    // ~155 characters so search results do not truncate mid-sentence.
    const description = "Competitor monitoring software that watches Meta ads and landing pages, then sends screenshot evidence when something changes. Free preview, no account.";
    expect(description.length).toBeLessThanOrEqual(160);
    expect(source).toContain(description);
    expect(source).not.toMatch(/trusted by|#1|best competitor monitoring software/i);
  });

  it("emits WebPage JSON-LD matching the visible title and description", async () => {
    const { webPageJsonLd } = await import("~/lib/seo");
    const { jsonLdScriptProps } = await import("~/lib/seo");

    const webPage = JSON.parse(
      JSON.stringify(
        webPageJsonLd({
          name: "Competitor monitoring software | Five to Nine",
          description:
            "Competitor monitoring software that watches Meta ads and landing pages, then sends screenshot evidence when something changes. Free preview, no account.",
          pathname: "/competitor-monitoring",
          dateModified: "2026-08-08",
        }),
      ),
    );

    expect(webPage["@type"]).toBe("WebPage");
    expect(webPage.url).toBe("https://0509.io/competitor-monitoring");
    expect(webPage.name).toBe("Competitor monitoring software | Five to Nine");

    const source = readFileSync(routePath, "utf8");
    expect(source).toContain("jsonLdScriptProps(");
    expect(source).toContain("webPageJsonLd({");
    expect(source).toContain('dateModified: "2026-08-08"');

    // The date the page visibly stamps (Category evidence checked 2026-08-08)
    // matches the dateModified emitted in structured data.
    expect(source).toContain("Category evidence checked 2026-08-08");
    expect(jsonLdScriptProps(webPage).dangerouslySetInnerHTML.__html).not.toContain("</script>");
  });

  it("emits FAQPage JSON-LD that matches the visible FAQ copy exactly", async () => {
    const { categoryFaqEntries } = await import("~/routes/competitor-monitoring");
    const { faqPageJsonLd } = await import("~/lib/seo");

    const faq = JSON.parse(JSON.stringify(faqPageJsonLd(categoryFaqEntries)));

    expect(faq["@type"]).toBe("FAQPage");
    expect(faq.mainEntity.length).toBeGreaterThanOrEqual(4);

    const source = readFileSync(routePath, "utf8");
    const { default: CompetitorMonitoringCategoryRoute } = await import(
      "~/routes/competitor-monitoring"
    );
    const markup = renderToStaticMarkup(createElement(CompetitorMonitoringCategoryRoute));
    // The visible FAQ block renders from the same array as the JSON-LD.
    expect(source).toContain("aria-label=\"Category FAQ\"");
    expect(source).toContain("Common questions about this category");
    expect(source).toContain("categoryFaqEntries.map((entry) =>");
    expect(source).toContain("faqPageJsonLd(categoryFaqEntries)");

    // Every visible question has an answer of real substance, and the exact
    // same question strings appear in the rendered visible FAQ block.
    for (const question of faq.mainEntity) {
      expect(question["@type"]).toBe("Question");
      expect(question.acceptedAnswer["@type"]).toBe("Answer");
      expect(question.acceptedAnswer.text.length).toBeGreaterThan(20);
      expect(markup).toContain(`<dt>${question.name}</dt>`);
    }

    // Cadence claims match plan entitlements exactly.
    const cadenceAnswer = categoryFaqEntries[3]!.answer;
    expect(cadenceAnswer).toContain("Scout every 6 hours");
    expect(cadenceAnswer).toContain("Starter every 3 hours");
    expect(cadenceAnswer).toContain("first 25 watchlists");

    // No price amounts in structured data — prices are dynamic via Dodo.
    expect(JSON.stringify(faq)).not.toMatch(/[$₹€£]\s?\d/);
  });

  it("links internally to search, docs, and pricing", async () => {
    const source = readFileSync(routePath, "utf8");

    expect(source).toContain('action="/search"');
    expect(source).toContain('<Link to="/search">');
    expect(source).toContain('<Link to="/docs">');
    expect(source).toContain('<Link to="/#pricing">');
    expect(source).toContain('<Link to="/">homepage FAQ</Link>');
  });

  it("states explicit source and freshness limits for every market claim", async () => {
    const source = readFileSync(routePath, "utf8");

    // Every outside claim card carries its check date and its source URL.
    expect(source).toContain("checked 2026-08-08");
    expect(source).toContain("2026-07-27");
    expect(source).toContain("2026-07-28");
    expect(source).toContain("https://www.panoramata.co/track/meta-ads");
    expect(source).toContain("https://watchads.io/");
    expect(source).toContain("https://skopx.com/resources/automate-competitor-monitoring");
    expect(source).toContain("https://www.flares.tech/guides/competitive-intelligence-with-ai");
    expect(source).toContain("https://pagecrawl.io/blog/competitor-comparison-alternatives-page-monitoring");
    expect(source).toContain("https://octolens.com/blog/best-competitor-monitoring-tools");

    // The limits are stated plainly, not buried: vendor pages change and
    // product claims are scoped to the live homepage/docs.
    expect(source).toContain("vendor pages change");
    expect(source).toContain("scoped to the live homepage and docs");
    expect(source).toContain("Source and freshness");
  });

  it("labels the sample as illustrative with no live captures attached", async () => {
    const { default: CompetitorMonitoringCategoryRoute } = await import(
      "~/routes/competitor-monitoring"
    );
    const markup = renderToStaticMarkup(createElement(CompetitorMonitoringCategoryRoute));

    expect(markup).toContain("Sample proof");
    expect(markup).toContain("This sample trail is illustrative — no live captures are attached");
    expect(markup).toContain("Proof status");
    expect(markup).toContain("Not available in this sample");
    expect(markup).toContain("no proof, no claim");
    // The sample links to the live, working preview rather than faking results.
    expect(markup).toContain("Try the live search preview");
  });

  it("never hardcodes prices or claims unsupported superiority", async () => {
    const source = readFileSync(routePath, "utf8");

    // No hardcoded currency amounts anywhere on the page.
    expect(source).not.toMatch(/[$₹€£]\s?\d/);
    expect(source).not.toMatch(/per month|\/mo\b/i);

    // No unsupported superiority claims about named vendors.
    expect(source).not.toMatch(/better than/i);
    expect(source).not.toMatch(/we are the best/i);
    expect(source).not.toMatch(/unbeatable/i);
  });

  it("is included in the public sitemap", async () => {
    const { publicSeoFileForPathname } = await import("~/lib/seo");
    const sitemap = publicSeoFileForPathname("/sitemap.xml");

    expect(sitemap?.body).toContain(
      "<url><loc>https://0509.io/competitor-monitoring</loc></url>",
    );
  });
});
