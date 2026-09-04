import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// feat/funnel-seo test surface. Kept in its own file (and its own describe
// blocks) so parallel branches touching marketing tests do not conflict.

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
    };
  });
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

    const marketingSource = readFileSync("app/routes/marketing.tsx", "utf8");
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

    const webSite = JSON.parse(JSON.stringify(webSiteJsonLd()));
    expect(webSite["@type"]).toBe("WebSite");
    expect(webSite.url).toBe("https://0509.io");
    expect(webSite.potentialAction["@type"]).toBe("SearchAction");
    expect(webSite.potentialAction.target.urlTemplate).toBe(
      "https://0509.io/search?website={website}",
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
      JSON.stringify(faqPageJsonLd([...productFaqEntries, ...billingFaqJsonLdEntries(false)])),
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
    const openFaq = JSON.parse(JSON.stringify(faqPageJsonLd(billingFaqJsonLdEntries(true))));
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

describe("search route structured data (JSON-LD)", () => {
  // Renders the real /search route server-side (the existing route-render
  // style) so the JSON-LD assertions read produced markup, not source text:
  // a dead script tag can never satisfy them by accident.

  let loaderData: Record<string, unknown>;
  let locationObj: { pathname: string; search: string; hash: string };
  let navigationState: {
    state: string;
    location?: { pathname: string; search: string } | null;
  };
  let revalidatorRef: { state: string; revalidate: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.resetModules();
    vi.doMock("react-router", async () => {
      const actual =
        await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");
      return {
        ...actual,
        Form: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
          React.createElement("form", props, children),
        Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
          React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
        useActionData: () => undefined,
        useLoaderData: () => loaderData,
        useLocation: () => locationObj,
        useNavigate: () => vi.fn(),
        useNavigation: () => navigationState,
        useRevalidator: () => revalidatorRef,
        useRouteLoaderData: () => ({ session: null }),
      };
    });
    vi.doMock("~/components/dashboard-shell", () => ({
      DashboardShell: ({ children }: { children?: React.ReactNode }) =>
        createElement("main", null, children),
    }));

    loaderData = {
      mode: "advertiser",
      filters: {
        query: "",
        country: "all",
        platform: "all",
        creativeType: "all",
        status: "all",
        firstSeenFrom: "",
        lastSeenFrom: "",
      },
      fingerprint: "",
      result: {
        ads: [],
        nextCursor: null,
        source: "demo",
        provider: "demo",
        cacheStatus: "none",
        discoveryStatus: "disabled",
        discoverySummary: null,
        discoveryFailureClass: null,
      },
      selectedAd: null,
      stealSummary: null,
      selectionEnrichmentPending: false,
      collections: [],
      plan: null,
      session: null,
      competitorWebsite: {
        raw: "",
        normalizedUrl: null,
        host: null,
        displayName: null,
        searchTerm: null,
        error: null,
      },
      trackingRole: "competitor",
      inputError: null,
      searchScope: "exact",
      displayDomain: null,
      relevanceApplied: false,
      watchedWatchlist: null,
      showPresenceNav: false,
    };
    locationObj = { pathname: "/search", search: "", hash: "" };
    navigationState = { state: "idle" };
    revalidatorRef = { state: "idle", revalidate: vi.fn() };
  });

  async function renderSearchMarkup() {
    const { default: SearchRoute } = await import("~/routes/search");
    return renderToStaticMarkup(createElement(SearchRoute));
  }

  it("renders exactly one safe WebPage entity with the canonical search URL", async () => {
    const markup = await renderSearchMarkup();

    // The page itself still renders (the JSON-LD is additive, not a swap).
    expect(markup).toContain("Find competitor ads");

    const scripts = [
      ...markup.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
    ];
    expect(scripts).toHaveLength(1);

    const raw = scripts[0]![1]!;
    // jsonLdScriptProps escapes `<` so page data can never break out of the
    // script element — no raw angle bracket may survive into the payload.
    expect(raw).not.toContain("<");
    expect(raw).not.toContain("</script>");

    const entity = JSON.parse(raw);
    expect(entity["@context"]).toBe("https://schema.org");
    expect(entity["@type"]).toBe("WebPage");
    expect(entity.url).toBe("https://0509.io/search");
    expect(entity.name).toBe("Search competitor Meta ads free | Five to Nine");

    // The WebPage claims exactly the Five to Nine WebSite/Organization
    // relationship the site already publishes — nothing invented.
    expect(entity.isPartOf).toEqual({
      "@type": "WebSite",
      name: "Five to Nine",
      url: "https://0509.io",
    });
    expect(entity.publisher).toEqual({
      "@type": "Organization",
      name: "Five to Nine",
      url: "https://0509.io",
    });

    // The description must match the route's meta description verbatim.
    const { meta, links } = await import("~/routes/search");
    const metaEntries = (meta as unknown as () => Array<Record<string, string>>)();
    const descriptionEntry = metaEntries?.find((entry) => entry.name === "description");
    const titleEntry = metaEntries?.find((entry) => "title" in entry);
    expect(entity.description).toBe(descriptionEntry?.content);
    expect(entity.name).toBe(titleEntry?.title);
    const linkEntries = (links as unknown as () => Array<{ href: string }>)();
    expect(entity.url).toBe(linkEntries?.[0]?.href);
  });

  it("asserts no unsupported claims or price amounts in the search entity", async () => {
    const markup = await renderSearchMarkup();
    const scripts = [
      ...markup.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
    ];
    expect(scripts).toHaveLength(1);
    const serialized = scripts[0]![1]!;

    // The entity is a plain WebPage: no fabricated result list, no live
    // provider guarantee, no product/FAQ/rating vocabulary. The review/rating
    // checks match the JSON property form so prose words inside the truthful
    // description ("Preview…") can never trip them.
    for (const banned of [
      "FAQPage",
      "Question",
      "SoftwareApplication",
      "potentialAction",
      "mainEntity",
      "offers",
      "aggregateRating",
      "hasPart",
      '"review"',
      '"rating"',
    ]) {
      expect(serialized).not.toContain(banned);
    }
    // No prices anywhere in the structured data.
    expect(serialized).not.toMatch(/price/i);
    expect(serialized).not.toMatch(/[$₹€£]\s?\d/);

    // And the visible page does not render results for a queryless load.
    expect(markup).toContain("Nothing searched yet");
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
      "/trust",
      "/privacy",
      "/terms",
      "/compare/magicbrief",
      "/compare/meta-ad-library",
    ]) {
      expect(markup).toContain(`href="${href}"`);
    }
    expect(markup).toContain("mailto:support@0509.io");
  });

  it("is used by the landing page and both compare pages", () => {
    for (const path of [
      "app/routes/marketing.tsx",
      "app/routes/compare.magicbrief.tsx",
      "app/routes/compare.meta-ad-library.tsx",
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("<MarketingFooter />");
      expect(source).not.toContain('<footer className="ld-footer">');
    }
  });
});

describe("search page title", () => {
  it("uses the funnel-facing title under 60 characters", async () => {
    const searchSource = readFileSync("app/routes/search.tsx", "utf8");
    const title = "Search competitor Meta ads free | Five to Nine";

    expect(title.length).toBeLessThanOrEqual(60);
    expect(searchSource).toContain(`title: "${title}"`);
    expect(searchSource).not.toContain('title: "Search | Five to Nine"');
  });
});
