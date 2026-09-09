import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SNEAKER_RESALE_BRAND_PAGES } from "~/components/sneaker-resale-landing";

/**
 * Issue #2100. /sneaker-resale is the strongest-signal topical page and used
 * to cross-link only /ads/:domain walls. The dated offer-history moat lives
 * at /timeline/:domain (BET 3) and was unreachable from this page. The
 * empty-guard is the same sitemap indexability signal /brands and /ads use
 * (#1931): a domain with no populated, indexable ledger is not linked.
 */

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
        React.createElement("form", props, children),
      useRouteLoaderData: () => undefined,
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

function mockTimelineLoad(domains: readonly string[] | Error) {
  vi.doMock("~/lib/context.server", () => ({
    getEnv: () => ({}),
  }));
  vi.doMock("~/lib/funnel-measurement.server", () => ({
    emitFunnelLocaleSegmentView: vi.fn(),
  }));
  vi.doMock("~/lib/ads-internal-links.server", () => ({
    loadIndexableTimelineDomains: vi.fn().mockImplementation(async () => {
      if (domains instanceof Error) {
        throw domains;
      }
      return new Set(domains);
    }),
  }));
}

describe("/sneaker-resale offer-timeline cross-links (issue #2100)", () => {
  it("intersects the labelled sneaker cohort with the sitemap's indexable set", async () => {
    const { sneakerResaleIndexableTimelineDomains, SNEAKER_RESALE_BRAND_PAGES } =
      await import("~/components/sneaker-resale-landing");
    const labelled = new Set(SNEAKER_RESALE_BRAND_PAGES.map((brand) => brand.domain));
    expect(labelled.has("nike.com")).toBe(true);
    expect(
      sneakerResaleIndexableTimelineDomains(new Set(["nike.com", "gymshark.com"])),
    ).toEqual(["nike.com"]);
    expect(sneakerResaleIndexableTimelineDomains(new Set())).toEqual([]);
  });

  it("renders a /timeline pointer for each labelled sneaker brand whose offer ledger is indexable", async () => {
    const { SneakerResaleLanding } = await import("~/components/sneaker-resale-landing");
    const markup = renderToStaticMarkup(
      createElement(SneakerResaleLanding, {
        locale: "en",
        timelineDomains: ["nike.com", "stockx.com"],
      }),
    );

    expect(markup).toContain('href="/timeline/nike.com"');
    expect(markup).toContain('href="/timeline/stockx.com"');
    expect(markup).toMatch(/offer timeline/i);
    // Empty-guard: a labelled sneaker brand with no populated ledger keeps
    // its /ads wall and does not get a timeline pointer.
    expect(markup).toContain('href="/ads/adidas.com"');
    expect(markup).not.toContain('href="/timeline/adidas.com"');
    const timelineCount = (markup.match(/href="\/timeline\/[a-z0-9.-]+"/g) ?? []).length;
    expect(timelineCount).toBeGreaterThan(0);
  });

  it("renders zero timeline pointers when the sneaker cohort has no populated offer ledger", async () => {
    const { SneakerResaleLanding } = await import("~/components/sneaker-resale-landing");
    const markup = renderToStaticMarkup(
      createElement(SneakerResaleLanding, { locale: "en", timelineDomains: [] }),
    );

    expect(markup.match(/href="\/timeline\/[^"]+"/g) ?? []).toEqual([]);
    const adsLinkCount = (markup.match(/href="\/ads\/[^"]+"/g) ?? []).length;
    expect(adsLinkCount).toBe(SNEAKER_RESALE_BRAND_PAGES.length);
  });

  it("EN loader intersects the labelled sneaker cohort with the sitemap's indexable timelines", async () => {
    mockTimelineLoad(["nike.com", "gymshark.com", "stockx.com"]);
    const { loader } = await import("~/routes/sneaker-resale");
    const data = await loader({
      context: {},
      request: new Request("http://localhost/sneaker-resale"),
    } as never);

    expect(data).not.toBeNull();
    expect(data?.timelineDomains).toContain("nike.com");
    expect(data?.timelineDomains).toContain("stockx.com");
    // gymshark is indexable elsewhere but is not a labelled sneaker-resale
    // hub brand, so it must not leak onto this page.
    expect(data?.timelineDomains).not.toContain("gymshark.com");
  });

  it("EN loader omits timeline domains when the sitemap hiccups (never 500s the page)", async () => {
    mockTimelineLoad(new Error("D1 down"));
    const { loader } = await import("~/routes/sneaker-resale");
    const data = await loader({
      context: {},
      request: new Request("http://localhost/sneaker-resale"),
    } as never);

    expect(data?.timelineDomains).toEqual([]);
  });
});
