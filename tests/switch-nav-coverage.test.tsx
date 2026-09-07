import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SWITCH_PAGES, SWITCH_SLUGS } from "~/lib/switch-pages";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

const commercialLaunch = {
  scoutSaleOpen: true,
  starterSaleOpen: true,
  agencySaleOpen: false,
};

/**
 * Issue #1466 — the three switch pages (/switch/magicbrief,
 * /switch/panoramata, /switch/visualping) must be reachable from the public
 * nav on the four high-traffic surfaces: /, /search, /competitor-monitoring,
 * /pricing. Each route's server-rendered markup (excluding the footer) must
 * carry a "from MagicBrief" link inside a <nav> region so a buyer who lands
 * from Google reaches the switch page in one click without a footer scroll.
 */

function mockLink(React: typeof import("react")) {
  return ({ children, to, ...props }: MockLinkProps) =>
    React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children);
}

function mockForm(React: typeof import("react")) {
  return ({ children, ...props }: MockFormProps) => React.createElement("form", props, children);
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("react-router");
  vi.doUnmock("~/components/dashboard-shell");
});

/** Split off the footer so the assertion only sees the primary nav region. */
function beforeFooter(markup: string): string {
  const idx = markup.indexOf("<footer");
  return idx >= 0 ? markup.slice(0, idx) : markup;
}

/** Extract every <nav>…</nav> block from a markup string. */
function navBlocks(markup: string): string[] {
  const blocks: string[] = [];
  let cursor = 0;
  while (cursor < markup.length) {
    const start = markup.indexOf("<nav", cursor);
    if (start < 0) break;
    let depth = 0;
    let end = start;
    while (end < markup.length) {
      if (markup.startsWith("<nav", end)) depth += 1;
      else if (markup.startsWith("</nav>", end)) {
        depth -= 1;
        if (depth === 0) {
          blocks.push(markup.slice(start, end + "</nav>".length));
          break;
        }
      }
      end += 1;
    }
    cursor = end + "</nav>".length;
  }
  return blocks;
}

async function renderMarketingNav(): Promise<string> {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Link: mockLink(React),
      useRouteLoaderData: () => undefined,
    };
  });
  const { MarketingNav } = await import("~/components/marketing-nav");
  return renderToStaticMarkup(createElement(MarketingNav));
}

async function renderMarketingNavOptedOut(): Promise<string> {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Link: mockLink(React),
      useRouteLoaderData: () => undefined,
    };
  });
  const { MarketingNav } = await import("~/components/marketing-nav");
  return renderToStaticMarkup(createElement(MarketingNav, { showSwitchLinks: false }));
}

async function renderMarketing(): Promise<string> {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Form: mockForm(React),
      Link: mockLink(React),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
      useRouteLoaderData: vi.fn().mockReturnValue({
        pricingPlans: [],
        usageBundles: [],
        session: null,
      }),
      useLoaderData: vi.fn().mockReturnValue({
        pricingPreview: { available: false },
        commercialLaunch,
        proofBrief: null,
      }),
    };
  });
  const { default: MarketingRoute } = await import("~/routes/marketing");
  return renderToStaticMarkup(createElement(MarketingRoute));
}

async function renderCompetitorMonitoring(): Promise<string> {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Form: mockForm(React),
      Link: mockLink(React),
      useRouteLoaderData: () => undefined,
      useLoaderData: () => ({ proofBrief: null }),
      useLocation: () => ({ pathname: "/competitor-monitoring", search: "", hash: "" }),
    };
  });
  const { default: Route } = await import("~/routes/competitor-monitoring");
  return renderToStaticMarkup(createElement(Route));
}

async function renderPricing(): Promise<string> {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Link: mockLink(React),
      useRouteLoaderData: () => ({
        pricingPlans: [],
        usageBundles: [],
        session: null,
      }),
      useLoaderData: () => ({
        pricingPreview: { available: false },
        commercialLaunch,
      }),
    };
  });
  const { default: PricingRoute } = await import("~/routes/pricing");
  return renderToStaticMarkup(createElement(PricingRoute));
}

async function renderSearch(): Promise<string> {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Form: mockForm(React),
      Link: mockLink(React),
      useActionData: () => undefined,
      useLoaderData: () => ({
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
        fingerprint: "fp-all",
        result: {
          ads: [],
          nextCursor: null,
          source: "meta_library_browser",
          provider: "meta_library_browser",
          cacheStatus: "miss",
          discoveryStatus: "idle",
          discoverySummary: null,
          discoveryFailureClass: null,
        },
        selectedAd: null,
        resultCaptureAgeLabel: null,
        stealSummary: null,
        selectionEnrichmentPending: false,
        landingPageCaptureFailure: null,
        collections: [],
        plan: null,
        session: null,
        competitorWebsite: {
          raw: "",
          normalizedUrl: null,
          host: null,
          displayName: "",
          searchTerm: "",
          error: null,
        },
        trackingRole: "competitor",
        inputError: null,
        searchScope: "exact",
        displayDomain: null,
        relevanceApplied: false,
        watchedWatchlist: null,
        showOpsNav: false,
        showPresenceNav: false,
      }),
      useLocation: () => ({ pathname: "/search", search: "", hash: "" }),
      useNavigate: () => vi.fn(),
      useNavigation: () => ({ state: "idle" }),
      useRevalidator: () => ({ state: "idle", revalidate: vi.fn() }),
      useRouteLoaderData: () => ({ session: null }),
    };
  });
  vi.doMock("~/components/dashboard-shell", () => ({
    DashboardShell: ({ children }: { children: ReactNode }) =>
      createElement("main", null, children),
  }));
  const { default: SearchRoute } = await import("~/routes/search");
  return renderToStaticMarkup(createElement(SearchRoute));
}

describe("switch-page nav coverage (issue #1466)", () => {
  it("MarketingNav surfaces all three switch pages in the primary nav region when enabled", async () => {
    const markup = await renderMarketingNav();
    const primaryNav = markup.match(/<nav[^>]*aria-label="Primary"[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? "";

    for (const slug of SWITCH_SLUGS) {
      const page = SWITCH_PAGES[slug];
      expect(primaryNav).toContain(`href="${page.pathname}"`);
      expect(primaryNav).toContain(`from ${page.productName}`);
    }
  });

  it("MarketingNav hides switch links when a surface opts out", async () => {
    const markup = await renderMarketingNavOptedOut();
    const primaryNav = markup.match(/<nav[^>]*aria-label="Primary"[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? "";

    for (const slug of SWITCH_SLUGS) {
      const page = SWITCH_PAGES[slug];
      expect(primaryNav).not.toContain(`href="${page.pathname}"`);
      expect(primaryNav).not.toContain(`from ${page.productName}`);
    }
  });

  it("renders a 'from MagicBrief' link in a primary nav region on /", async () => {
    const markup = beforeFooter(await renderMarketing());
    const blocks = navBlocks(markup);
    const hasSwitch = blocks.some(
      (block) => block.includes('href="/switch/magicbrief"') && block.includes("from MagicBrief"),
    );
    expect(hasSwitch, "/ must surface /switch/magicbrief in a <nav> region before the footer").toBe(true);
  });

  it("renders a 'from MagicBrief' link in a primary nav region on /competitor-monitoring", async () => {
    const markup = beforeFooter(await renderCompetitorMonitoring());
    const blocks = navBlocks(markup);
    const hasSwitch = blocks.some(
      (block) => block.includes('href="/switch/magicbrief"') && block.includes("from MagicBrief"),
    );
    expect(
      hasSwitch,
      "/competitor-monitoring must surface /switch/magicbrief in a <nav> region before the footer",
    ).toBe(true);
  });

  it("renders a 'from MagicBrief' link in a primary nav region on /pricing", async () => {
    const markup = beforeFooter(await renderPricing());
    const blocks = navBlocks(markup);
    const hasSwitch = blocks.some(
      (block) => block.includes('href="/switch/magicbrief"') && block.includes("from MagicBrief"),
    );
    expect(hasSwitch, "/pricing must surface /switch/magicbrief in a <nav> region before the footer").toBe(true);
  });

  it("renders a 'from MagicBrief' link in a nav region on /search", async () => {
    const markup = beforeFooter(await renderSearch());
    const blocks = navBlocks(markup);
    const hasSwitch = blocks.some(
      (block) => block.includes('href="/switch/magicbrief"') && block.includes("from MagicBrief"),
    );
    expect(hasSwitch, "/search must surface /switch/magicbrief in a <nav> region before the footer").toBe(true);
  });

  it("the /search and /competitor-monitoring inline strip surfaces all three switch pages", async () => {
    const searchMarkup = beforeFooter(await renderSearch());
    const cmMarkup = beforeFooter(await renderCompetitorMonitoring());
    for (const slug of SWITCH_SLUGS) {
      const page = SWITCH_PAGES[slug];
      expect(searchMarkup).toContain(`href="${page.pathname}"`);
      expect(searchMarkup).toContain(`from ${page.productName}`);
      expect(cmMarkup).toContain(`href="${page.pathname}"`);
      expect(cmMarkup).toContain(`from ${page.productName}`);
    }
  });

  it("no switch nav link is gated behind sign-in or JS-only hover (plain server-rendered links)", async () => {
    const marketing = await renderMarketing();
    const cm = await renderCompetitorMonitoring();
    const pricing = await renderPricing();
    const search = await renderSearch();
    for (const markup of [marketing, cm, pricing, search]) {
      const preFooter = beforeFooter(markup);
      // The switch links are plain <a> tags with href="/switch/...", not
      // button/onclick constructs that need JS to navigate.
      const switchAnchor = preFooter.match(/<a[^>]*href="\/switch\/magicbrief"[^>]*>/);
      expect(switchAnchor, "switch link must be a plain <a href> anchor").not.toBeNull();
      expect(switchAnchor?.[0]).not.toMatch(/onclick=|role="button"/);
    }
  });
});
