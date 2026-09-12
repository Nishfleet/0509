import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockReactRouter } from "./helpers/mock-react-router";

// feat/funnel-seo test surface. Kept in its own file (and its own describe
// blocks) so parallel branches touching marketing tests do not conflict.

beforeEach(() => {
  vi.resetModules();
    mockReactRouter();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("landing page product FAQ", () => {
  it("keeps five verified product questions separate from the billing FAQ", async () => {
    const { productFaqEntries } = await import("~/routes/marketing");

    expect(productFaqEntries).toHaveLength(5);
    expect(productFaqEntries.map((entry) => entry.question)).toEqual([
      "Where does the data come from?",
      "Is this allowed?",
      "Will competitors know I'm watching?",
      "How is this different from ad-spy tools?",
      "How fast will I hear about changes?",
    ]);

    const cadenceAnswer = productFaqEntries[4]!.answer;
    // Cadence claims must match plan-entitlements.ts exactly.
    expect(cadenceAnswer).toContain("Scout every 6 hours");
    expect(cadenceAnswer).toContain("Starter every 3 hours");
    expect(cadenceAnswer).toContain("first 25 watchlists");
    expect(cadenceAnswer).toContain("Starter and Agency");

    // The ad-spy answer states the Meta-only scope against multi-platform
    // ad-library aggregators instead of leaving breadth ambiguous.
    const spyAnswer = productFaqEntries[3]!.answer;
    expect(spyAnswer).toContain("many platforms’ ad libraries at once");
    expect(spyAnswer).toContain("Meta Ad Library only");

    const marketingSource = [
      readFileSync("app/routes/marketing.tsx", "utf8"),
      readFileSync("app/components/pricing-section.tsx", "utf8"),
    ].join("\n");
    // Rendered as its own block, not merged into the billing FAQ.
    expect(marketingSource).toContain('aria-label="Product FAQ"');
    expect(marketingSource).toContain('aria-label="Pricing FAQ"');
    expect(marketingSource).toContain("Common product questions");
    expect(marketingSource).toContain("Common billing questions");
  });

  it("matches the shipped scan cadence entitlements", async () => {
    const { getPlanEntitlements, canUsePlanFeature } = await import("~/lib/plan-entitlements");

    // The FAQ says: Scout 6h, Starter 3h, Agency 3h for first 25 slots,
    // instant alerts on Starter and Agency only.
    expect(getPlanEntitlements("scout").scheduledScanCadence).toBe("every_6h");
    expect(getPlanEntitlements("starter").scheduledScanCadence).toBe("every_3h");
    expect(getPlanEntitlements("agency").scheduledScanCadence).toBe("every_3h");
    expect(getPlanEntitlements("agency").priorityScanSlots).toBe(25);
    expect(canUsePlanFeature("starter", "high_priority_alerts")).toBe(true);
    expect(canUsePlanFeature("agency", "high_priority_alerts")).toBe(true);
    expect(canUsePlanFeature("scout", "high_priority_alerts")).toBe(false);
  });
});

describe("structured data (JSON-LD)", () => {
  it("emits Organization and WebSite entities without price amounts", async () => {
    const { organizationJsonLd, webSiteJsonLd } = await import("~/lib/seo");

    const organization = JSON.parse(JSON.stringify(organizationJsonLd()));
    expect(organization["@context"]).toBe("https://schema.org");
    expect(organization["@type"]).toBe("Organization");
    expect(organization.name).toBe("Five to Nine");
    expect(organization.url).toBe("https://0509.io");
    // Issue #2972: enriched trust signals — a real logo asset, the published
    // support contact, and only identity pages that actually exist.
    expect(organization.logo).toBe("https://0509.io/apple-touch-icon.png");
    expect(organization.contactPoint).toMatchObject({
      "@type": "ContactPoint",
      contactType: "customer support",
      email: "support@0509.io",
    });
    expect(organization.sameAs).toContain("https://github.com/Nishfleet");

    const webSite = JSON.parse(JSON.stringify(webSiteJsonLd()));
    expect(webSite["@type"]).toBe("WebSite");
    expect(webSite.url).toBe("https://0509.io");
    expect(webSite.potentialAction["@type"]).toBe("SearchAction");
    // Sitelink-shaped SearchAction: the public sitelink substitution
    // (Google fills `{search_term_string}` with whatever the visitor
    // searched, e.g. `nike`) lands on `/search?q=nike` and runs a search
    // instead of tripping the incomplete-website form error.
    expect(webSite.potentialAction.target.urlTemplate).toBe(
      "https://0509.io/search?q={search_term_string}",
    );
    expect(webSite.potentialAction["query-input"]).toBe(
      "required name=search_term_string",
    );

    for (const serialized of [JSON.stringify(organization), JSON.stringify(webSite)]) {
      expect(serialized).not.toMatch(/price/i);
      expect(serialized).not.toMatch(/[$₹€£]\s?\d/);
    }
  });

  it("emits one FAQPage covering the product and billing FAQ blocks", async () => {
    const { faqPageJsonLd } = await import("~/lib/seo");
    const { productFaqEntries, billingFaqJsonLdEntries } = await import("~/routes/marketing");

    const faq = JSON.parse(
      JSON.stringify(faqPageJsonLd([...productFaqEntries, ...billingFaqJsonLdEntries()])),
    );

    expect(faq["@type"]).toBe("FAQPage");
    expect(faq.mainEntity).toHaveLength(10);
    for (const question of faq.mainEntity) {
      expect(question["@type"]).toBe("Question");
      expect(typeof question.name).toBe("string");
      expect(question.acceptedAnswer["@type"]).toBe("Answer");
      expect(typeof question.acceptedAnswer.text).toBe("string");
      expect(question.acceptedAnswer.text.length).toBeGreaterThan(20);
    }
    // No price amounts in structured data — prices are dynamic via Dodo.
    expect(JSON.stringify(faq)).not.toMatch(/[$₹€£]\s?\d/);

    // The held/open Agency billing question follows the launch gate.
    const heldQuestions = faq.mainEntity.map((entry: { name: string }) => entry.name);
    expect(heldQuestions).toContain("Why is Agency held?");
    const openFaq = JSON.parse(JSON.stringify(faqPageJsonLd(billingFaqJsonLdEntries())));
    expect(openFaq.mainEntity.map((entry: { name: string }) => entry.name)).toContain(
      "How does Agency checkout work?",
    );
  });

  it("escapes < in JSON-LD script props and wires the scripts on the landing page", async () => {
    const { jsonLdScriptProps } = await import("~/lib/seo");
    const props = jsonLdScriptProps({ note: "</script><b>" });

    expect(props.type).toBe("application/ld+json");
    expect(props.dangerouslySetInnerHTML.__html).not.toContain("</script>");
    expect(props.dangerouslySetInnerHTML.__html).toContain("\\u003c/script>");

    const marketingSource = readFileSync("app/routes/marketing.tsx", "utf8");
    expect(marketingSource).toContain("jsonLdScriptProps(organizationJsonLd())");
    expect(marketingSource).toContain("jsonLdScriptProps(webSiteJsonLd())");
    expect(marketingSource).toContain("faqPageJsonLd([");
  });
});

describe("shared marketing footer", () => {
  it("renders brand line, standard links, and the compare group", async () => {
    const { MarketingFooter, BRAND_ORIGIN_LINE } = await import("~/components/marketing-footer");
    const markup = renderToStaticMarkup(createElement(MarketingFooter));

    expect(BRAND_ORIGIN_LINE).toBe(
      "Named for 05:09 — your competitor brief is filed before the workday starts.",
    );
    expect(markup).toContain("Named for 05:09");
    for (const href of [
      "/help",
      "/docs",
      "/api/docs",
      "/status",
      "/changelog",
      "/competitor-monitoring",
      "/capture-rules",
      "/brands",
      "/trust",
      "/privacy",
      "/terms",
      "/compare/meta-ad-library",
      // Generic /compare/visualping and /compare/foreplay are not in the
      // footer (issue #1481): duplicates canonicalizing to the two below.
      "/compare/visualping-ad-libraries",
      "/compare/spyland",
      "/compare/pulzifi",
      "/compare/foreplay-spyder",
      "/compare/panoramata",
      "/compare/adspyder",
      "/compare/adspy",
      "/switch/panoramata",
      "/switch/visualping",
      "/switch/magicbrief",
      "/switch/adspy",
      "/sneaker-resale",
    ]) {
      expect(markup).toContain(`href="${href}"`);
    }
    expect(markup).toContain("mailto:support@0509.io");
    // The footer's "By industry" group is the inbound link that keeps the
    // sneaker-resale GEO cluster off the sitemap-only orphan path (issue 1460).
    expect(markup).toContain("By industry");
    expect(markup).toContain("Sneaker resale competitor ads");
  });

  it("is used by the landing page, all compare pages, and all switch pages", () => {
    for (const path of [
      "app/routes/marketing.tsx",
      "app/routes/compare.meta-ad-library.tsx",
      "app/routes/compare.visualping.tsx",
      "app/routes/compare.visualping-ad-libraries.tsx",
      "app/routes/compare.spyland.tsx",
      "app/routes/compare.pulzifi.tsx",
      "app/routes/compare.foreplay.tsx",
      "app/routes/compare.foreplay-spyder.tsx",
      "app/routes/compare.panoramata.tsx",
      "app/routes/compare.adspyder.tsx",
      "app/routes/compare.adspy.tsx",
      "app/components/switch-landing.tsx",
      "app/components/sneaker-resale-landing.tsx",
    ]) {
      const source = readFileSync(path, "utf8");
      // Prefix match: routes may pass the monitoring-coverage prop (issue
      // #2972) — what matters is the shared component, never a hand-rolled
      // footer.
      expect(source).toContain("<MarketingFooter");
      expect(source).not.toContain('<footer className="ld-footer">');
    }
  });

  it("renders the coverage figure and status link only when real data is passed (issue #2972)", async () => {
    const { MarketingFooter } = await import("~/components/marketing-footer");

    const withFigure = renderToStaticMarkup(
      createElement(MarketingFooter, { monitoringCoverageDays: 42 }),
    );
    expect(withFigure).toContain('href="/status"');
    expect(withFigure).toContain("42 days of continuous scheduled monitoring");

    // No figure is ever fabricated: without loader data the footer renders
    // the Status link alone.
    const bare = renderToStaticMarkup(createElement(MarketingFooter));
    expect(bare).toContain('href="/status"');
    expect(bare).not.toContain("continuous scheduled monitoring");
  });

  it("wires the coverage figure into the landing and pricing footers", () => {
    for (const path of ["app/routes/marketing.tsx", "app/routes/pricing.tsx"]) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("getMonitoringCoverageDays");
      expect(source).toContain("monitoringCoverageDays={");
    }
  });
});

describe("search page title", () => {
  it("uses the funnel-facing title under 60 characters", async () => {
    const searchSource = readFileSync("app/routes/search.tsx", "utf8");
    const title = "Search competitor Meta ads free | Five to Nine";

    expect(title.length).toBeLessThanOrEqual(60);
    // The title lives in one shared constant so the visible meta title and the
    // WebPage JSON-LD name can never drift apart.
    expect(searchSource).toContain(`searchTitle = "${title}"`);
    // The shared constant is still the fallback for the meta title on the
    // unresolved/idle case (issue #2039 adds a resolved-brand override on top).
    expect(searchSource).toContain("?? searchTitle");
    expect(searchSource).not.toContain('title: "Search | Five to Nine"');
  });
});

describe("search page structured data (JSON-LD)", () => {
  it("emits a plain WebPage entity mirroring the visible meta title and description", async () => {
    const { webPageJsonLd } = await import("~/lib/seo");
    const page = JSON.parse(
      JSON.stringify(
        webPageJsonLd({
          name: "Search competitor Meta ads free | Five to Nine",
          description:
            "Preview public competitor ad results before creating an account; sign in to save examples and track offer changes over time. Provider coverage and freshness vary.",
          pathname: "/search",
        }),
      ),
    );

    expect(page["@type"]).toBe("WebPage");
    expect(page.name).toBe("Search competitor Meta ads free | Five to Nine");
    expect(page.url).toBe("https://0509.io/search");
    expect(page.isPartOf["@type"]).toBe("WebSite");
    expect(page.publisher["@type"]).toBe("Organization");
    // Nothing invented: no price amounts, no dateModified (the page stamps no
    // update time), no about (the searched website is user input, not a
    // verified brand).
    expect(JSON.stringify(page)).not.toMatch(/price|dateModified|"about"/i);
    expect(JSON.stringify(page)).not.toMatch(/[$₹€£]\s?\d/);
  });

  it("wires the JSON-LD script on /search from the shared title and description constants", async () => {
    const searchSource = readFileSync("app/routes/search.tsx", "utf8");

    expect(searchSource).toContain("jsonLdScriptProps(");
    expect(searchSource).toContain("webPageJsonLd({");
    expect(searchSource).toContain("name: searchTitle,");
    expect(searchSource).toContain("description: searchDescription,");
    expect(searchSource).toContain('pathname: "/search",');
  });
});
