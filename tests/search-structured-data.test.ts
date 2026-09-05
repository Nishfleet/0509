import { readFileSync } from "node:fs";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emptyCompetitorWebsite } from "~/lib/competitor-website";
import { parseSearchParams } from "~/lib/normalize";
import { buildIdleSearchResult } from "~/lib/search-display";
import { publicSeoMeta } from "~/lib/seo";

// Dedicated route-render test for the /search WebPage JSON-LD. Kept OUT of
// tests/funnel-seo.test.ts (which already registers a file-level react-router
// mock — a second describe-level mock of the same module flakes on Vitest 4).
// Single mock registration, same shape as tests/search-warming-state.test.ts.

const SEARCH_TITLE = "Search competitor Meta ads free | Five to Nine";
const SEARCH_DESCRIPTION =
  "Preview public competitor ad results before creating an account; sign in to save examples and track offer changes over time. Provider coverage and freshness vary.";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

// The same pure helpers the route loader uses for the anonymous idle path
// (no query, no session), so the fixture is the real idle render input —
// not a hand-shaped approximation.
const idleSearch = parseSearchParams(new URLSearchParams(), { country: "all" });
const idleLoaderData = {
  mode: idleSearch.mode,
  filters: idleSearch.filters,
  fingerprint: idleSearch.fingerprint,
  result: buildIdleSearchResult(),
  selectedAd: null,
  stealSummary: null,
  selectionEnrichmentPending: false,
  collections: [],
  plan: null,
  session: null,
  competitorWebsite: emptyCompetitorWebsite(),
  trackingRole: "competitor",
  inputError: null,
  searchScope: "exact",
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
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
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

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("public /search WebPage JSON-LD", () => {
  it("renders exactly one application/ld+json WebPage aligned with the head meta", async () => {
    const markup = await renderIdleSearch();

    const scriptTags = markup.match(
      /<script type="application\/ld\+json">[\s\S]*?<\/script>/g,
    );
    expect(scriptTags).toHaveLength(1);

    const jsonLd = JSON.parse(
      scriptTags![0]!
        .replace(/^<script type="application\/ld\+json">/, "")
        .replace(/<\/script>$/, ""),
    );

    expect(jsonLd["@context"]).toBe("https://schema.org");
    expect(jsonLd["@type"]).toBe("WebPage");

    // Same strings the document head already carries via publicSeoMeta.
    const headMeta = publicSeoMeta({
      title: SEARCH_TITLE,
      description: SEARCH_DESCRIPTION,
      pathname: "/search",
    });
    const headTitle = headMeta[0] as { title: string };
    const headDescription = headMeta.find(
      (entry) => (entry as { name?: string }).name === "description",
    ) as { content: string };
    expect(jsonLd.name).toBe(headTitle.title);
    expect(jsonLd.description).toBe(headDescription.content);
    expect(jsonLd.url).toBe("https://0509.io/search");
    expect(jsonLd.isPartOf["@type"]).toBe("WebSite");
    expect(jsonLd.publisher["@type"]).toBe("Organization");
  });

  it("makes no result-list, price, rating, or guarantee claims in the JSON-LD", async () => {
    const markup = await renderIdleSearch();
    const scriptTags = markup.match(
      /<script type="application\/ld\+json">[\s\S]*?<\/script>/g,
    );
    expect(scriptTags).toHaveLength(1);

    const serialized = scriptTags![0]!.replace(
      /^<script type="application\/ld\+json">/,
      "",
    ).replace(/<\/script>$/, "");
    // Unsupported/over-claiming schema types must never appear.
    for (const unsupported of [
      "Product",
      "Offer",
      "AggregateRating",
      "ItemList",
      "SearchResultsPage",
      "Service",
    ]) {
      expect(serialized).not.toContain(`"@type": "${unsupported}"`);
    }
    expect(serialized).not.toMatch(/price|ratingValue|resultCount|numberOfItems|guarantee|rank/i);
    expect(serialized).not.toMatch(/[$₹€£]\s?\d/);
  });

  it("wires the script from the shared description const and head title", () => {
    const source = readFileSync("app/routes/search.tsx", "utf8");

    // The same const feeds both the document head and the JSON-LD, and the
    // JSON-LD name is the same literal the head title uses.
    expect(source.match(/description: searchDescription/g)).toHaveLength(2);
    expect(source).toContain(`title: "${SEARCH_TITLE}"`);
    expect(source).toContain(`name: "${SEARCH_TITLE}"`);
    expect(source).toContain("webPageJsonLd(");
    expect(source).toContain('pathname: "/search"');
  });
});
