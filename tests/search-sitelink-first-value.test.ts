import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  hasInvalidCompetitorWebsite,
  normalizeCompetitorWebsiteInput,
} from "~/lib/competitor-website";
import { buildIdleSearchResult } from "~/lib/search-display";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

function fillSearchActionTemplate(urlTemplate: string, term: string): string {
  return urlTemplate.replace(/\{[^}]+\}/g, encodeURIComponent(term));
}

const nikeWebsite = normalizeCompetitorWebsiteInput("nike.com");

const nikeWebsiteLoaderData = {
  mode: "advertiser" as const,
  filters: {
    query: nikeWebsite.searchTerm ?? "nike",
    country: "all",
    platform: "all",
    creativeType: "all" as const,
    status: "all" as const,
    firstSeenFrom: "",
    lastSeenFrom: "",
  },
  fingerprint: "fp-nike-website",
  result: { ...buildIdleSearchResult(), discoveryStatus: "demo" as const },
  selectedAd: null,
  stealSummary: null,
  selectionEnrichmentPending: false,
  collections: [],
  plan: null,
  session: null,
  competitorWebsite: nikeWebsite,
  trackingRole: "competitor" as const,
  inputError: null,
  searchScope: "exact" as const,
  displayDomain: nikeWebsite.host,
  relevanceApplied: false,
  watchedWatchlist: null,
  showOpsNav: false,
  showPresenceNav: false,
};

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
      useLoaderData: vi.fn().mockReturnValue(nikeWebsiteLoaderData),
      useLocation: vi.fn().mockReturnValue({
        pathname: "/search",
        search: "?website=nike.com",
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

describe("homepage SearchAction sitelink first value", () => {
  it("fills the SearchAction template with nike into a URL that actually searches", async () => {
    const { webSiteJsonLd } = await import("~/lib/seo");
    const urlTemplate = webSiteJsonLd().potentialAction.target.urlTemplate;
    const filled = fillSearchActionTemplate(urlTemplate, "nike");
    const filledUrl = new URL(filled);
    const searchTerm =
      filledUrl.searchParams.get("q") ?? filledUrl.searchParams.get("query");

    expect(searchTerm).toBe("nike");
    expect(
      hasInvalidCompetitorWebsite(
        normalizeCompetitorWebsiteInput(filledUrl.searchParams.get("website") ?? ""),
      ),
    ).toBe(false);
  });

  it("names the brand in the search-command H1 for a valid website=nike.com landing", async () => {
    const { default: SearchRoute } = await import("~/routes/search");
    const markup = renderToStaticMarkup(createElement(SearchRoute));
    const h1Match = markup.match(
      /<h1[^>]*id="search-command-title"[^>]*>([^<]+)<\/h1>/,
    );
    const title = h1Match?.[1] ?? "";

    expect(title).toMatch(/Nike/i);
    expect(title).not.toBe("Find competitor ads");
  });
});
