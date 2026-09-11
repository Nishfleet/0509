import { createElement } from "react";
import { mockReactRouter } from "./helpers/mock-react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BrandPageLoaderData } from "~/routes/ads.$domain";
import {
  rerankBrandChangeFeed,
  type BrandChangeEvent,
} from "~/lib/brand-page.server";
import type { AdRecord } from "~/lib/types";

/**
 * Regression for issue #1951: the public /ads/:domain "What changed this week"
 * section used to dress a bare `ad_new` as a headline "move" with a
 * screenshot — exactly the new-ad-ping noise the homepage mocks ("Signal, not
 * noise"). BET 1 (#1897) re-ranked the email digest to collapse ad_new into a
 * counted line and promote landing_page_* to the headline, but the public
 * surface was never updated. These fixtures pin the new behaviour so the
 * digest and the /ads surface cannot drift again.
 */

// The default export reads `useLoaderData`; a mutable fixture lets each test
// render the route with a specific loader payload.
let currentData: BrandPageLoaderData;

beforeEach(() => {
  vi.resetModules();
  mockReactRouter({
    loader: () => currentData,
    loaderData: () => undefined,
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
    previewHeadline: "Run through summer with gear that can take the heat.",
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

/**
 * Build a populated BrandPageLoaderData fixture with a custom `changeEvents`
 * list — the fixtures for issue #1951 use a hand-built changeEvents array so
 * they can exercise the rerank output (landing_page_* + ad_new mix) without
 * depending on `buildBrandChangeFeed`, which today only emits ad_new events
 * from the cached ads.
 */
function populatedWithChangeEvents(
  changeEvents: BrandChangeEvent[],
): BrandPageLoaderData {
  return {
    domain: "nike.com",
    brandName: "Nike",
    hasCachedAds: true,
    ads: Array.from({ length: 6 }, (_v, i) => ad({ metaAdId: `ad-${i}` })),
    verifiedLinkedIds: Array.from({ length: 6 }, (_v, i) => `ad-${i}`),
    checkedAgo: "about 2 hours ago",
    lastCheckedAt: "2026-08-09T10:00:00.000Z",
    freshForLiveClaim: false,
    brandOwnedAdCount: 6,
    verifiedLinkCount: 6,
    unverifiedMatchCount: 0,
    partnerCampaignAdIds: [],
    teaser,
    aggression,
    observationDays: null,
    changeEvents,
    offerTimelineEntries: [],
    timelineIndexable: true,
    adLibraryCountry: "India",
    noindex: false,
    relatedBrands: [],
    canonicalPath: "/ads/nike.com",
    captureFailuresSummary: null,
    recentWatchChanges: [],
    sourceSnapshots: [],
  };
}

describe("rerankBrandChangeFeed — public /ads surface reuses the digest helper (issue #1951)", () => {
  it("collapses ad_new rows into the adChurn summary and surfaces landing_page_offer_changed as the headline", () => {
    const events: BrandChangeEvent[] = [
      {
        id: "new-1",
        dayLabel: "TUE",
        isToday: false,
        source: "AD LIBRARY",
        move: "New ad entered rotation — a summer creative",
        why: "A new creative in rotation.",
        eventType: "ad_new",
        variantCount: null,
      },
      {
        id: "new-2",
        dayLabel: "WED",
        isToday: false,
        source: "AD LIBRARY",
        move: "New ad entered rotation — a creative refresh",
        why: "A new creative in rotation.",
        eventType: "ad_new",
        variantCount: null,
      },
      {
        id: "new-3",
        dayLabel: "THU",
        isToday: false,
        source: "AD LIBRARY",
        move: "New ad entered rotation — a fall creative",
        why: "A new creative in rotation.",
        eventType: "ad_new",
        variantCount: null,
      },
      {
        id: "offer-1",
        dayLabel: "FRI",
        isToday: true,
        source: "AD LIBRARY",
        move: "Offer moved from $120 to $99",
        why: "Price drop worth watching.",
        eventType: "landing_page_offer_changed",
        variantCount: null,
      },
    ];

    const rerank = rerankBrandChangeFeed(events);

    // (a) The single headline is the offer change.
    expect(rerank.headlineItems.map((item) => item.id)).toEqual(["offer-1"]);
    expect(rerank.headlineItems[0]?.eventType).toBe("landing_page_offer_changed");
    // (b) ad_new appears only as a counted line, never as a headline.
    expect(
      rerank.headlineItems.some((item) => item.eventType === "ad_new"),
    ).toBe(false);
    expect(rerank.adChurnSummary).toEqual({ newCount: 3, retiredCount: 0, total: 3, maxNewVariantCount: null });
    expect(rerank.otherItems).toEqual([]);
  });

  it("returns zero adChurn when no change events are present (the section hides)", () => {
    const rerank = rerankBrandChangeFeed([]);
    expect(rerank.headlineItems).toEqual([]);
    expect(rerank.adChurnSummary).toEqual({ newCount: 0, retiredCount: 0, total: 0, maxNewVariantCount: null });
    expect(rerank.otherItems).toEqual([]);
  });
});

describe("/ads/:domain — What changed this week surface (issue #1951)", () => {
  it("promotes the single landing_page_offer_changed to the headline and collapses ad_new into a counted footnote (issue #1951)", async () => {
    const events: BrandChangeEvent[] = [
      {
        id: "new-1",
        dayLabel: "TUE",
        isToday: false,
        source: "AD LIBRARY",
        move: "New ad entered rotation — a summer creative",
        why: "A new creative in rotation.",
        eventType: "ad_new",
        variantCount: null,
      },
      {
        id: "new-2",
        dayLabel: "WED",
        isToday: false,
        source: "AD LIBRARY",
        move: "New ad entered rotation — a creative refresh",
        why: "A new creative in rotation.",
        eventType: "ad_new",
        variantCount: null,
      },
      {
        id: "new-3",
        dayLabel: "THU",
        isToday: false,
        source: "AD LIBRARY",
        move: "New ad entered rotation — a fall creative",
        why: "A new creative in rotation.",
        eventType: "ad_new",
        variantCount: null,
      },
      {
        id: "offer-1",
        dayLabel: "FRI",
        isToday: true,
        source: "AD LIBRARY",
        move: "Offer moved from $120 to $99",
        why: "Price drop worth watching.",
        eventType: "landing_page_offer_changed",
        variantCount: null,
      },
    ];
    const markup = await render(populatedWithChangeEvents(events));

    // The section still renders.
    expect(markup).toContain("What changed this week");

    // (a) The single headline is the offer change (the "New" badge in the
    // timeline identifies a headline row — there is exactly one).
    expect(markup).toContain("Offer moved from $120 to $99");
    expect((markup.match(/class="f9-ads-tl-badge">New</g) ?? []).length).toBe(1);

    // (b) ad_new appears only as a counted footnote line. The three ad_new
    // moves are NOT surfaced as standalone timeline rows.
    for (const newMove of [
      "New ad entered rotation — a summer creative",
      "New ad entered rotation — a creative refresh",
      "New ad entered rotation — a fall creative",
    ]) {
      expect(markup).not.toContain(newMove);
    }
    // The counted footnote line uses the exact phrasing the digest uses
    // (#1897), so the two surfaces cannot drift.
    expect(markup).toContain("3 new creatives — open the wall to see them.");

    // (c) No ad_new row carries a standalone "move" screenshot card. The
    // only `f9-ads-tl-row` is the headline (offer change); the ad_new rows
    // are collapsed into the single churn footnote which lives in its own
    // `.f9-ads-tl-row-churn` row, never as a regular headline row.
    const tlRows = markup.match(/class="f9-ads-tl-row[^"]*"/g) ?? [];
    expect(tlRows.length).toBe(2);
    expect(tlRows[0]).toBe('class="f9-ads-tl-row"');
    expect(tlRows[1]).toBe('class="f9-ads-tl-row f9-ads-tl-row-churn"');

    // The headline meta string stays as it was: "1 move · each with a saved
    // screenshot" (one headline move, not the count of raw change events).
    expect(markup).toContain("1 move · each with a saved screenshot");
  });

  it("renders the honest 'No offer changes this week' footnote with no headline card when only ad_new events exist (issue #1951)", async () => {
    const events: BrandChangeEvent[] = [
      {
        id: "new-1",
        dayLabel: "TUE",
        isToday: false,
        source: "AD LIBRARY",
        move: "New ad entered rotation — a summer creative",
        why: "A new creative in rotation.",
        eventType: "ad_new",
        variantCount: null,
      },
      {
        id: "new-2",
        dayLabel: "WED",
        isToday: false,
        source: "AD LIBRARY",
        move: "New ad entered rotation — a creative refresh",
        why: "A new creative in rotation.",
        eventType: "ad_new",
        variantCount: null,
      },
    ];
    const markup = await render(populatedWithChangeEvents(events));

    // (d) The section still renders — the count is non-zero — but it carries
    // the honest counted footnote and the "No offer changes this week" meta,
    // NOT a headline card.
    expect(markup).toContain("What changed this week");
    expect(markup).toContain("No offer changes this week");
    // The misleading "each with a saved screenshot" copy must never appear
    // when there are no headline items to attach screenshots to.
    expect(markup).not.toContain("each with a saved screenshot");

    // No headline card: no "New" badge (the headline-row identifier) at all.
    expect(markup).not.toContain('class="f9-ads-tl-badge">New<');

    // The two ad_new events are NOT surfaced as standalone headline rows;
    // only the churn footnote row exists.
    expect(markup).not.toContain("New ad entered rotation — a summer creative");
    expect(markup).not.toContain("New ad entered rotation — a creative refresh");
    const tlRows = markup.match(/class="f9-ads-tl-row[^"]*"/g) ?? [];
    expect(tlRows).toEqual([
      'class="f9-ads-tl-row f9-ads-tl-row-churn"',
    ]);
    // The single counted line is the exact churn footnote the digest uses.
    expect(markup).toContain("2 new creatives — open the wall to see them.");
  });

  it("hides the entire 'What changed this week' section when there are no change events at all (issue #1951)", async () => {
    const markup = await render(populatedWithChangeEvents([]));

    // Section hidden entirely — not a single headline card, not even the
    // churn footnote (no churn to count).
    expect(markup).not.toContain("What changed this week");
    expect(markup).not.toContain("No offer changes this week");
    expect(markup).not.toContain("each with a saved screenshot");
  });
});