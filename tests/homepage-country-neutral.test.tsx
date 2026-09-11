// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// React 19's act() only works in an explicit act environment; happy-dom does
// not set this itself. Required for the mounted-route assertions below.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;
type MockFormProps = { children?: ReactNode } & Record<string, unknown>;

/**
 * Issue #2696. The worker stamps `public, max-age=300` + `vary: cookie` on
 * anonymous `/` (issue #2389), and `vary: cookie` does NOT separate anonymous
 * visitors — so the homepage loader must embed NO country-resolved content.
 * Before this fix the loader picked `featuredDomain` and `proofBrief` from
 * `cf-ipcountry` (India → nykaa, everyone else → nike), so a US-rendered
 * shared-cache entry could be replayed to an Indian visitor for the 5-minute
 * max-age. Accept: the anonymous `/` loader data is identical for every
 * market (country-neutral), and the client personalizes via /api/demo-proof.
 */

const mockBriefModule = () => {
  vi.doMock("~/lib/public-proof.server", () => ({
    loadPublicProofBrief: vi.fn().mockRejectedValue(
      new Error("must not be called from the homepage loader under a shared cache"),
    ),
    PUBLIC_PROOF_FEATURED_WEBSITE: "nykaa.com",
    PUBLIC_HOME_NEUTRAL_FEATURED_WEBSITE: "nike.com",
    featuredWebsiteForVisitorCountry: vi.fn(() => "nike.com"),
  }));
};

const mockLoaderDependencies = () => {
  vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
  vi.doMock("~/lib/commercial-launch-gate.server", () => ({
    publicCommercialLaunchSummary: vi.fn(() => ({
      scoutSaleOpen: true,
      starterSaleOpen: true,
      agencySaleOpen: false,
    })),
  }));
  vi.doMock("~/lib/funnel-measurement.server", () => ({
    emitFunnelHomeView: vi.fn(),
  }));
  vi.doMock("~/lib/ads-internal-links.server", () => ({
    loadIndexableAdsInternalLinks: vi.fn().mockResolvedValue([]),
  }));
  vi.doMock("~/lib/public-change-mark.server", () => ({
    loadPublicChangeMark: vi.fn().mockResolvedValue(null),
  }));
  mockBriefModule();
};

function makeLoaderRequest(country: string | null) {
  return new Request("https://0509.io/", country ? { headers: { "cf-ipcountry": country } } : {});
}

describe("homepage loader is country-neutral under the shared cache (#2696)", () => {
  beforeEach(() => {
    vi.resetModules();
    mockLoaderDependencies();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns IDENTICAL loader data with an Indian, an American, or no geo header", async () => {
    const { loader } = await import("~/routes/marketing");
    const context = { cloudflare: { env: {} } };

    const india = await loader({
      context,
      request: makeLoaderRequest("IN"),
    } as never);
    const usa = await loader({
      context,
      request: makeLoaderRequest("US"),
    } as never);
    const anonymous = await loader({
      context,
      request: makeLoaderRequest(null),
    } as never);

    // The replay defect: any country-resolved field makes one market's
    // shared-cache entry servable to another market for max-age=300.
    expect(india).toEqual(usa);
    expect(india).toEqual(anonymous);
  });

  it("pins the neutral flagship brand and embeds no proof brief", async () => {
    const { loader } = await import("~/routes/marketing");

    const result = await loader({
      context: { cloudflare: { env: {} } },
      request: makeLoaderRequest("IN"),
    } as never);

    expect(result.featuredDomain).toBe("nike.com");
    expect(result.proofBrief).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Client personalization: after mount the route fetches the EXISTING
// /api/demo-proof endpoint and swaps in the visitor's own featured brand and
// proof brief (#2281 re-applied client-side, with the #1468 parity ladder the
// endpoint shares with /ads/:domain).
// ---------------------------------------------------------------------------

const nykaaBrief = {
  status: "live",
  competitorName: "Nykaa",
  website: "nykaa.com",
  adLibraryCountry: "India",
  fetchedAt: "2026-09-11T06:00:00.000Z",
  checkedAgoLabel: "about an hour ago",
  freshForLiveClaim: true,
  adCount: 6,
  activeAdCount: 4,
  summary: "6 public Meta ads link to nykaa.com in the India Ad Library.",
  decision: {
    subject: "4 of 6 cached ads are active on record",
    whatChanged: "The most repeated hook is “Routine-first bundle”.",
    whyItMatters: "These creatives are the angle Nykaa has on record.",
    priority: "Review before the next campaign refresh",
    proofStatus: "Captured from the India Ad Library",
    source: "Meta Ad Library (public archive) — the India Ad Library",
    freshness: "Last checked about an hour ago",
    nextAction: "Open the same ad in the India Ad Library",
  },
  proofTrail: [],
  insights: { topHooks: [], mediaMix: [], timeline: [] },
  reportRows: [],
};

function mockMarketingDependencies(loaderData: {
  proofBrief: unknown;
  featuredDomain: string;
  indexableAdsLinks: unknown[];
}) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
      useLoaderData: () => loaderData,
      useRouteLoaderData: () => ({
        session: null,
        pricingPlans: [],
        usageBundles: [],
      }),
    };
  });
  vi.doMock("~/components/marketing-nav", () => ({
    MarketingNav: () => createElement("nav", { "aria-label": "Primary" }),
  }));
  vi.doMock("~/components/marketing-footer", () => ({
    MarketingFooter: () => createElement("footer"),
  }));
  vi.doMock("~/components/submit-button", () => ({
    SubmitButton: ({ children }: { children?: ReactNode }) => createElement("button", null, children),
  }));
  vi.doMock("~/components/ads/ad-creative", () => ({
    AdCreative: () => createElement("div", { className: "mock-ad-creative" }),
  }));
}

/**
 * happy-dom has no layout engine; marketing's reveal-motion effect needs an
 * IntersectionObserver. Capture instances without firing (motion is not what
 * these tests pin).
 */
function installInertIntersectionObserver(): void {
  class FakeIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null;
    readonly rootMargin = "";
    readonly thresholds: ReadonlyArray<number> = [];
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  (globalThis as { IntersectionObserver: unknown }).IntersectionObserver = FakeIntersectionObserver;
}

const neutralLoaderData = {
  pricingPreview: { available: false },
  commercialLaunch: { scoutSaleOpen: true, starterSaleOpen: true, agencySaleOpen: false },
  proofBrief: null,
  changeMark: null,
  indexableAdsLinks: [],
  featuredDomain: "nike.com",
};

async function renderMarketingRoute(): Promise<{ root: Root; getMarkup: () => string }> {
  const { default: MarketingRoute } = await import("~/routes/marketing");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let markup = "";
  await act(async () => {
    root.render(createElement(MarketingRoute));
  });
  const getMarkup = () => {
    markup = container.innerHTML;
    return markup;
  };
  return { root, getMarkup };
}

describe("homepage client personalization via /api/demo-proof (#2696)", () => {
  beforeEach(() => {
    vi.resetModules();
    installInertIntersectionObserver();
    mockMarketingDependencies(neutralLoaderData);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    document.body.innerHTML = "";
  });

  it("fetches /api/demo-proof on mount and personalizes the CTA to the visitor's market", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(nykaaBrief),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getMarkup, root } = await renderMarketingRoute();

    // The route fetched the EXISTING endpoint on mount.
    expect(fetchMock).toHaveBeenCalledWith("/api/demo-proof");

    await act(async () => {});

    // After the fetch resolves the CTA personalizes to the visitor's market
    // (India → nykaa), while the SSR document stays the neutral one — the
    // loader-level tests above pin that every market gets the same HTML.
    expect(getMarkup()).toContain("/search?query=nykaa");
    expect(getMarkup()).toContain("nykaa.com");
    root.unmount();
  });

  it("keeps the neutral flagship when /api/demo-proof reports unavailable or fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status: "unavailable",
          message: "No live proof capture is available right now.",
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getMarkup, root } = await renderMarketingRoute();
    await act(async () => {});

    expect(getMarkup()).toContain("/search?query=nike");
    expect(getMarkup()).not.toContain("/search?query=nykaa");
    root.unmount();
  });
});
