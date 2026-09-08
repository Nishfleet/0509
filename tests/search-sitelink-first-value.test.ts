/**
 * Live-search sitelink first-value contract.
 *
 * Two failure modes, one PR (#1132):
 *
 *  1. Homepage `webSiteJsonLd()` used `?website={website}` so a Google
 *     sitelink substituting `nike` (a brand name) tripped
 *     `hasInvalidCompetitorWebsite` ("incomplete domain") and the visitor
 *     never saw a search. The template now uses schema.org's
 *     `q={search_term_string}` slot, the same shape `parseSearchParams`
 *     already understands as the search term.
 *
 *  2. `/search?website=nike.com` (the live-search CTA on `/ads/nike.com`)
 *     forced the H1 to the idle "Find competitor ads" whenever
 *     `competitorWebsite.raw` was set, so the page looked like it had not
 *     run a search even when 15 verified ads were on it. A valid domain
 *     now names the brand in the H1 via `formatSearchCommandTitle` +
 *     `displayName`. The idle page (no query) keeps the generic title.
 *
 * Watchlist, onboarding, and the website form field still require a real
 * domain — this file does not weaken `normalizeCompetitorWebsiteInput`.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  emptyCompetitorWebsite,
  normalizeCompetitorWebsiteInput,
} from "~/lib/competitor-website";
import { buildIdleSearchResult } from "~/lib/search-display";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

const sitelinkLoaderData = {
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

const validWebsiteLoaderData = {
  ...sitelinkLoaderData,
  filters: { ...sitelinkLoaderData.filters, query: "nike" },
  competitorWebsite: normalizeCompetitorWebsiteInput("nike.com"),
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
      useLoaderData: vi.fn().mockReturnValue(sitelinkLoaderData),
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

/**
 * Substitute `{search_term_string}` (or any `{...}` slot) the way Google's
 * sitelink pipeline does — the literal token in the URL template gets
 * swapped for whatever string the visitor searched. The whole point of
 * the test is that the substituted URL is a real, runnable `/search` URL
 * even when the substitution is a bare brand name.
 */
function fillUrlTemplate(urlTemplate: string, value: string): string {
  return urlTemplate.replace(/\{[a-z_]+\}/g, encodeURIComponent(value));
}

describe("homepage SearchAction live-search sitelink", () => {
  it("emits a search-term slot that a brand name can fill and run a real /search", async () => {
    const { webSiteJsonLd } = await import("~/lib/seo");

    const webSite = JSON.parse(JSON.stringify(webSiteJsonLd()));
    expect(webSite.potentialAction["@type"]).toBe("SearchAction");
    expect(webSite.potentialAction["query-input"]).toBe(
      "required name=search_term_string",
    );

    const urlTemplate: string = webSite.potentialAction.target.urlTemplate;
    const filled = fillUrlTemplate(urlTemplate, "nike");
    const parsed = new URL(filled);
    // The substituted URL must run a search — not trip the
    // incomplete-website form error. A `q`/`query` slot satisfies
    // `parseSearchParams`; any non-`website` slot works too as long as
    // `normalizeCompetitorWebsiteInput` is not asked to validate it.
    expect(parsed.origin + parsed.pathname).toBe("https://0509.io/search");
    expect(parsed.searchParams.get("website")).toBeNull();
    const searchTerm =
      parsed.searchParams.get("q") ?? parsed.searchParams.get("query");
    expect(searchTerm).toBe("nike");
  });

  it("never asks `hasInvalidCompetitorWebsite` to validate the sitelink substitution", async () => {
    const { webSiteJsonLd } = await import("~/lib/seo");
    const { hasInvalidCompetitorWebsite, normalizeCompetitorWebsiteInput } =
      await import("~/lib/competitor-website");

    const urlTemplate = JSON.parse(JSON.stringify(webSiteJsonLd()))
      .potentialAction.target.urlTemplate as string;

    for (const probe of ["nike", "nike.com", "Nykaa", "magiclemon", "  "]) {
      const filled = fillUrlTemplate(urlTemplate, probe);
      const url = new URL(filled);
      // A bare brand name (no TLD) MUST be accepted by the sitelink
      // path. The previous `?website={website}` template forwarded
      // `nike` to the website form, which rejected it as incomplete
      // and never ran a search. The new template puts the value in
      // the search-term slot where no domain check is run.
      if (url.searchParams.get("website")) {
        const state = normalizeCompetitorWebsiteInput(
          url.searchParams.get("website") ?? "",
        );
        expect(hasInvalidCompetitorWebsite(state)).toBe(probe.includes("."));
      } else {
        expect(hasInvalidCompetitorWebsite(emptyCompetitorWebsite())).toBe(false);
      }
    }
  });
});

describe("public /search H1 with a valid competitor website", () => {
  it("names the brand in #search-command-title instead of the idle title", async () => {
    const reactRouter = (await import("react-router")) as unknown as {
      useLoaderData: ReturnType<typeof vi.fn>;
    };
    reactRouter.useLoaderData.mockReturnValue(validWebsiteLoaderData);

    const { default: SearchRoute } = await import("~/routes/search");
    const markup = renderToStaticMarkup(createElement(SearchRoute));

    // H1 lives in WorkingHeader and is tagged id="search-command-title".
    const h1Match = markup.match(
      /<h1[^>]*id="search-command-title"[^>]*>([\s\S]*?)<\/h1>/,
    );
    expect(h1Match?.[1]).toBeDefined();
    // WorkingHeader renders `title` as a plain string child of <h1>, so
    // React escapes it — the captured group is text with HTML entities,
    // not nested markup. Decode the apostrophe entity React emits for `'`.
    const h1Text = (h1Match?.[1] ?? "")
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, "&")
      .trim();

    expect(h1Text).toContain("Nike");
    expect(h1Text).not.toBe("Find competitor ads");
    expect(h1Text.startsWith("Find competitor ads")).toBe(false);
  });

  it("still shows the generic idle title on /search with no query and no website", async () => {
    const reactRouter = (await import("react-router")) as unknown as {
      useLoaderData: ReturnType<typeof vi.fn>;
    };
    reactRouter.useLoaderData.mockReturnValue({
      ...sitelinkLoaderData,
      filters: { ...sitelinkLoaderData.filters, query: "" },
      competitorWebsite: emptyCompetitorWebsite(),
    });

    const { default: SearchRoute } = await import("~/routes/search");
    const markup = renderToStaticMarkup(createElement(SearchRoute));

    const h1Match = markup.match(
      /<h1[^>]*id="search-command-title"[^>]*>([\s\S]*?)<\/h1>/,
    );
    // WorkingHeader renders the title as a plain escaped string — no nested
    // markup to strip. See the branded-title case above for the rationale.
    const h1Text = (h1Match?.[1] ?? "").trim();
    expect(h1Text).toBe("Find competitor ads");
  });
});
