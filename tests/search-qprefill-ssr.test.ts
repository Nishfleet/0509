import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emptyCompetitorWebsite } from "~/lib/competitor-website";
import { buildIdleSearchResult } from "~/lib/search-display";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

const qPrefillLoaderData = {
  mode: "advertiser" as const,
  filters: {
    query: "nike",
    country: "all",
    platform: "all",
    creativeType: "all" as const,
    status: "all" as const,
    firstSeenFrom: "",
    lastSeenFrom: "",
  },
  fingerprint: "fp-nike-all",
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
  relevanceApplied: false,
  watchedWatchlist: null,
  showOpsNav: false,
  showPresenceNav: false,
};

const idleLoaderData = {
  ...qPrefillLoaderData,
  filters: { ...qPrefillLoaderData.filters, query: "" },
  fingerprint: "fp-idle",
  result: buildIdleSearchResult(),
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
      useLoaderData: vi.fn().mockReturnValue(qPrefillLoaderData),
      useLocation: vi.fn().mockReturnValue({
        pathname: "/search",
        search: "?q=nike&country=all",
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

describe("public /search q= and country= SSR heading and input", () => {
  it("renders an H1 that names the buyer's intent and moves the country scope to the annotation under the H1", async () => {
    const { default: SearchRoute } = await import("~/routes/search");
    const markup = renderToStaticMarkup(createElement(SearchRoute));

    // Issue #1502: the H1 names the buyer's intent ("What Nike is running on
    // Meta") and never carries the technical country-scope phrases.
    const h1Match = markup.match(/<h1[^>]*>([^<]+)<\/h1>/);
    expect(h1Match?.[1]?.replace(/&#x27;/g, "'")).toBe(
      "What Nike is running on Meta",
    );
    expect(h1Match?.[1] ?? "").not.toContain("across all countries");
    expect(h1Match?.[1] ?? "").not.toContain("all-countries query");
    // The country scope moved to the small annotation line under the H1.
    expect(markup).toContain("Across all countries");
    expect(markup).not.toContain("in all countries");
    // Issue 1759: the results view (a ?q= search) links the /brands hub as
    // a crawlable anchor, so the issue's verify command against
    // /search?q=nike&country=all passes.
    expect(markup).toContain('href="/brands"');
    expect(markup).toContain("Browse all tracked brands");
  });

  it("pre-fills the competitor website input with the q value", async () => {
    const { default: SearchRoute } = await import("~/routes/search");
    const markup = renderToStaticMarkup(createElement(SearchRoute));

    const inputMatch = markup.match(/<input[^>]*name="website"[^>]*>/i);
    expect(inputMatch?.[0]).toMatch(/value="nike"/i);
  });

  it("keeps the idle heading and empty input when no query is present", async () => {
    const reactRouter = (await import("react-router")) as unknown as {
      useLoaderData: ReturnType<typeof vi.fn>;
      useLocation: ReturnType<typeof vi.fn>;
    };
    reactRouter.useLoaderData.mockReturnValue(idleLoaderData);
    reactRouter.useLocation.mockReturnValue({
      pathname: "/search",
      search: "",
      hash: "",
    });

    const { default: SearchRoute } = await import("~/routes/search");
    const markup = renderToStaticMarkup(createElement(SearchRoute));

    expect(markup).toContain("Find competitor ads");
    const inputMatch = markup.match(/<input[^>]*name="website"[^>]*>/i);
    expect(inputMatch?.[0]).not.toMatch(/value="[^"]+"/);
    // Issue 1759: the idle pre-search state links the /brands hub as a
    // crawlable anchor.
    expect(markup).toContain('href="/brands"');
    expect(markup).toContain("Browse all tracked brands");
  });

  it("keeps the document canonical on /search without query parameters", async () => {
    const { links } = await import("~/routes/search");
    expect(links()).toEqual([{ rel: "canonical", href: "https://0509.io/search" }]);
  });
});
