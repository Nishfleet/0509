import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emptyCompetitorWebsite } from "~/lib/competitor-website";
import { buildIdleSearchResult } from "~/lib/search-display";

// Dedicated route-render surface for the public /search WebPage JSON-LD.
// Single react-router mock registration at file level (the route renders the
// idle pre-search state only), mirroring tests/search-warming-state.test.ts —
// a second describe-level mock is what made funnel-seo-style double mocks flake.

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

// The loader's "no query" return: the idle public search page.
const idleLoaderData = {
  mode: "advertiser" as const,
  filters: {
    query: "",
    country: "all",
    platform: "all",
    creativeType: "all" as const,
    status: "all" as const,
    firstSeenFrom: "",
    lastSeenFrom: "",
  },
  fingerprint: "fp-structured-data-idle",
  result: buildIdleSearchResult(),
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

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) => React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useActionData: vi.fn().mockReturnValue(undefined),
      useLoaderData: vi.fn().mockReturnValue(idleLoaderData),
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
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

function parseSingleLdJson(markup: string): Record<string, unknown> {
  const match = markup.match(/type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!match?.[1]) {
    throw new Error("No application/ld+json block found in markup");
  }
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("public /search WebPage JSON-LD", () => {
  it("renders exactly one truthful WebPage JSON-LD aligned with the document head", async () => {
    const { default: SearchRoute, meta } = await import("~/routes/search");
    const markup = renderToStaticMarkup(createElement(SearchRoute));

    // Sanity: the idle search page actually rendered.
    expect(markup).toContain("Find competitor ads");

    const ldJsonTags = markup.match(/type="application\/ld\+json"/g) ?? [];
    expect(ldJsonTags).toHaveLength(1);

    const ldJson = parseSingleLdJson(markup);
    expect(ldJson["@context"]).toBe("https://schema.org");
    expect(ldJson["@type"]).toBe("WebPage");
    expect(ldJson.name).toBe("Search competitor Meta ads free | Five to Nine");
    expect(ldJson.url).toBe("https://0509.io/search");
    expect(ldJson.isPartOf).toEqual({
      "@type": "WebSite",
      name: "Five to Nine",
      url: "https://0509.io",
    });

    // Same strings as the document head (publicSeoMeta title/description).
    const head = (meta as unknown as () => Array<{ title?: string; name?: string; content?: string }>)();
    const title = head.find((entry) => "title" in entry)?.title ?? "";
    const description = head.find((entry) => entry.name === "description")?.content ?? "";
    expect(ldJson.name).toBe(title);
    expect(ldJson.description).toBe(description);
  });

  it("asserts no unsupported schema types or invented claims in the JSON-LD", async () => {
    const { default: SearchRoute } = await import("~/routes/search");
    const markup = renderToStaticMarkup(createElement(SearchRoute));
    const ldJson = parseSingleLdJson(markup);
    const serialized = JSON.stringify(ldJson);

    // The idle page states no results, prices, guarantees, or advertiser
    // rankings — the WebPage payload must not either.
    for (const unsupported of [
      "AggregateRating",
      "Product",
      "Offer",
      "Review",
      "Rating",
      "FAQPage",
      "ItemList",
      "SearchAction",
    ]) {
      expect(serialized).not.toContain(`"@type":"${unsupported}"`);
    }
    expect(serialized).not.toMatch(/price|offerCount|ratingValue|numberOfAds|resultCount/i);
    expect(serialized).not.toMatch(/[$₹€£]\s?\d/);
    expect(Object.keys(ldJson)).not.toContain("mainEntity");
  });
});
