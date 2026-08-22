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
      // The shared MarketingNav shell reads root loader data; render these
      // routes without a data-router context (same pattern as
      // tests/ads-brand-page.render.test.tsx) so the router hook is a no-op.
      useRouteLoaderData: () => undefined,
      useLoaderData: () => ({ proofBrief: null }),
      Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
        React.createElement("form", props, children),
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

  it("renders date-only Ad Library captures as calendar dates, never a midnight clock", () => {
    const source = readFileSync(routePath, "utf8");

    expect(source).toContain('from "~/lib/capture-date-label"');
    expect(source).toContain("formatCaptureStampLabel");
    expect(source).toContain("formatCaptureStampLabel(iso) ?? \"recently\"");
    expect(source).not.toMatch(/hour:\s*"numeric"/);
    expect(source).not.toMatch(/minute:\s*"2-digit"/);
  });

  it("prints Captured Aug 1 for a YYYY-MM-DD trail stamp and never 12:00 AM", async () => {
    vi.resetModules();
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");
      return {
        ...actual,
        useRouteLoaderData: () => undefined,
        useLoaderData: () => ({
          proofBrief: {
            competitorName: "Nykaa",
            website: "nykaa.com",
            adLibraryCountry: "India",
            fetchedAt: "2026-08-11T22:17:00.000Z",
            checkedAgoLabel: "about 4 hours ago",
            freshForLiveClaim: false,
            adCount: 1,
            activeAdCount: 1,
            summary: "1 public Meta ad.",
            decision: {
              subject: "1 of 1 cached ads are active on record",
              whatChanged: "Hook.",
              whyItMatters: "Matters.",
              priority: "Review",
              proofStatus: "Captured",
              source: "Meta Ad Library",
              freshness: "Last checked about 4 hours ago",
              nextAction: "Open the same ad",
            },
            proofTrail: [
              {
                id: "ad-1:Ad hook",
                signal: "Ad hook",
                evidence: "Routine-first bundle",
                source: "Meta Ad Library — Nykaa Beauty",
                sourceUrl: "https://www.facebook.com/ads/library/?id=111",
                capturedAt: "2026-08-01",
              },
            ],
            insights: { topHooks: [], mediaMix: [], timeline: [] },
            reportRows: ["row"],
          },
        }),
        Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
          React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
        Form: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
          React.createElement("form", props, children),
      };
    });
    const { default: CompetitorMonitoringCategoryRoute } = await import(
      "~/routes/competitor-monitoring"
    );
    const markup = renderToStaticMarkup(createElement(CompetitorMonitoringCategoryRoute));
    expect(markup).toContain("Captured Aug 1");
    expect(markup).not.toMatch(/12:00\s*AM/i);
    expect(markup).not.toMatch(/\b12:00\b/);
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
          dateModified: "2026-08-21",
        }),
      ),
    );

    expect(webPage["@type"]).toBe("WebPage");
    expect(webPage.url).toBe("https://0509.io/competitor-monitoring");
    expect(webPage.name).toBe("Competitor monitoring software | Five to Nine");

    const source = readFileSync(routePath, "utf8");
    expect(source).toContain("jsonLdScriptProps(");
    expect(source).toContain("webPageJsonLd({");
    expect(source).toContain('dateModified: "2026-08-21"');

    // The date the page visibly stamps (Category evidence checked 2026-08-08
    // and 2026-08-21) matches the dateModified emitted in structured data.
    expect(source).toContain("Category evidence checked 2026-08-08 and 2026-08-21");
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

    // The 2026-08-21 research cycle added the new noise-triage entrants, each
    // with its own check date and source URL.
    expect(source).toContain("adversa.io — checked 2026-08-21");
    expect(source).toContain("whatchanged.co.uk — checked 2026-08-21");
    expect(source).toContain("https://adversa.io/");
    expect(source).toContain("https://whatchanged.co.uk/");

    // The limits are stated plainly, not buried: vendor pages change and
    // product claims are scoped to the live homepage/docs.
    expect(source).toContain("vendor pages change");
    expect(source).toContain("scoped to the live homepage and docs");
    expect(source).toContain("Source and freshness");
  });

  it("renders the new noise-triage entrants as sourced promise cards", async () => {
    const { default: CompetitorMonitoringCategoryRoute } = await import(
      "~/routes/competitor-monitoring"
    );
    const markup = renderToStaticMarkup(createElement(CompetitorMonitoringCategoryRoute));

    // Adversa's own positioning: noise filtering plus AI significance scoring.
    expect(markup).toContain("adversa.io — checked 2026-08-21");
    expect(markup).toContain("AI that triages the noise and scores each change");
    expect(markup).toContain("how significant it was");
    // WhatChanged's own positioning: a real-time diff feed of every change.
    expect(markup).toContain("whatchanged.co.uk — checked 2026-08-21");
    expect(markup).toContain("A real-time feed of every competitor site change");

    // The entrants are described by their own claims, never priced and never
    // ranked against — the page's standing honesty rules hold for them too.
    expect(markup).toMatch(/https:\/\/adversa\.io\//);
    expect(markup).toMatch(/https:\/\/whatchanged\.co\.uk\//);
    expect(markup).not.toMatch(/\$\s?\d/);
  });

  it("renders real proof, never a sample or illustrative fixture", async () => {
    const { default: CompetitorMonitoringCategoryRoute } = await import(
      "~/routes/competitor-monitoring"
    );
    const markup = renderToStaticMarkup(createElement(CompetitorMonitoringCategoryRoute));

    // The proof brief is real data; the page never labels anything sample or
    // illustrative and never renders a fake evidence trail.
    expect(markup).toContain("Proof brief");
    expect(markup).not.toContain("Sample proof");
    expect(markup).not.toContain("sample");
    expect(markup).not.toContain("illustrative");
    expect(markup).not.toContain("no live captures are attached");
    expect(markup).not.toContain("Not available in this sample");

    // With no real capture the page renders the honest state and links to the
    // live preview instead of faking results.
    expect(markup).toContain("No live proof right now");
    expect(markup).toContain("We haven’t captured this competitor recently.");
    expect(markup).toContain("Run the search preview");
    expect(markup).toContain("Create an account");
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

  it("positions the Meta-only ad scope against multi-platform ad-library aggregators", async () => {
    const { categoryFaqEntries } = await import("~/routes/competitor-monitoring");
    const { default: CompetitorMonitoringCategoryRoute } = await import(
      "~/routes/competitor-monitoring"
    );
    const source = readFileSync(routePath, "utf8");
    const markup = renderToStaticMarkup(createElement(CompetitorMonitoringCategoryRoute));

    // Cross-platform aggregators (adlibrary.com and similar) search many
    // platforms' ad libraries at once; this page must state the Meta-only
    // scope plainly instead of leaving buyers to assume broad coverage.
    expect(source).toContain("Coverage is the Meta Ad Library only");
    expect(source).toContain("platforms&rsquo; ad libraries are not included");

    // The ad-spy FAQ answer names the multi-platform category explicitly.
    const spyAnswer = categoryFaqEntries.find(
      (entry) => entry.question === "How is this different from ad-spy tools?",
    )!.answer;
    expect(spyAnswer).toContain("many platforms’ ad libraries at once");
    expect(spyAnswer).toContain("Meta Ad Library only");
    expect(markup).toContain("Meta Ad Library only");

    // Honest scoping, not superiority: no named-vendor attacks or unsupported
    // breadth claims, and no promise of other platforms coming.
    expect(source).not.toMatch(/better than|unbeatable|coming soon/i);
    expect(source).not.toContain("adlibrary.com");
  });

  it("is included in the public sitemap", async () => {
    const { publicSeoFileForPathname } = await import("~/lib/seo");
    const sitemap = publicSeoFileForPathname("/sitemap.xml");

    expect(sitemap?.body).toContain(
      "<loc>https://0509.io/competitor-monitoring</loc>",
    );
  });
});
