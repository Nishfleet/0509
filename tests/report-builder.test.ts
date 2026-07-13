import { describe, expect, it } from "vitest";

import {
  buildCollectionReport,
  buildWatchlistReport,
} from "~/lib/report-builder.server";
import {
  createReportId,
  parseReportId,
} from "~/lib/report";
import type {
  AdRecord,
  CollectionItemRecord,
  CollectionRecord,
  WatchEventRecord,
  WatchlistRecord,
} from "~/lib/types";

const baseAd: AdRecord = {
  metaAdId: "meta-boat-1",
  advertiser: "boAt",
  body: "Bass bhi, battery bhi.",
  previewHeadline: "Bass bhi. Battery bhi.",
  previewSubhead: "Launch pricing",
  hook: "Bass bhi. Battery bhi.",
  offer: "Launch pricing",
  cta: "Buy now",
  format: "video",
  languageLabel: "Hinglish",
  destinationType: "website",
  landingPageUrl: "https://boat.example.com/rockerz-neckband",
  adSnapshotUrl: "https://cdn.example.com/boat.png",
  countries: ["India"],
  platforms: ["Instagram"],
  firstSeenAt: "2026-03-30T00:00:00.000Z",
  lastSeenAt: "2026-03-31T00:00:00.000Z",
  active: true,
  researchSummary: "Summary",
  source: "demo",
  analysisFields: [
    {
      scopeType: "ad",
      fieldKey: "hook",
      fieldValue: "Bass bhi. Battery bhi.",
      provenanceSource: "user",
      extractorVersion: "v1",
      confidence: 0.86,
    },
    {
      scopeType: "ad",
      fieldKey: "ocr_text",
      fieldValue: "60 Hours Playback\nOnly ₹999",
      provenanceSource: "ad_snapshot_fetch",
      extractorVersion: "creative-text-v2",
      confidence: 0.72,
    },
    {
      scopeType: "ad",
      fieldKey: "landing_page_headline_summary",
      fieldValue: "Buy the new Rockerz neckband",
      provenanceSource: "landing_page_fetch",
      extractorVersion: "v1",
      confidence: 0.92,
    },
  ],
  creativeText: "60 Hours Playback\nOnly ₹999",
  creativeTextCaptureMethod: "ad_snapshot_fetch",
  creativeTextMetadata: {
    fetchStatus: 200,
  },
  landingPage: {
    rawUrl: "https://boat.example.com/rockerz-neckband",
    canonicalUrl: "https://boat.example.com/rockerz-neckband",
    rawHeadline: "Buy the new Rockerz neckband",
    normalizedHeadline: "buy the new rockerz neckband",
    normalizedHeadlineHash: "hash-1",
    ctaText: "Shop now",
    priceText: "₹999",
    formPresent: false,
    captureMethod: "landing_page_fetch",
    capturedAt: "2026-03-31T00:00:00.000Z",
    artifactKey: null,
    metadata: {
      fetchStatus: 200,
    },
  },
  tags: [],
};

const collection: CollectionRecord = {
  id: "collection-1",
  userId: "user-1",
  name: "Audio launch board",
  description: "Best recent audio launch ads for client review.",
  createdAt: "2026-03-31T00:00:00.000Z",
  updatedAt: "2026-03-31T00:00:00.000Z",
};

const collectionItem: CollectionItemRecord = {
  id: "collection-item-1",
  collectionId: "collection-1",
  adId: "meta-boat-1",
  note: "Strong price framing for launch week.",
  createdAt: "2026-03-31T00:00:00.000Z",
  updatedAt: "2026-03-31T00:00:00.000Z",
  ad: baseAd,
  tags: ["audio", "launch"],
};

const watchlist: WatchlistRecord = {
  id: "watch-1",
  userId: "user-1",
  name: "Audio competitors",
  targetType: "advertiser",
  targetId: "boAt",
  targetFingerprint: "watch-fingerprint",
  targetLabel: "boAt",
  targetCountry: null,
  isActive: true,
  lastScannedAt: "2026-03-31T00:00:00.000Z",
  createdAt: "2026-03-30T00:00:00.000Z",
  updatedAt: "2026-03-31T00:00:00.000Z",
};

const watchEvent: WatchEventRecord = {
  id: "event-1",
  watchlistId: "watch-1",
  runId: "run-1",
  eventType: "ad_new",
  status: "confirmed",
  importanceScore: 65,
  adId: "meta-boat-1",
  baselineFromRunId: null,
  candidateId: null,
  proofCaptureId: "proof-1",
  title: "New ad detected",
  summary: "A new ad entered Audio competitors.",
  metadata: {
    advertiser: "boAt",
    sourceStatus: "proof_backed",
  },
  confirmedAt: "2026-03-31T00:00:00.000Z",
  suppressedAt: null,
  invalidatedAt: null,
  lastEvaluatedAt: "2026-03-31T00:00:00.000Z",
  createdAt: "2026-03-31T00:00:00.000Z",
};

describe("report identifiers", () => {
  it("creates and parses resource-backed report ids", () => {
    const reportId = createReportId("collection", "collection-1");

    expect(reportId).toBe("collection:collection-1");
    expect(parseReportId(reportId)).toEqual({
      resourceType: "collection",
      resourceId: "collection-1",
    });
    expect(parseReportId("digest:digest-1")).toBeNull();
    expect(parseReportId("watchlist:")).toBeNull();
  });
});

describe("buildCollectionReport", () => {
  it("builds a client-ready collection report with ad context and landing-page signals", () => {
    const report = buildCollectionReport({
      collection,
      items: [collectionItem],
      generatedAt: "2026-04-01T00:00:00.000Z",
    });

    expect(report.reportId).toBe("collection:collection-1");
    expect(report.resourceType).toBe("collection");
    expect(report.rows).toHaveLength(1);
    expect(report.stats).toEqual([
      { label: "Ads", value: "1" },
      { label: "Countries", value: "India" },
      { label: "Platforms", value: "Instagram" },
    ]);
    expect(report.insightDepth.topHooks[0]).toMatchObject({
      label: "Bass bhi. Battery bhi.",
      count: 1,
    });
    expect(report.insightDepth.mediaMix[0]).toMatchObject({
      label: "Instagram",
      count: 1,
    });
    expect(report.rows[0]).toMatchObject({
      advertiser: "boAt",
      previewImageUrl: "https://cdn.example.com/boat.png",
      languageLabel: "Hinglish",
      creativeText: "60 Hours Playback\nOnly ₹999",
      translatedText: null,
      note: "Strong price framing for launch week.",
      tags: ["audio", "launch"],
      landingPage: {
        url: "https://boat.example.com/rockerz-neckband",
        headline: "Buy the new Rockerz neckband",
      },
    });
    expect(report.rows[0].landingPage.signals).toEqual([
      { label: "CTA", value: "Shop now" },
      { label: "Price", value: "₹999" },
      { label: "Form present", value: "No" },
    ]);
    expect(report.rows[0].analysisFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "OCR text",
          value: "60 Hours Playback\nOnly ₹999",
          sourceLabel: "Ad snapshot",
        }),
      ]),
    );
  });
});

describe("buildWatchlistReport", () => {
  it("includes watch events alongside linked ad context when ads are available", () => {
    const report = buildWatchlistReport({
      watchlist,
      events: [watchEvent],
      adsById: new Map([[baseAd.metaAdId, baseAd]]),
      generatedAt: "2026-04-01T00:00:00.000Z",
    });

    expect(report.reportId).toBe("watchlist:watch-1");
    expect(report.resourceType).toBe("watchlist");
    expect(report.stats).toEqual([
      { label: "Events", value: "1" },
      { label: "Linked ads", value: "1" },
      { label: "Event types", value: "New ad" },
      { label: "Excluded", value: "0" },
    ]);
    expect(report.sourceCoverage).toMatchObject({
      totalInput: 1,
      included: 1,
      excluded: 0,
    });
    expect(report.insightDepth.creativeTimeline[0]).toMatchObject({
      label: "New ad detected",
      detail: "A new ad entered Audio competitors.",
    });
    expect(report.rows[0]).toMatchObject({
      advertiser: "boAt",
      event: {
        typeLabel: "New ad",
        title: "New ad detected",
        summary: "A new ad entered Audio competitors.",
        proofStatusLabel: "Verified evidence",
        sourceTypeLabel: "Saved evidence",
        sourceUrl: "https://cdn.example.com/boat.png",
        metaAdId: "meta-boat-1",
      },
      creativeText: "60 Hours Playback\nOnly ₹999",
      translatedText: null,
    });
  });

  it("emits null for missing fields instead of placeholder prose", () => {
    const report = buildWatchlistReport({
      watchlist,
      events: [
        {
          ...watchEvent,
          adId: "meta-missing",
          metadata: { sourceStatus: "proof_backed" },
        },
      ],
      adsById: new Map(),
      generatedAt: "2026-04-01T00:00:00.000Z",
    });

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      advertiser: null,
      previewHeadline: "New ad detected",
      offer: null,
      cta: null,
      languageLabel: null,
      creativeText: null,
      translatedText: null,
      landingPage: {
        url: null,
        headline: null,
        captureLabel: null,
        capturedAt: null,
        signals: [],
      },
    });
    expect(JSON.stringify(report)).not.toMatch(/unavailable/i);
  });

  it("keeps the advertiser fallback from event metadata when the ad is missing", () => {
    const report = buildWatchlistReport({
      watchlist,
      events: [{ ...watchEvent, adId: "meta-missing" }],
      adsById: new Map(),
      generatedAt: "2026-04-01T00:00:00.000Z",
    });

    expect(report.rows[0].advertiser).toBe("boAt");
  });

  it("omits undetected landing-page signals instead of rendering filler", () => {
    const sparseAd: AdRecord = {
      ...baseAd,
      landingPage: {
        ...baseAd.landingPage!,
        ctaText: null,
        priceText: "₹999",
        formPresent: null,
      },
    };

    const report = buildCollectionReport({
      collection,
      items: [{ ...collectionItem, ad: sparseAd }],
      generatedAt: "2026-04-01T00:00:00.000Z",
    });

    expect(report.rows[0].landingPage.signals).toEqual([
      { label: "Price", value: "₹999" },
    ]);
  });

  it("excludes non-client-ready watch events from proof-backed reports", () => {
    const unsafeEvents: WatchEventRecord[] = [
      {
        ...watchEvent,
        id: "event-scan",
        proofCaptureId: null,
        metadata: { advertiser: "boAt", sourceStatus: "scan_backed" },
      },
      {
        ...watchEvent,
        id: "event-failed",
        status: "proof_failed",
        proofCaptureId: null,
        metadata: { advertiser: "boAt", sourceStatus: "proof_failed" },
      },
      {
        ...watchEvent,
        id: "event-suppressed",
        status: "suppressed",
        suppressedAt: "2026-04-01T00:00:00.000Z",
      },
    ];

    const report = buildWatchlistReport({
      watchlist,
      events: [watchEvent, ...unsafeEvents],
      adsById: new Map([[baseAd.metaAdId, baseAd]]),
      generatedAt: "2026-04-01T00:00:00.000Z",
    });

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].event?.title).toBe("New ad detected");
    expect(report.sourceCoverage).toMatchObject({
      totalInput: 4,
      included: 1,
      excluded: 3,
    });
  });
});
