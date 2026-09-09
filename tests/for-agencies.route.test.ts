import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Issue #2144: /for-agencies — agency audience page with the roster math, a
// sourced Agency-vs-Foreplay line, and the source=for_agencies signup CTA.

const routePath = "app/routes/for-agencies.tsx";
const sourcesDocPath = "docs/compare-pricing-sources.md";

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      // The shared MarketingNav shell reads root loader data; render the
      // route without a data-router context (same pattern as
      // tests/competitor-monitoring-category.test.ts).
      useRouteLoaderData: () => undefined,
      useLoaderData: () => ({ proofBrief: null }),
      Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
        React.createElement("form", props, children),
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function renderRoute() {
  const { default: ForAgenciesRoute } = await import("~/routes/for-agencies");
  return renderToStaticMarkup(createElement(ForAgenciesRoute));
}

describe("/for-agencies route", () => {
  it("is registered in routes.ts and the loader resolves (HTTP 200)", async () => {
    const routes = readFileSync("app/routes.ts", "utf8");
    expect(routes).toContain('route("for-agencies", "routes/for-agencies.tsx")');

    // Run the real loader against a minimal env: the proof-brief read
    // degrades to the honest null state, so the route serves a 200 instead
    // of a 500.
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({})),
    }));
    const { loader } = await import("~/routes/for-agencies");
    const data = await loader({
      context: { cloudflare: { env: {} } },
      request: new Request("https://0509.io/for-agencies"),
    } as never);
    expect(data).toEqual({ proofBrief: null });
  });

  it("reuses the shared marketing nav, footer, and proof-brief shell", async () => {
    const source = readFileSync(routePath, "utf8");

    expect(source).toContain("f9-home");
    expect(source).toMatch(/<MarketingNav\b[^>]*\/>/);
    expect(source).toContain("<MarketingFooter />");
    expect(source).toContain("loadPublicProofBrief");
    expect(source).toContain('className="ld-hero"');
    expect(source).not.toContain('<footer className="ld-footer">');
  });

  it("renders the per-client Monday roster math", async () => {
    const markup = await renderRoute();

    // 30 minutes × brands × clients, with worked roster examples.
    expect(markup).toContain("30 minutes × brands × clients");
    expect(markup).toContain("5 clients × 4 brands each");
    expect(markup).toContain("20 brands = 10 hours every Monday");
    expect(markup).toContain("One brief per client");
  });

  it("states the Agency plan line and the shipped branding scope only", async () => {
    const markup = await renderRoute();

    // Agency: 75 watchlists at $199/mo, 3-hour checks on the top 25.
    expect(markup).toContain("75 watchlists at $199/mo");
    expect(markup).toContain("checked every 3 hours");
    expect(markup).toContain("the rest every 6");

    // Share links on Starter carry the watermark; agency_branding (name +
    // logo, "Prepared by") stays Agency-only — and never "white-label".
    expect(markup).toContain("Starter shares carry the Five to Nine watermark");
    expect(markup).toContain("Prepared by");
    expect(markup).not.toMatch(/white.?label/i);

    // No Slack/Teams delivery claim in the page copy (the shared footer's
    // generic "helps teams" tagline is out of scope — assert on the route
    // source itself).
    const source = readFileSync(routePath, "utf8");
    expect(source).not.toMatch(/slack|\bteams\b/i);
  });

  it("targets the public search preview and the allowlisted for_agencies signup source", async () => {
    const source = readFileSync(routePath, "utf8");
    const markup = await renderRoute();

    // Public search preview CTA.
    expect(source).toContain('action="/search"');
    expect(markup).toContain('action="/search"');

    // Signup CTA carries the allowlisted source marker.
    expect(markup).toContain("/auth/signup?source=for_agencies");
    const { allowlistedSignupSource, ALLOWED_SIGNUP_SOURCES } = await import(
      "~/lib/signup-source"
    );
    expect(ALLOWED_SIGNUP_SOURCES).toContain("for_agencies");
    expect(allowlistedSignupSource("for_agencies")).toBe("for_agencies");
  });

  it("quotes only the sourced Foreplay figures, with the source and check date", async () => {
    const markup = await renderRoute();
    const sourcesDoc = readFileSync(sourcesDocPath, "utf8");

    // The vendor line is present and carries its source + check date.
    expect(markup).toContain("$459/month");
    expect(markup).toContain("50 tracked brands");
    expect(markup).toContain("https://foreplay.co/pricing");
    expect(markup).toContain("checked 2026-09-09");

    // The same figures are recorded in the sources doc with URL and date.
    expect(sourcesDoc).toContain("https://foreplay.co/pricing");
    expect(sourcesDoc).toContain("Checked: 2026-09-09");
    expect(sourcesDoc).toContain("Agency — $459/month");
    expect(sourcesDoc).toContain("50 Brands");

    // No unsourced vendor number: the only dollar amounts on the page are
    // the sourced Foreplay figure and Five to Nine's own published $199/mo
    // Agency anchor (app/lib/pricing.ts PUBLISHED_PLAN_PRICES_USD).
    const amounts = new Set(markup.match(/\$\d[\d,]*/g) ?? []);
    expect([...amounts].sort()).toEqual(["$199", "$459"]);
  });

  it("is listed in the sitemap and the marketing footer", async () => {
    const { SITEMAP_STATIC_ENTRIES, publicSeoFileForPathname } = await import("~/lib/seo");
    expect(
      SITEMAP_STATIC_ENTRIES.some((entry) => entry.path === "/for-agencies"),
    ).toBe(true);
    const sitemap = publicSeoFileForPathname("/sitemap.xml");
    expect(sitemap?.body).toContain("<loc>https://0509.io/for-agencies</loc>");

    const footer = readFileSync("app/components/marketing-footer.tsx", "utf8");
    expect(footer).toContain('<Link to="/for-agencies">');
  });

  it("carries a truthful title, description, and canonical", async () => {
    const source = readFileSync(routePath, "utf8");

    expect(source).toContain('pathname: "/for-agencies"');
    expect(source).toContain('title: "Competitor monitoring for agencies | Five to Nine"');
    expect(source).toContain('canonicalLinks("/for-agencies")');
    expect(source).toContain("publicSeoMeta({");

    const description =
      "Five to Nine files one source-linked brief per client: 75 watchlists on Agency, watermarked share links on Starter, and your agency's brand on shared reports.";
    expect(description.length).toBeLessThanOrEqual(160);
    expect(source).toContain(description);
    expect(source).not.toMatch(/trusted by|#1|best competitor monitoring/i);
  });
});
