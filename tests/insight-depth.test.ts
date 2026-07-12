import { describe, expect, it } from "vitest";

import {
  buildCollectionInsightDepth,
  buildDigestInsightDepth,
  buildDigestTrendRollups,
  buildWatchlistInsightDepth,
  formatInsightDepthMarkdown,
} from "~/lib/insight-depth";
import type { AdRecord, CollectionItemRecord, DigestItemRecord, WatchEventRecord } from "~/lib/types";

const ad: AdRecord = {
  metaAdId: "meta-1",
  advertiser: "Nykaa",
  body: "Build your routine.",
  previewHeadline: "Routine bundle",
  previewSubhead: "Skincare",
  hook: "Routine-first bundle",
  offer: "Bundle and save",
  cta: "Build your routine",
  format: "image",
  languageLabel: "English",
  destinationType: "website",
  landingPageUrl: "https://nykaa.example/routine",
  adSnapshotUrl: "https://facebook.example/ad",
  countries: ["India"],
  platforms: ["Instagram", "Facebook"],
  firstSeenAt: "2026-04-10T00:00:00.000Z",
  lastSeenAt: "2026-04-18T00:00:00.000Z",
  active: true,
  researchSummary: "Nykaa is repeating a routine hook.",
  source: "meta_library_browser",
  analysisFields: [],
  landingPage: {
    rawUrl: "https://nykaa.example/routine?utm=ad",
    canonicalUrl: "https://nykaa.example/routine",
    rawHeadline: "Build your skincare routine",
    normalizedHeadline: "build your skincare routine",
    normalizedHeadlineHash: "headline-hash",
    ctaText: "Build your routine",
    priceText: "From ₹799",
    formPresent: false,
    captureMethod: "landing_page_fetch",
    capturedAt: "2026-04-18T00:00:00.000Z",
    artifactKey: "landing-pages/nykaa.html",
  },
};

const item: CollectionItemRecord = {
  id: "item-1",
  collectionId: "collection-1",
  adId: "meta-1",
  note: null,
  createdAt: "2026-04-18T00:00:00.000Z",
  updatedAt: "2026-04-18T00:00:00.000Z",
  ad,
  tags: ["beauty"],
};

const event: WatchEventRecord = {
  id: "event-1",
  watchlistId: "watch-1",
  runId: "run-1",
  eventType: "landing_page_offer_changed",
  status: "confirmed",
  importanceScore: 88,
  adId: "meta-1",
  baselineFromRunId: null,
  candidateId: "candidate-1",
  proofCaptureId: "proof-1",
  title: "Landing page offer changed",
  summary: "Offer changed from sale-led to routine-led.",
  metadata: {
    from: "Sale-led hero",
    to: "Routine-first bundle",
  },
  confirmedAt: "2026-04-19T00:00:00.000Z",
  suppressedAt: null,
  invalidatedAt: null,
  lastEvaluatedAt: "2026-04-19T00:00:00.000Z",
  createdAt: "2026-04-19T00:00:00.000Z",
};

const digestItem: DigestItemRecord = {
  id: "digest-item-1",
  digestRunId: "digest-1",
  watchlistId: "watch-1",
  watchlistName: "Nykaa watch",
  eventType: "landing_page_offer_changed",
  title: "Landing page offer changed",
  summary: "Offer changed from sale-led to routine-led.",
  metadata: {
    from: "Sale-led hero",
    to: "Routine-first bundle",
  },
  createdAt: "2026-04-19T00:00:00.000Z",
};

describe("insight depth", () => {
  it("summarizes saved collection proof into hooks, media mix, timeline, and landing-page context", () => {
    const summary = buildCollectionInsightDepth([item]);

    expect(summary.topHooks[0]).toMatchObject({
      label: "Routine-first bundle",
      count: 1,
      detail: "Nykaa",
    });
    expect(summary.mediaMix.map((entry) => entry.label)).toEqual(["Facebook", "Instagram"]);
    expect(summary.campaignDurations[0]).toMatchObject({
      label: "One-week run",
      count: 1,
      detail: "Nykaa - 8 observed days - active",
    });
    expect(summary.creativeTimeline[0]).toMatchObject({
      label: "Nykaa",
      detail: "Bundle and save",
    });
    expect(summary.landingPageHistory[0]?.detail).toContain("Build your skincare routine");
    expect(summary.landingPageHistory[0]?.detail).toContain("CTA: Build your routine");
  });

  it("falls back to Meta media mix when legacy collection snapshots lack platforms", () => {
    const legacyAd = { ...ad } as Partial<AdRecord>;
    delete legacyAd.platforms;

    const summary = buildCollectionInsightDepth([
      { ...item, ad: legacyAd as AdRecord },
    ]);

    expect(summary.mediaMix[0]).toMatchObject({
      label: "Meta",
      count: 1,
      detail: "Nykaa",
    });
    expect(summary.campaignDurations[0]?.label).toBe("One-week run");
  });

  it("uses saved observation time for active ads whose last-seen date is only a first-seen fallback", () => {
    const summary = buildCollectionInsightDepth([
      {
        ...item,
        createdAt: "2026-04-18T00:00:00.000Z",
        ad: {
          ...ad,
          firstSeenAt: "2026-04-01T00:00:00.000Z",
          lastSeenAt: "2026-04-01T00:00:00.000Z",
          active: true,
        },
      },
    ]);

    expect(summary.campaignDurations[0]).toMatchObject({
      label: "Multi-week run",
      count: 1,
      detail: "Nykaa - 17 observed days - active",
    });
  });

  it("summarizes manual spend, reach, and impression proof when saved on collection items", () => {
    const summary = buildCollectionInsightDepth([
      {
        ...item,
        ad: {
          ...ad,
          advertiser: "Mamaearth",
          platforms: ["LinkedIn"],
          analysisFields: [
            {
              scopeType: "ad",
              fieldKey: "observed_spend",
              fieldValue: "₹50k",
              provenanceSource: "user",
              extractorVersion: "manual-external-proof-v1",
              confidence: 1,
            },
            {
              scopeType: "ad",
              fieldKey: "observed_impressions",
              fieldValue: "120k",
              provenanceSource: "user",
              extractorVersion: "manual-external-proof-v1",
              confidence: 1,
            },
            {
              scopeType: "ad",
              fieldKey: "observed_reach",
              fieldValue: "80k",
              provenanceSource: "user",
              extractorVersion: "manual-external-proof-v1",
              confidence: 1,
            },
          ],
        },
      },
    ]);

    expect(summary.metricProof[0]).toMatchObject({
      label: "Mamaearth",
      count: 1,
      detail: "Spend: ₹50k | Impressions: 120k | Reach: 80k - LinkedIn",
    });
  });

  it("summarizes watch events into landing-page change history", () => {
    const summary = buildWatchlistInsightDepth([event]);

    expect(summary.topHooks[0]).toMatchObject({
      label: "Pending",
      detail: "No repeated hooks yet.",
    });
    expect(summary.mediaMix[0]).toMatchObject({ label: "Landing page", count: 1 });
    expect(summary.campaignDurations[0]).toMatchObject({
      label: "Pending",
      detail: "No duration evidence yet.",
    });
    expect(summary.landingPageHistory[0]).toMatchObject({
      label: "Landing page offer changed",
      detail: "Sale-led hero -> Routine-first bundle",
    });
  });

  it("formats digest insight depth for Slack-ready markdown", () => {
    const summary = buildDigestInsightDepth([digestItem]);
    const markdown = formatInsightDepthMarkdown(summary);

    expect(markdown).toContain("*Insight depth*");
    expect(markdown).toContain("_Top hooks_");
    expect(markdown).toContain("_Observed campaign duration_");
    expect(markdown).toContain("_Landing-page history_");
    expect(markdown).toContain("Sale-led hero -> Routine-first bundle");
  });

  it("builds compact weekly trend rollups from sourced digest event types", () => {
    const lines = buildDigestTrendRollups([
      {
        eventType: "landing_page_offer_changed",
        title: "Offer changed",
        summary: "Price drop",
        metadata: { hook: "Routine-first bundle" },
        createdAt: "2026-04-19T00:00:00.000Z",
      },
      {
        eventType: "landing_page_offer_changed",
        title: "Offer changed again",
        summary: "Another price drop",
        metadata: { hook: "Routine-first bundle" },
        createdAt: "2026-04-20T00:00:00.000Z",
      },
      {
        eventType: "landing_page_cta_changed",
        title: "CTA changed",
        summary: "Shop now",
        metadata: {},
        createdAt: "2026-04-21T00:00:00.000Z",
      },
      {
        eventType: "ad_new",
        title: "New ad",
        summary: "Fresh creative",
        metadata: {},
        createdAt: "2026-04-22T00:00:00.000Z",
      },
    ]);

    expect(lines.map((line) => line.text)).toEqual(
      expect.arrayContaining([
        "Changed pricing 2× this period",
        "Changed CTAs 1× this period",
        "1 new ad spotted this period",
        "Top hook (2×): Routine-first bundle",
      ]),
    );
    expect(buildDigestTrendRollups([])).toEqual([]);
  });
});
