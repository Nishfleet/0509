/**
 * /search ↔ /switch/* cross-link contract (issue 1554).
 *
 * When a searched brand domain resolves to a known switch target (MagicBrief,
 * Panoramata, Visualping), the /search results render a "Switching from X?"
 * card above the fold linking to the honest /switch/* destination, and the
 * /competitor-monitoring hub lists every switch page so the first-value moment
 * hands off to discovery instead of only outreach.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SWITCH_PAGES,
  switchPageForDomain,
  SWITCH_SLUGS,
} from "~/lib/switch-pages";
import { emptyCompetitorWebsite } from "~/lib/competitor-website";
import { buildIdleSearchResult } from "~/lib/search-display";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;
type MockLocation = { pathname: string; search: string; hash: string };

function baseSearchLoaderData(overrides: Record<string, unknown> = {}) {
  return {
    mode: "advertiser" as const,
    filters: {
      query: "visualping.io",
      country: "all",
      platform: "all",
      creativeType: "all" as const,
      status: "all" as const,
      firstSeenFrom: "",
      lastSeenFrom: "",
    },
    fingerprint: "fp-visualping",
    result: { ...buildIdleSearchResult(), discoveryStatus: "demo" as const },
    selectedAd: null,
    stealSummary: null,
    selectionEnrichmentPending: false,
    collections: [],
    plan: null,
    session: null,
    competitorWebsite: emptyCompetitorWebsite(),
    trackingRole: "competitor" as const,
    inputError: null,
    searchScope: "exact" as const,
    displayDomain: null,
    brandPageLink: null,
    switchPage: null,
    relevanceApplied: false,
    watchedWatchlist: null,
    showOpsNav: false,
    showPresenceNav: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement(
          "a",
          { ...props, href: typeof to === "string" ? to : "" },
          children,
        ),
      useActionData: vi.fn().mockReturnValue(undefined),
      useLoaderData: vi.fn().mockReturnValue(baseSearchLoaderData()),
      useLocation: vi.fn().mockReturnValue({
        pathname: "/search",
        search: "?q=visualping.io",
        hash: "",
      }),
      useNavigate: vi.fn().mockReturnValue(vi.fn()),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
      useRevalidator: vi.fn().mockReturnValue({ state: "idle", revalidate: vi.fn() }),
      useRouteLoaderData: vi.fn().mockReturnValue({ session: null }),
    };
  });

  vi.doMock("~/components/dashboard-shell", () => ({
    DashboardShell: ({ children }: { children: ReactNode }) =>
      createElement("main", null, children),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("switchPageForDomain domain mapping", () => {
  it("maps the three switch-target domains to their /switch/* pages", () => {
    expect(switchPageForDomain("visualping.io")?.pathname).toBe("/switch/visualping");
    expect(switchPageForDomain("www.visualping.io")?.pathname).toBe("/switch/visualping");
    expect(switchPageForDomain("magicbrief.com")?.pathname).toBe("/switch/magicbrief");
    expect(switchPageForDomain("panoramata.co")?.pathname).toBe("/switch/panoramata");
  });

  it("returns null for a non-switch domain", () => {
    expect(switchPageForDomain("nike.com")).toBeNull();
    expect(switchPageForDomain("")).toBeNull();
  });
});

describe("/search switch-target card", () => {
  it("renders a 'Switching from X?' card above the fold for a matching domain", async () => {
    const reactRouter = (await import("react-router")) as unknown as {
      useLoaderData: ReturnType<typeof vi.fn>;
    };
    reactRouter.useLoaderData.mockReturnValue(
      baseSearchLoaderData({ switchPage: SWITCH_PAGES.visualping }),
    );

    const { default: SearchRoute } = await import("~/routes/search");
    const markup = renderToStaticMarkup(createElement(SearchRoute));

    expect(markup).toMatch(/Switching from Visualping\?/i);
    expect(markup).toMatch(/\/switch\/visualping/);
    // Attribution (accept #2): the card link carries UTM params.
    expect(markup).toContain("utm_source=search");
    expect(markup).toContain("utm_campaign=switch_to_0509");
  });

  it("does not render the card when the searched domain is not a switch target", async () => {
    const reactRouter = (await import("react-router")) as unknown as {
      useLoaderData: ReturnType<typeof vi.fn>;
    };
    reactRouter.useLoaderData.mockReturnValue(baseSearchLoaderData());

    const { default: SearchRoute } = await import("~/routes/search");
    const markup = renderToStaticMarkup(createElement(SearchRoute));

    expect(markup).not.toMatch(/Switching from visualping/i);
    // The card is the conditional surface (issue 1554); the always-present
    // /switch/* nav strip (issue 1466) legitimately links every switch page
    // regardless of the searched domain, so target the card container only.
    expect(markup).not.toMatch(/class="f9-switch-cta"/);
    expect(markup).not.toMatch(/utm_campaign=switch_to_0509/);
  });
});

describe("/competitor-monitoring switch hub section", () => {
  it("links every switch page from the hub", async () => {
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");
      return {
        ...actual,
        useRouteLoaderData: () => undefined,
        useLoaderData: () => ({ proofBrief: null, indexableAdsLinks: [] }),
        useLocation: () => ({ pathname: "/competitor-monitoring" }),
        Link: ({ children, to, ...props }: MockLinkProps) =>
          React.createElement(
            "a",
            { ...props, href: typeof to === "string" ? to : "" },
            children,
          ),
        Form: ({ children, ...props }: MockFormProps) =>
          React.createElement("form", props, children),
      };
    });

    const { default: CompetitorMonitoringRoute } =
      await import("~/routes/competitor-monitoring");
    const markup = renderToStaticMarkup(createElement(CompetitorMonitoringRoute));

    expect(markup).toMatch(/Switching to 0509\?/);
    for (const slug of SWITCH_SLUGS) {
      expect(markup).toContain(`/switch/${slug}`);
    }
  });
});
