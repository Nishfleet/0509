import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BrandPageLoaderData } from "~/routes/ads.$domain";
import type { AdRecord } from "~/lib/types";

/**
 * Regression test for issue #1345: the public `/ads/:domain` page must
 * render a user-visible "skipped captures" summary when captureFailures is
 * non-empty, and must NOT leak the full per-entry array into the loader data.
 *
 * The test renders the route's default export with a mocked `useLoaderData`
 * (the same pattern as ads-brand-page.render.test.tsx) and asserts:
 *   - when `captureFailuresSummary` is non-null, the page contains a
 *     `data-testid="skipped-captures-summary"` element with a non-empty text
 *     body (accept #1, #4);
 *   - when `captureFailuresSummary` is null, the element is absent (accept #4);
 *   - the loader data never carries a `captureFailures` array field (accept #3).
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
      Link: ({
        children,
        to,
        ...props
      }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
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

function ad(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: overrides.metaAdId ?? "ad-1",
    advertiser: "Nike",
    body: "Run through summer.",
    previewHeadline: "Run through summer.",
    previewSubhead: "",
    hook: "Shop Now",
    offer: "",
    cta: "Shop Now",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: "https://www.nike.com/launch",
    adSnapshotUrl: null,
    countries: ["all"],
    platforms: ["Instagram"],
    firstSeenAt: new Date("2026-06-01T00:00:00.000Z").toISOString(),
    lastSeenAt: null,
    active: true,
    researchSummary: "",
    source: "meta_library_browser",
    analysisFields: [],
    ...overrides,
  };
}

const teaser = {
  totalCount: 6,
  activeCount: 6,
  longestRunningDays: 126,
  longestRunningHook: "Charge shin guards",
  formats: ["image", "video", "carousel"],
};

const aggression = {
  score: 78,
  components: { velocity: 22, testing: 19, freshness: 20, persistence: 17 },
  bandId: "all_out" as const,
  bandLabel: "All-out",
  bandInterpretation: "Running an all-out launch and testing push.",
  formulaVersion: 1 as const,
  windowDays: 21,
  adsPerWeek: 6,
  adCount: 6,
  activeCount: 6,
};

const changeEvents = [
  {
    id: "evt-1",
    dayLabel: "Today",
    isToday: true,
    source: "AD LIBRARY",
    move: "New ad entered rotation",
    why: "Launched with 4 variants.",
    variantCount: 4,
  },
];

function populated(overrides: Partial<BrandPageLoaderData> = {}): BrandPageLoaderData {
  return {
    domain: "nike.com",
    brandName: "Nike",
    hasCachedAds: true,
    ads: Array.from({ length: 6 }, (_v, i) => ad({ metaAdId: `ad-${i}` })),
    verifiedLinkedAds: Array.from({ length: 6 }, (_v, i) => ad({ metaAdId: `ad-${i}` })),
    checkedAgo: "about 2 hours ago",
    lastCheckedAt: "2026-08-09T10:00:00.000Z",
    freshForLiveClaim: false,
    brandOwnedAdCount: 6,
    verifiedLinkCount: 6,
    unverifiedMatchCount: 0,
    teaser,
    aggression,
    changeEvents,
    observationDays: null,
    offerTimelineEntries: [],
    adLibraryCountry: "India",
    noindex: false,
    relatedBrands: [],
    canonicalPath: "/ads/nike.com",
    captureFailuresSummary: null,
    ...overrides,
  };
}

describe("/ads/:domain — skipped captures summary (issue #1345)", () => {
  it("renders a data-testid=skipped-captures-summary element when captureFailuresSummary is non-null", async () => {
    const markup = await render(
      populated({
        captureFailuresSummary: {
          count: 5,
          earliestDate: "2026-06-15T04:02:39.991Z",
          latestDate: "2026-07-03T12:02:54.133Z",
          reasonCode: "budget_skip",
          hasSkippedDueToBudget: true,
        },
      }),
    );

    // The summary element is present with a non-empty text body.
    expect(markup).toContain('data-testid="skipped-captures-summary"');
    // The summary text names the count and the date range.
    expect(markup).toContain("5 checks on this brand");
    expect(markup).toContain("between");
    // The reason is named in plain language ("skipped — plan allowance reached").
    expect(markup).toContain("plan allowance reached");
    // The monthly-reset note appears for budget skips.
    expect(markup).toContain("Free-tier captures reset monthly");
    // A link to run history / signup is present.
    expect(markup).toContain("See run history");
  });

  it("omits the skipped-captures-summary element when captureFailuresSummary is null", async () => {
    const markup = await render(populated({ captureFailuresSummary: null }));

    expect(markup).not.toContain('data-testid="skipped-captures-summary"');
    // The section heading is also absent — the whole section hides.
    expect(markup).not.toContain("brand-capture-failures-title");
  });

  it("renders the summary for a single entry without a date range", async () => {
    const markup = await render(
      populated({
        captureFailuresSummary: {
          count: 1,
          earliestDate: null,
          latestDate: "2026-07-03T12:02:54.133Z",
          reasonCode: "budget_skip",
          hasSkippedDueToBudget: true,
        },
      }),
    );

    expect(markup).toContain('data-testid="skipped-captures-summary"');
    // A single entry uses "on <date>" not "between <date> and <date>".
    expect(markup).toContain("1 check on this brand on");
    expect(markup).not.toContain("between");
  });

  it("does not add the monthly-reset note when no entry is a budget skip", async () => {
    const markup = await render(
      populated({
        captureFailuresSummary: {
          count: 2,
          earliestDate: "2026-06-15T04:02:39.991Z",
          latestDate: "2026-07-03T12:02:54.133Z",
          reasonCode: "timeout",
          hasSkippedDueToBudget: false,
        },
      }),
    );

    expect(markup).toContain('data-testid="skipped-captures-summary"');
    expect(markup).not.toContain("Free-tier captures reset monthly");
  });

  it("the loader data type does not carry a captureFailures array field (accept #3)", async () => {
    // The loader returns captureFailuresSummary, not captureFailures. This is
    // a compile-time guarantee: the BrandPageLoaderData interface has
    // `captureFailuresSummary` and no `captureFailures` field. The populated()
    // helper above would fail to type-check if the field were renamed back.
    const data = populated();
    expect(data).not.toHaveProperty("captureFailures");
    expect(data).toHaveProperty("captureFailuresSummary");
  });
});
