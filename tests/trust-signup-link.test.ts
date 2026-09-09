// @vitest-environment happy-dom

/**
 * Trust-proof surface lock — issue #2049.
 *
 * The product shipped its two best trust assets as pages (/no-phantom-changes
 * and /capture-rules) but left them invisible at the conversion moments where
 * a visitor is actually asked for an email: the anonymous signup gate after
 * /search and /pricing. This file pins that both surfaces now render the
 * compact proof-trust element (the honest one-line promise plus the two links)
 * at the decision point.
 *
 * The verify gate in the issue reads:
 *   curl -sS https://0509.io/pricing | grep -c 'no-phantom-changes'
 *   npx vitest run tests/trust-signup-link.test.ts
 */

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = {
  children?: ReactNode;
  to?: string;
} & Record<string, unknown>;

// Shared mockable hooks: the pricing route reads loader/root data, the search
// route reads a richer loader shape. Both are resolved at render time.
let loaderData: Record<string, unknown>;
let rootData: Record<string, unknown>;
let locationObj: { pathname: string; search: string; hash: string };
let navigationState: {
  state: string;
  location?: { pathname: string; search: string } | null;
};

function mockRouter() {
  vi.doMock("react-router", async () => {
    const actual =
      await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", {
          ...props,
          href: typeof to === "string" ? to : "",
        }, children),
      useActionData: () => undefined,
      useLoaderData: () => loaderData,
      useLocation: () => locationObj,
      useNavigate: () => vi.fn(),
      useNavigation: () => navigationState,
      useRevalidator: () => ({ state: "idle", revalidate: vi.fn() }),
      useRouteLoaderData: () => rootData,
    };
  });
  vi.doMock("~/components/dashboard-shell", () => ({
    DashboardShell: ({ children }: { children: ReactNode }) =>
      createElement("main", null, children),
  }));
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const rootDataForPricing: Record<string, unknown> = {
  session: null,
  pricingPlans: [],
  usageBundles: [],
};

/** A search that ran and returned ads → the anonymous signup gate renders. */
const signupGateLoaderData: Record<string, unknown> = {
  mode: "advertiser",
  filters: { query: "nykaa.com", country: "all", platform: "all" },
  fingerprint: "fp-nykaa",
  selectedAd: null,
  stealSummary: null,
  selectionEnrichmentPending: false,
  collections: [],
  plan: null,
  session: null,
  competitorWebsite: {
    raw: "https://nykaa.com",
    normalizedUrl: "https://nykaa.com",
    host: "nykaa.com",
    displayName: "Nykaa",
    searchTerm: "nykaa.com",
    error: null,
  },
  trackingRole: "competitor",
  inputError: null,
  searchScope: "exact",
  displayDomain: "nykaa.com",
  relevanceApplied: false,
  watchedWatchlist: null,
  showOpsNav: false,
  showPresenceNav: false,
  result: {
    ads: [],
    nextCursor: null,
    source: "meta_library_browser",
    provider: "meta_library_browser",
    cacheStatus: "miss",
    discoveryStatus: "healthy",
  },
};

async function renderPricingMarkup(): Promise<string> {
  const { default: PricingRoute } = await import("~/routes/pricing");
  return renderToStaticMarkup(createElement(PricingRoute));
}

async function renderSearchMarkup(): Promise<string> {
  const { default: SearchRoute } = await import("~/routes/search");
  return renderToStaticMarkup(createElement(SearchRoute));
}

beforeEach(() => {
  loaderData = {};
  rootData = { session: null };
  locationObj = { pathname: "/", search: "", hash: "" };
  navigationState = { state: "idle", location: null };
  vi.resetModules();
  mockRouter();
});

describe("TrustProofNote component", () => {
  it("states the honest one-line promise and links both proof pages with readable copy", async () => {
    const { TrustProofNote } = await import("~/components/trust-proof-note");
    const markup = renderToStaticMarkup(createElement(TrustProofNote));
    // The one-line promise, limited to the published guarantee.
    expect(markup).toContain(
      "No phantom changes: if we send it, the page really changed",
    );
    // Readable anchor copy linking to both published proof pages.
    expect(markup).toContain('href="/no-phantom-changes"');
    expect(markup).toContain("Read the capture-validity guarantee");
    expect(markup).toContain('href="/capture-rules"');
    expect(markup).toContain("What counts as a real change");
    // Only one decision-point phrase — no boast beyond the stated guarantee.
    expect(markup.match(/really changed/g)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * The signup wall after /search
 * ------------------------------------------------------------------ */

describe("signup gate (#2049) surfaces the proof trust element", () => {
  it("renders the one-line promise and both trust links at the account ask", async () => {
    loaderData = signupGateLoaderData;
    const markup = await renderSearchMarkup();

    // The honest one-line promise (unique to the trust element).
    expect(markup).toContain(
      "No phantom changes: if we send it, the page really changed",
    );
    // Both published proof pages are linked at the decision point.
    expect(markup).toContain('href="/no-phantom-changes"');
    expect(markup).toContain('href="/capture-rules"');
    // It is at the anonymous signup gate, next to the account ask.
    expect(markup).toContain('class="f9-wk-retain f9-search-signup-cta"');
    expect(markup).toContain("Keep checking this competitor");
  });
});

/* ------------------------------------------------------------------ *
 * /pricing
 * ------------------------------------------------------------------ */

describe("pricing (#/pricing) surfaces the proof trust element", () => {
  it("renders the one-line promise and both trust links on the plans page", async () => {
    loaderData = { pricingPreview: { available: false } };
    rootData = rootDataForPricing;
    const markup = await renderPricingMarkup();

    expect(markup).toContain(
      "No phantom changes: if we send it, the page really changed",
    );
    expect(markup).toContain('href="/no-phantom-changes"');
    expect(markup).toContain('href="/capture-rules"');
  });
});