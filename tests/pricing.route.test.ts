import { readFileSync } from "node:fs";
import { mockReactRouter } from "./helpers/mock-react-router";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pricingPlans, usageBundles } from "~/lib/pricing";

const root = process.cwd();

const commercialLaunch = {
  scoutSaleOpen: true,
  starterSaleOpen: true,
  agencySaleOpen: false,
};

describe("pricing route", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  const availablePreview = {
    available: true,
    provider: "dodo",
    source: "dodo_checkout_preview",
    country: "US",
    adaptiveCurrency: true,
    feesInclusive: true,
    prices: {
      starter: {
        monthly: { display: "$99", amount: 9900, currency: "USD", billingCountry: "US" },
      },
    },
    annualValidation: {},
    usageBundles: {},
  };

  it("is registered as a route and included in the sitemap", async () => {
    const routes = readFileSync("app/routes.ts", "utf8");
    expect(routes).toContain('route("pricing", "routes/pricing.tsx")');

    const { publicSeoFileForPathname } = await import("~/lib/seo");
    const sitemap = publicSeoFileForPathname("/sitemap.xml");
    // The /pricing route is registered and the sitemap now lists it; the live
    // Worker bundle must still be deployed for the public URL to resolve.
    expect(sitemap?.body).toContain("<loc>https://0509.io/pricing</loc>");
  });

  it("declares the canonical URL and public SEO meta", async () => {
    const { links, meta } = await import("~/routes/pricing");

    expect(links()).toEqual([{ rel: "canonical", href: "https://0509.io/pricing" }]);

    const tags = meta({} as never) as Array<Record<string, string>>;
    const title = tags.find((tag) => "title" in tag)?.title;
    expect(title).toBe("Pricing | Five to Nine");
    expect(tags).toContainEqual({
      property: "og:url",
      content: "https://0509.io/pricing",
    });
  });

  it("never SSRs a Dodo pricing preview and always returns the no-preview sentinel (issue #2694)", async () => {
    const previewDodo0509PlanPrices = vi.fn().mockResolvedValue(availablePreview);
    const publicCommercialLaunchSummary = vi.fn(() => commercialLaunch);

    vi.doMock("~/lib/dodo-pricing.server", () => ({ previewDodo0509PlanPrices }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ DODO_0509_API_KEY: "provider-key" })),
    }));
    vi.doMock("~/lib/commercial-launch-gate.server", () => ({ publicCommercialLaunchSummary }));

    const { loader } = await import("~/routes/pricing");
    const result = await loader({
      context: { cloudflare: { env: {} } },
      request: new Request("https://0509.io/pricing"),
    } as never);

    // The 2.5s SSR bound and ~8 Dodo checkout-preview calls per cold isolate
    // were the reason /pricing was the last `private` public page. The loader
    // must never touch Dodo; PricingSection fetches /api/pricing-preview from
    // the client instead, and the worker stamps `public, max-age=300`.
    expect(previewDodo0509PlanPrices).not.toHaveBeenCalled();
    expect(result).toEqual({
      pricingPreview: { available: false },
      commercialLaunch,
    });
  });

  it("does not set a private cache-control on the loader response", async () => {
    const publicCommercialLaunchSummary = vi.fn(() => commercialLaunch);

    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ DODO_0509_API_KEY: "provider-key" })),
    }));
    vi.doMock("~/lib/commercial-launch-gate.server", () => ({ publicCommercialLaunchSummary }));

    const mod = await import("~/routes/pricing");
    // The headers export that forwarded the loader's private cache-control
    // into the document is gone; the worker's public policy applies instead.
    expect("headers" in mod).toBe(false);
    expect(mod.loader).toBeTypeOf("function");
    // Direct contract: /pricing is in the worker's public-cacheable path set,
    // so a stamp-less 200 HTML response from this route gets the shared
    // `public, max-age=300` policy with `vary: cookie`.
    const { withSecurityHeaders, PUBLIC_HTML_CACHE_CONTROL } =
      await import("../workers/security-headers");
    const stamped = withSecurityHeaders(
      new Response("<!doctype html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
      new Request("https://0509.io/pricing"),
    );
    expect(stamped.headers.get("cache-control")).toBe("public, max-age=300");
    expect(stamped.headers.get("cache-control")).toBe(PUBLIC_HTML_CACHE_CONTROL);
    expect(stamped.headers.get("vary")).toContain("cookie");
  });
});

describe("pricing section render smoke", () => {

  const rootData = {
    session: null,
    pricingPlans: pricingPlans(),
    usageBundles: usageBundles(),
  };

  const routeData = {
    pricingPreview: { available: false },
    commercialLaunch,
  };

  beforeEach(() => {
    vi.resetModules();
    mockReactRouter({
    loaderData: () => rootData,
    loader: () => routeData,
  });
});

  afterEach(() => {
    vi.doUnmock("react-router");
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("renders plan cards and billing FAQ in the cold anonymous fallback", async () => {
    const { PricingSection } = await import("~/components/pricing-section");
    const markup = renderToStaticMarkup(
      createElement(PricingSection, {
        commercialLaunch: {
          scoutSaleOpen: true,
          starterSaleOpen: true,
          agencySaleOpen: false,
        },
        initialPricingPreview: null,
      }),
    );

    expect(markup).toContain("Scout");
    expect(markup).toContain("Starter");
    expect(markup).toContain("Agency");
    // Published USD anchor prices render from first paint, before the live
    // Dodo preview resolves.
    expect(markup).toContain("$11 USD/mo");
    expect(markup).toContain("$59 USD/mo");
    expect(markup).toContain("$199 USD/mo");
    expect(markup).toContain("$59 USD");
    expect(markup).toContain("$179 USD");
    expect(markup).toContain("$599 USD");
    expect(markup).toContain("Common billing questions");
    // Homepage reuses this section and already has its own hero h1.
    expect(markup).toContain("<h2>Choose the monitoring rhythm your team needs.</h2>");
    expect(markup).not.toMatch(/<h1\b/);
  });

  it("renders the barebones Free column with exactly the five bullets", async () => {
    const { PricingSection } = await import("~/components/pricing-section");
    const markup = renderToStaticMarkup(
      createElement(PricingSection, {
        commercialLaunch: {
          scoutSaleOpen: true,
          starterSaleOpen: true,
          agencySaleOpen: false,
        },
        initialPricingPreview: null,
      }),
    );

    // Free is barebones: one competitor, one first check + first brief, Meta
    // only, no automatic checks, no exports or API.
    expect(markup).toContain("1 competitor");
    expect(markup).toContain("First check + first brief");
    expect(markup).toContain("Meta Ad Library only");
    expect(markup).toContain("No automatic checks");
    expect(markup).toContain("No exports or API");
    // The old free claims are gone.
    expect(markup).not.toContain("1 Collection");
    expect(markup).not.toContain("Weekly proof-backed brief");
    expect(markup).not.toContain("Instant first scan");
  });

  it("keeps the Free pitch once and drops the 'launch plan' badge (issue #2315)", async () => {
    const { default: PricingRoute } = await import("~/routes/pricing");
    const markup = renderToStaticMarkup(createElement(PricingRoute));

    // The Free sentence survives exactly once, in the Free card body.
    const freeSentence =
      "Watch 1 competitor — one first check and one first brief, Meta Ad Library only.";
    const occurrences = markup.split(freeSentence).length - 1;
    expect(occurrences).toBe(1);

    // The summary badge reads "Recommended", never "launch plan".
    expect(markup).not.toContain("launch plan");

    // The accept criterion requires the string to be gone from the source
    // files too, not just the rendered output.
    const sourceFiles = [
      readFileSync(join(root, "app/routes/pricing.tsx"), "utf8"),
      readFileSync(
        join(root, "app/components/pricing-section.tsx"),
        "utf8",
      ),
    ];
    for (const source of sourceFiles) {
      expect(source).not.toContain("launch plan");
    }
  });

  it("renders a single plain-text h1 in the route SSR output", async () => {
    const { default: PricingRoute } = await import("~/routes/pricing");
    const markup = renderToStaticMarkup(createElement(PricingRoute));

    const h1Matches = markup.match(/<h1\b[^>]*>[^<]+<\/h1>/g) ?? [];
    expect(h1Matches).toHaveLength(1);
    expect(h1Matches[0]).toBe(
      "<h1>Choose the monitoring rhythm your team needs.</h1>",
    );
  });

  it("publishes 7 or more Offer blocks in EUR on /pricing JSON-LD for issue #1503", async () => {
    const { default: PricingRoute } = await import("~/routes/pricing");
    const markup = renderToStaticMarkup(createElement(PricingRoute));

    // The issue's verify command grep-counts "@type":"Offer" (with
    // optional whitespace) and requires at least 7, plus at least one
    // priceCurrency="EUR". Render the SSR markup here and apply the
    // same grep contract so the regression guard fires without the
    // network round-trip — exactly the same shape as
    //   curl -sS https://0509.io/pricing | grep -oE '"@type"\s*:\s*"Offer"' | wc -l
    const offerCount = (markup.match(/"@type"\s*:\s*"Offer"/g) ?? []).length;
    expect(offerCount).toBeGreaterThanOrEqual(7);
    expect(markup).toMatch(/"priceCurrency"\s*:\s*"EUR"/);
    // Free is part of the 7, so it must be the published 0 offer row.
    expect(markup).toMatch(/"name"\s*:\s*"Free"/);
  });
});
