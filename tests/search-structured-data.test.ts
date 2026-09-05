import { readFileSync } from "node:fs";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { webPageJsonLd } from "~/lib/seo";

// Dogfood fce4fa3c00f1: the public /search page used to render zero
// application/ld+json blocks while /status, /help and /docs already emitted a
// schema.org WebPage. This file pins the search page's own truthful WebPage
// entity. Deliberately a NEW dedicated file with a SINGLE file-level
// react-router mock (the pattern from tests/search-warming-state.test.ts) —
// a second describe-level mock inside tests/funnel-seo.test.ts flaked on
// Vitest 4.1.10.
//
// These two strings must stay byte-for-byte identical to the strings the route
// passes to `publicSeoMeta` in its head; the deep-equal against
// `webPageJsonLd(...)` below fails if they drift.
const SEARCH_TITLE = "Search competitor Meta ads free | Five to Nine";
const SEARCH_DESCRIPTION =
  "Preview public competitor ad results before creating an account; sign in to save examples and track offer changes over time. Provider coverage and freshness vary.";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

// The idle public pre-search payload: empty query, no competitor website, and
// the exact result shape `buildIdleSearchResult()` produces (source "demo",
// cacheStatus "none", discoveryStatus "disabled").
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

function jsonLdBlocks(markup: string) {
  const blocks: Array<{ type: string; body: string }> = [];
  for (const match of markup.matchAll(/<script\s+type="([^"]+)">([\s\S]*?)<\/script>/g)) {
    blocks.push({ type: match[1]!, body: match[2]! });
  }
  return blocks;
}

function collectTypes(value: unknown, into: Set<string>) {
  if (Array.isArray(value)) {
    for (const entry of value) collectTypes(entry, into);
    return;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record["@type"] === "string") into.add(record["@type"]);
    for (const entry of Object.values(record)) collectTypes(entry, into);
  }
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("public /search structured data", () => {
  it("emits exactly one WebPage JSON-LD block aligned with the head meta on the idle render", async () => {
    const markup = await renderIdleSearch();

    // The idle page itself still renders — the script addition must not have
    // disturbed the pre-search surface.
    expect(markup).toContain("Nothing searched yet");

    const blocks = jsonLdBlocks(markup).filter(
      (block) => block.type === "application/ld+json",
    );
    expect(blocks).toHaveLength(1);

    const parsed = JSON.parse(blocks[0]!.body) as Record<string, unknown>;
    expect(parsed).toEqual(
      webPageJsonLd({
        name: SEARCH_TITLE,
        description: SEARCH_DESCRIPTION,
        pathname: "/search",
      }),
    );
    expect(parsed["@type"]).toBe("WebPage");
    expect(parsed.name).toBe(SEARCH_TITLE);
    expect(parsed.description).toBe(SEARCH_DESCRIPTION);
    expect(parsed.url).toBe("https://0509.io/search");
  });

  it("claims no unsupported schema types, result lists, prices, or ratings", async () => {
    const markup = await renderIdleSearch();
    const parsed = JSON.parse(
      jsonLdBlocks(markup).find((block) => block.type === "application/ld+json")!.body,
    ) as Record<string, unknown>;

    // Only the entity the page is (WebPage) plus the site and publisher
    // scoping it belongs to — nothing that over-claims the visible page.
    const types = new Set<string>();
    collectTypes(parsed, types);
    expect([...types].sort()).toEqual(["Organization", "WebPage", "WebSite"]);

    // The WebPage carries exactly its name, description, and URL — no room for
    // result counts, prices, guarantees, or advertiser claims.
    expect(Object.keys(parsed).sort()).toEqual([
      "@context",
      "@type",
      "description",
      "isPartOf",
      "name",
      "publisher",
      "url",
    ]);
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toMatch(/price/i);
    expect(serialized).not.toMatch(/[$₹€£]\s?\d/);
    expect(serialized).not.toMatch(/\b(aggregateRating|ratingValue|review)\b/i);
  });

  it("wires the JSON-LD through the shared helpers on the route", async () => {
    const source = readFileSync("app/routes/search.tsx", "utf8");
    expect(source).toContain("jsonLdScriptProps(");
    expect(source).toContain("webPageJsonLd({");
    expect(source).toContain(`name: "${SEARCH_TITLE}"`);
    expect(source).toContain("pathname: \"/search\"");
  });
});
