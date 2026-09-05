import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Dedicated route-render test for the /search WebPage JSON-LD. Kept in its
// own file (not tests/funnel-seo.test.ts, which already registers a file-level
// react-router mock) so this surface owns exactly one mock registration,
// mirroring the shape of tests/search-warming-state.test.ts.

const SEARCH_TITLE = "Search competitor Meta ads free | Five to Nine";
const SEARCH_DESCRIPTION =
  "Preview public competitor ad results before creating an account; sign in to save examples and track offer changes over time. Provider coverage and freshness vary.";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

// The idle pre-search loader payload: an anonymous visitor on /search with
// no query, no website, and nothing searched yet.
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
  fingerprint: "fnv1a-idle",
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
  trackingRole: "competitor" as const,
  inputError: null,
  searchScope: "exact" as const,
  displayDomain: null,
  relevanceApplied: false,
  watchedWatchlist: null,
  showPresenceNav: false,
};

async function renderIdleSearch() {
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

  const { default: SearchRoute } = await import("~/routes/search");
  return renderToStaticMarkup(createElement(SearchRoute));
}

/** All JSON-LD blocks rendered on the page, parsed back into objects. */
function parsedJsonLdBlocks(markup: string): unknown[] {
  const scriptPattern = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  const blocks: unknown[] = [];
  for (const match of markup.matchAll(scriptPattern)) {
    blocks.push(JSON.parse(match[1] ?? ""));
  }
  return blocks;
}

/** Every schema.org @type on the page, top-level and nested. */
function collectTypes(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTypes(item, into);
    }
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "@type" && typeof entry === "string") {
        into.push(entry);
      } else {
        collectTypes(entry, into);
      }
    }
  }
  return into;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("/search — truthful WebPage JSON-LD", () => {
  it("emits exactly one WebPage block matching the document head", async () => {
    const markup = await renderIdleSearch();
    const blocks = parsedJsonLdBlocks(markup);

    expect(blocks).toHaveLength(1);
    const [webPage] = blocks as [Record<string, unknown>];

    expect(webPage["@context"]).toBe("https://schema.org");
    expect(webPage["@type"]).toBe("WebPage");
    // name/description/url mirror the publicSeoMeta document head exactly.
    expect(webPage.name).toBe(SEARCH_TITLE);
    expect(webPage.description).toBe(SEARCH_DESCRIPTION);
    expect(webPage.url).toBe("https://0509.io/search");
    expect(webPage.isPartOf).toMatchObject({ "@type": "WebSite", name: "Five to Nine" });
    expect(webPage.publisher).toMatchObject({ "@type": "Organization", name: "Five to Nine" });
  });

  it("uses the same strings as the page meta function", async () => {
    const markup = await renderIdleSearch();
    const [webPage] = parsedJsonLdBlocks(markup) as [Record<string, unknown>];

    const { meta } = await import("~/routes/search");
    const serializedHead = JSON.stringify((meta as () => unknown)());

    // The head title/description appear verbatim in the JSON-LD block.
    expect(serializedHead).toContain(SEARCH_TITLE);
    expect(serializedHead).toContain(SEARCH_DESCRIPTION);
    expect(webPage.name).toBe(SEARCH_TITLE);
    expect(webPage.description).toBe(SEARCH_DESCRIPTION);
  });

  it("claims no result lists, prices, ratings, or unsupported types", async () => {
    const markup = await renderIdleSearch();
    const blocks = parsedJsonLdBlocks(markup);

    // WebPage is the only top-level entity; WebSite and Organization appear
    // only as the isPartOf/publisher scaffolding every WebPage block has.
    expect(collectTypes(blocks)).toEqual(["WebPage", "WebSite", "Organization"]);

    const serialized = JSON.stringify(blocks);
    expect(serialized).not.toMatch(/[$₹€£]\s?\d/);
    // No invented result counts, freshness, or coverage numbers — the idle
    // page has none of those visible claims.
    expect(serialized).not.toMatch(/\d+\s+ads?\b/i);
    expect(serialized).not.toMatch(/guarantee|rating|ranked/i);
  });
});
