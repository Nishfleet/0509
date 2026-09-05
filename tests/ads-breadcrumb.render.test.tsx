import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BrandPageLoaderData } from "~/routes/ads.$domain";

/**
 * Lock test for issue #1547 (accept 5) / #1418: every /ads/:domain page must
 * carry a visible breadcrumb navigation AND matching BreadcrumbList JSON-LD
 * (Home → Ads → Brand), and BOTH must be withheld on indexable-only pages.
 *
 * The /ads route emits structured data ONLY when the page is indexable
 * (`data.indexable`) — the honesty discipline shared with the WebPage/Service/
 * FAQPage block. A noindex page (emergency brake, stale capture, thin
 * sub-floor wall) must never ship BreadcrumbList or the visible trail, so
 * the test asserts both the present (indexable) and absent (noindex) cases
 * against the live production sitemap posture: indexable pages are the only
 * ones that rank.
 *
 * The middle crumb "Ads" links to /search (the parent browse surface) because
 * there is no /brands hub yet (#1417) — the same fallback #1418 specifies.
 */

let currentData: BrandPageLoaderData;

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      useLoaderData: () => currentData,
      useRouteLoaderData: () => undefined,
      Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
        React.createElement("form", props, children),
    };
  });
});

afterEach(() => {
  vi.doUnmock("react-router");
  vi.restoreAllMocks();
  vi.resetModules();
});

async function render(data: BrandPageLoaderData): Promise<string> {
  currentData = data;
  const { default: BrandAdsRoute } = await import("~/routes/ads.$domain");
  return renderToStaticMarkup(createElement(BrandAdsRoute));
}

function parseLdJsonBlocks(markup: string): Array<Record<string, unknown>> {
  const matches = [...markup.matchAll(/type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  return matches.map((match) => JSON.parse(match[1] ?? "") as Record<string, unknown>);
}

function breadcrumb(markup: string): Record<string, unknown> | undefined {
  return parseLdJsonBlocks(markup).find((block) => block["@type"] === "BreadcrumbList");
}

function crumbNames(breadcrumb: Record<string, unknown> | undefined): string[] {
  if (!breadcrumb) return [];
  return (breadcrumb["itemListElement"] as Array<Record<string, unknown>>).map(
    (item) => String(item["name"]),
  );
}

/** A minimal loader payload for the /ads/:domain route (cache-miss Shell branch). */
function shellData(overrides: Partial<BrandPageLoaderData> = {}): BrandPageLoaderData {
  return {
    domain: "nike.com",
    brandName: "Nike",
    hasCachedAds: false,
    ads: [],
    verifiedLinkedAds: [],
    checkedAgo: null,
    lastCheckedAt: null,
    freshForLiveClaim: false,
    brandOwnedAdCount: 0,
    verifiedLinkCount: 0,
    unverifiedMatchCount: 0,
    teaser: null,
    aggression: null,
    changeEvents: [],
    offerTimelineEntries: [],
    adLibraryCountry: "all countries",
    indexable: true,
    canonicalPath: "/ads/nike.com",
    captureFailuresSummary: null,
    ...overrides,
  };
}

describe("Breadcrumb on /ads/:domain pages (issue #1547 / #1418)", () => {
  it("emits a Home → Ads → Brand BreadcrumbList and visible nav when indexable", async () => {
    const markup = await render(shellData());

    const trail = breadcrumb(markup);
    expect(trail?.["@context"]).toBe("https://schema.org");
    expect(trail?.["@type"]).toBe("BreadcrumbList");
    expect(crumbNames(trail)).toEqual(["Home", "Ads", "Nike"]);

    // Position items must link to canonical URLs (Home, /search as the Ads
    // browse parent, and the brand page's own canonical as the current item).
    const items = (trail?.["itemListElement"] as Array<Record<string, unknown>>) ?? [];
    expect(items[0]?.["item"]).toBe("https://0509.io/");
    expect(items[1]?.["item"]).toBe("https://0509.io/search");
    expect(items[2]?.["item"]).toBe("https://0509.io/ads/nike.com");

    // The visible trail matches the JSON-LD exactly (never drift).
    expect(markup).toContain('<nav aria-label="Breadcrumb"');
    expect(markup).toContain('href="/"');
    expect(markup).toContain('href="/search"');
    // The current brand crumb is plain text, not a self-link.
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain(">Nike</span>");
  });

  it("withholds the breadcrumb nav and BreadcrumbList entirely when the page is noindex", async () => {
    const markup = await render(shellData({ indexable: false }));

    expect(breadcrumb(markup)).toBeUndefined();
    expect(markup).not.toContain('<nav aria-label="Breadcrumb"');
    expect(crumbNames(breadcrumb(markup))).toEqual([]);
  });
});
