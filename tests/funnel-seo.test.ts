import { readFileSync } from "node:fs";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// feat/funnel-seo test surface. Kept in its own file (and its own describe
// blocks) so parallel branches touching marketing tests do not conflict.

// The search structured data tests render the full public /search route, and
// the footer tests render react-router components, so react-router is mocked
// ONCE per test here — a single file-level registration that covers both.
// Re-registering the same module from a second `vi.doMock` in the same test
// is racy in vitest (queued mock factories resolve lazily per module fetch,
// and concurrent fetches of a huge route module graph can resolve them out
// of order), which intermittently left the real `useLoaderData` in place.
// Loader data is swapped per test through the `loaderDataForSearchRender`
// slot below, so no test ever re-registers the module.
let loaderDataForSearchRender: unknown = null;

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
      useActionData: () => undefined,
      useLoaderData: () => loaderDataForSearchRender,
      useLocation: () => ({ pathname: "/search", search: "", hash: "" }),
      useNavigate: () => () => {},
      useNavigation: () => ({ state: "idle" }),
      useRevalidator: () => ({ state: "idle", revalidate: () => {} }),
      useRouteLoaderData: () => ({ session: null }),
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  loaderDataForSearchRender = null;
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

describe("search page structured data (JSON-LD)", () => {
  // Public idle state: nothing searched yet, anonymous visitor. The WebPage
  // entity is static, so this is the state crawlers most often hit.
  const idleLoaderData = {
    mode: "advertiser" as const,
    filters: {
      query: "",
      country: "all",
      platform: "all",
      creativeType: "all",
      status: "all",
      firstSeenFrom: "",
      lastSeenFrom: "",
    },
    fingerprint: "fp-idle",
    result: {
      ads: [],
      nextCursor: null,
      source: "demo" as const,
      cacheStatus: "none" as const,
      discoveryStatus: "disabled" as const,
      discoverySummary: null,
      discoveryFailureClass: null,
    },
    selectedAd: null,
    collections: [],
    session: null,
    competitorWebsite: {
      raw: "",
      normalizedUrl: "",
      host: "",
      displayName: null,
      searchTerm: "",
      error: null,
    },
    trackingRole: "competitor" as const,
    inputError: null,
    searchScope: "exact" as const,
    displayDomain: null,
    relevanceApplied: false,
    watchedWatchlist: null,
    showPresenceNav: false,
  };

  async function renderSearchPageStructuredData() {
    // The file-level beforeEach already registered the single react-router
    // mock; this test only swaps in the loader data and re-imports fresh
    // (resetModules makes the beforeEach factory run again on the next
    // import, so `useLoaderData` returns this test's idle payload).
    vi.resetModules();
    loaderDataForSearchRender = idleLoaderData;

    vi.doMock("~/components/dashboard-shell", () => ({
      DashboardShell: ({ children }: { children?: ReactNode }) =>
        createElement("main", null, children),
    }));

    const { default: SearchRoute, meta } = await import("~/routes/search");
    const markup = renderToStaticMarkup(createElement(SearchRoute));
    const scriptMatches = Array.from(
      markup.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
    );
    // meta() ignores its args — the route builds its tags from static copy.
    const metaTags = meta({} as never) as Array<{
      title?: string;
      name?: string;
      content?: string;
    }>;

    return { markup, metaTags, scriptMatches };
  }

  it("renders exactly one WebPage entity with the canonical /search URL and the site relationship", async () => {
    const { metaTags, scriptMatches } = await renderSearchPageStructuredData();

    // One and only one structured-data script, and it is a WebPage.
    expect(scriptMatches).toHaveLength(1);
    const entity = JSON.parse(scriptMatches[0]![1]!) as Record<string, unknown>;

    expect(entity["@context"]).toBe("https://schema.org");
    expect(entity["@type"]).toBe("WebPage");
    expect(entity.url).toBe("https://0509.io/search");

    // Name and description match the route's meta output (and the visible
    // funnel-facing title) — structured data never invents copy.
    expect(entity.name).toBe("Search competitor Meta ads free | Five to Nine");
    expect(entity.description).toBe(
      "Preview public competitor ad results before creating an account; sign in to save examples and track offer changes over time. Provider coverage and freshness vary.",
    );
    expect(entity.name).toBe(metaTags.find((tag) => tag.title)?.title);
    expect(entity.description).toBe(
      metaTags.find((tag) => tag.name === "description")?.content,
    );

    // The existing Five to Nine WebSite/Organization relationship.
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
  });

  it("keeps the search structured data free of prices, results, and unsupported claims", async () => {
    const { markup, scriptMatches } = await renderSearchPageStructuredData();

    // The serialized JSON inside the script is escaped so nothing can break
    // out of the script element in the server-rendered markup.
    const serialized = scriptMatches[0]![1]!;
    expect(serialized).not.toContain("</script>");
    expect(markup.match(/<script type="application\/ld\+json">/g)).toHaveLength(1);

    const entity = JSON.parse(serialized) as Record<string, unknown>;

    // Exactly the truthful WebPage shape — nothing fabricated alongside it.
    expect(Object.keys(entity).sort()).toEqual([
      "@context",
      "@type",
      "description",
      "isPartOf",
      "name",
      "publisher",
      "url",
    ]);

    const serializedEntity = JSON.stringify(entity);
    // No prices or currency amounts in the structured data.
    expect(serializedEntity).not.toMatch(/price/i);
    expect(serializedEntity).not.toMatch(/[$₹€£]\s?\d/);
    // No fabricated search results, no live-provider guarantees, no
    // advertiser-specific claims. ("Provider" itself is allowed — the honest
    // caveat "Provider coverage and freshness vary." is part of the copy.)
    expect(serializedEntity).not.toContain('"ads"');
    expect(serializedEntity).not.toContain('"results"');
    expect(serializedEntity).not.toMatch(/guarantee|advertiser/i);
    // No unsupported FAQPage or SoftwareApplication entities.
    expect(serializedEntity).not.toContain("FAQPage");
    expect(serializedEntity).not.toContain("SoftwareApplication");
    expect(serializedEntity).not.toContain("SearchAction");
  });
});
