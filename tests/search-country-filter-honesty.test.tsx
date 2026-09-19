import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

// Issue #3613 regression: the country filter is the first thing a growth
// marketer does ("show me US competitors"). `country=all` and /ads/:brand
// pages carry the Meta EU/UK delivery note, but a named-country wall with no
// ads to show rendered neither results nor the honesty line — a silent
// dead-end one filter-click in (BET 2: "the preview never dead-ends").
// This route-level render asserts a country-filtered SSR with zero results
// still contains the delivery note AND the honest empty-state copy, with the
// selected country named.

function countryFilteredEmptyLoaderData(country: string) {
  return {
    mode: "advertiser" as const,
    filters: {
      query: "nike",
      country,
      platform: "all",
      creativeType: "all" as const,
      status: "all" as const,
      firstSeenFrom: "",
      lastSeenFrom: "",
    },
    fingerprint: `fp-nike-${country}`,
    result: {
      ads: [],
      nextCursor: null,
      source: "meta_library_browser" as const,
      provider: "meta_library_browser" as const,
      cacheStatus: "stale" as const,
      discoveryStatus: "complete" as const,
      discoveryProgress: "complete" as const,
      discoveryEmptyReason: "no_results" as const,
      discoverySummary: null,
      discoveryFailureClass: null,
    },
    selectedAd: null,
    collections: [],
    plan: null,
    session: null,
    competitorWebsite: {
      raw: "https://nike.com",
      normalizedUrl: "https://nike.com",
      host: "nike.com",
      displayName: "Nike",
      searchTerm: "nike.com",
      error: null,
    },
    trackingRole: "competitor" as const,
    inputError: null,
    searchScope: "broader" as const,
    displayDomain: "nike.com",
    relevanceApplied: false,
    watchedWatchlist: null,
    suggestedBrands: [],
    showOpsNav: false,
    showPresenceNav: false,
  };
}

async function renderSearch(data: ReturnType<typeof countryFilteredEmptyLoaderData>) {
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
      useLoaderData: vi.fn().mockReturnValue(data),
      useLocation: vi.fn().mockReturnValue({ pathname: "/search", search: "", hash: "" }),
      useNavigate: vi.fn().mockReturnValue(vi.fn()),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
      useRevalidator: vi.fn().mockReturnValue({ state: "idle", revalidate: vi.fn() }),
      useRouteLoaderData: vi.fn().mockReturnValue({ session: null }),
    };
  });

  vi.doMock("~/components/dashboard-shell", () => ({
    DashboardShell: ({ children }: { children: ReactNode }) => createElement("main", null, children),
  }));

  const { default: SearchRoute } = await import("~/routes/search");
  return renderToStaticMarkup(createElement(SearchRoute));
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("country-filtered /search zero-result honesty (issue #3613)", () => {
  it("renders the EU/UK delivery note and the honest empty-state copy with the country named", async () => {
    const markup = await renderSearch(countryFilteredEmptyLoaderData("Germany"));

    // The Meta EU/UK delivery note is present (the country=all control's copy).
    expect(markup).toContain("EU/UK");
    expect(markup).toContain("only where Meta delivered");
    // The selected country is named in the delivery note.
    expect(markup).toContain("Germany");
    // The honest "not evidence" empty-state copy is present.
    expect(markup).toContain("not evidence that the competitor is inactive");
  });

  it("renders the delivery note for every non-default country, including non-EU markets", async () => {
    for (const country of ["United Kingdom", "France", "us", "Brazil", "India"]) {
      const markup = await renderSearch(countryFilteredEmptyLoaderData(country));
      expect(markup, `${country} must carry the delivery note`).toContain(
        "only where Meta delivered",
      );
    }
  });

  it("does not repeat the delivery note for the unscoped country=all default", async () => {
    // The header annotation already carries it for `all`; the empty-state
    // note is only for a named filter, so `all` must not tell it twice.
    const markup = await renderSearch(countryFilteredEmptyLoaderData("all"));
    expect(markup).toContain("only where Meta delivered");
    expect(markup.match(/only where Meta delivered/g)).toHaveLength(1);
  });
});
