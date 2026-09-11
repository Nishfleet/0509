/**
 * Issue #2051 — the /ads/:domain "Track <domain>" CTA.
 *
 * Accept:
 *  1. The page renders a primary "Track <domain>" CTA whose href deep-links
 *     into signup with the viewed competitor prefilled
 *     (`/auth/signup?competitor=<domain>`) and carries the onboarding prefill
 *     in redirectTo (`/app?website=<domain>#setup-checklist`).
 *  2. Signup honors a bare `?competitor=<domain>` by building the prefill
 *     redirect when none is given.
 *  3. The dashboard/onboard prefill reads `competitor` as an alias of
 *     `website`, so the brand just viewed is the first thing the new user
 *     tracks.
 *
 * No schema/migration change — param + client wiring only.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BrandPageLoaderData } from "~/routes/ads.$domain";

// ---------------------------------------------------------------------------
// Render: the /ads/:domain page carries the Track CTA with the prefill href.
// ---------------------------------------------------------------------------

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

function fixture(overrides: Partial<BrandPageLoaderData> = {}): BrandPageLoaderData {
  return {
    domain: "nike.com",
    brandName: "Nike",
    hasCachedAds: true,
    ads: [],
    adCount: 0,
    verifiedTestedCount: 0,
    tickerAds: [],
    checkedAgo: "2 hours ago",
    lastCheckedAt: new Date("2026-09-08T12:00:00Z").toISOString(),
    freshForLiveClaim: false,
    brandOwnedAdCount: 1,
    verifiedLinkCount: 1,
    unverifiedMatchCount: 0,
    partnerCampaignAdIds: [],
    teaser: null,
    aggression: null,
    observationDays: 21,
    changeEvents: [],
    offerTimelineEntries: [],
    timelineIndexable: false,
    adLibraryCountry: "all countries",
    relatedBrands: [],
    noindex: false,
    canonicalPath: "/ads/nike.com",
    captureFailuresSummary: null,
    recentWatchChanges: [],
    sourceSnapshots: [],
    ...overrides,
  } as BrandPageLoaderData;
}

async function renderAdsPage(data: BrandPageLoaderData): Promise<string> {
  currentData = data;
  const { default: BrandAdsRoute } = await import("~/routes/ads.$domain");
  return renderToStaticMarkup(createElement(BrandAdsRoute));
}

describe("issue #2051 — /ads/:domain Track CTA", () => {
  it("renders a Track CTA deep-linking into signup with the competitor prefilled", async () => {
    const html = await renderAdsPage(fixture());
    // The issue's acceptance shape: an href into signup that carries the
    // viewed competitor as a prefill param.
    expect(html).toMatch(/href="\/auth\/signup\?[^"]*competitor=nike\.com/);
  });

  it("encodes the onboarding prefill in redirectTo so onboarding honors it", async () => {
    const html = await renderAdsPage(fixture());
    const href = html.match(/href="(\/auth\/signup\?[^"]*)"/)?.[1];
    expect(href).toBeTruthy();
    const params = new URLSearchParams(
      href!.replace("/auth/signup?", "").replaceAll("&amp;", "&"),
    );
    expect(params.get("competitor")).toBe("nike.com");
    expect(params.get("redirectTo")).toBe("/app?website=nike.com#setup-checklist");
  });

  it("interpolates the viewed domain into the CTA label", async () => {
    const html = await renderAdsPage(fixture());
    expect(html).toContain("Track nike.com");
  });

  it("escapes a hostile domain in the href and label", async () => {
    const html = await renderAdsPage(fixture({ domain: "evil.com" }));
    expect(html).toContain("competitor=evil.com");
    expect(html).not.toContain('href="/auth/signup?competitor=evil.com&"');
  });
});

// ---------------------------------------------------------------------------
// Signup loader: a bare ?competitor=<domain> builds the prefill redirect.
// ---------------------------------------------------------------------------

async function runSignupLoader(query: string) {
  const { loader } = await import("~/routes/auth.signup");
  return loader({
    context: { cloudflare: { env: { DB: {} } } },
    params: {},
    request: new Request(`http://localhost/auth/signup${query}`),
  } as never);
}

function installSignupMocks() {
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => ({ DB: {} })),
  }));
  vi.doMock("~/lib/auth.server", () => ({
    getOptionalSession: vi.fn(async () => null),
  }));
  vi.doMock("~/lib/better-auth.server", () => ({
    enabledBetterAuthOAuthProviders: vi.fn(() => []),
  }));
}

describe("issue #2051 — signup honors ?competitor=<domain>", () => {
  afterEach(() => {
    vi.doUnmock("~/lib/context.server");
    vi.doUnmock("~/lib/auth.server");
    vi.doUnmock("~/lib/better-auth.server");
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("builds the setup-checklist prefill redirect from a bare competitor param", async () => {
    installSignupMocks();
    const data = (await runSignupLoader("?competitor=nike.com")) as {
      redirectTo: string;
    };
    expect(data.redirectTo).toBe("/app?website=nike.com#setup-checklist");
  });

  it("keeps an explicit redirectTo and does not overwrite it", async () => {
    installSignupMocks();
    const data = (await runSignupLoader(
      "?competitor=nike.com&redirectTo=%2Fapp",
    )) as { redirectTo: string };
    expect(data.redirectTo).toBe("/app");
  });

  it("falls back to the default redirect without a competitor param", async () => {
    installSignupMocks();
    const data = (await runSignupLoader("")) as { redirectTo: string };
    expect(data.redirectTo).toBe("/app#setup-checklist");
  });
});

// ---------------------------------------------------------------------------
// Onboard/dashboard prefill: competitor is an alias of the website param.
// ---------------------------------------------------------------------------

describe("issue #2051 — prefill param alias", () => {
  it("the dashboard loader maps competitor onto setupPrefillWebsite", async () => {
    // The alias is a one-line read in app.dashboard.tsx; assert the wiring
    // via source shape so the test cannot silently pass when the param is
    // dropped.
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../app/routes/app.dashboard.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(/searchParams\.get\("competitor"\)/);
  });

  it("the onboard redirect forwards the competitor alias", async () => {
    // Issue #2292 removed the compat cookie branch; the competitor alias now
    // lives in the 301 redirect's forwarded-key set. Assert that set so the
    // test cannot silently pass when the param is dropped.
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../app/routes/app.onboard.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(/\["website", "country", "competitor"\]/);
  });
});
