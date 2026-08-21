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
  ProofCaptureRecord,
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
  source: "meta_api",
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

  it("hydrates an unlinked event from its stored proof capture instead of emitting an empty plate", () => {
    const event = {
      ...watchEvent,
      adId: null,
      metadata: { advertiser: "boAt", sourceStatus: "proof_backed" },
    };
    const proof: ProofCaptureRecord = {
      id: "proof-1",
      proofTargetId: "target-1",
      status: "succeeded",
      skipReason: null,
      failureCode: null,
      failureReason: null,
      screenshotArtifactKey: null,
      htmlArtifactKey: "landing-pages/proof.html",
      extractedFields: {
        rawHeadline: "Rockerz launch offer",
        ctaText: "Shop now",
        priceText: "₹999",
        formPresent: false,
        canonicalUrl: "https://boat.example.com/rockerz",
      },
      fieldConfidence: {},
      extractionWarnings: [],
      captureMetadata: { captureMethod: "browser_render" },
      renderMode: "mobile",
      deviceProfile: "mobile_default",
      extractorVersion: "lp-signals-v1",
      idempotencyKey: "proof-1",
      attemptedAt: "2026-03-31T00:00:00.000Z",
      succeededAt: "2026-03-31T00:00:01.000Z",
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:01.000Z",
    };

    const report = buildWatchlistReport({
      watchlist,
      events: [event],
      adsById: new Map(),
      proofCapturesByEventId: new Map([[event.id, proof]]),
      generatedAt: "2026-04-01T00:00:00.000Z",
    });

    expect(report.rows[0]).toMatchObject({
      advertiser: "boAt",
      captureReasonCode: null,
      event: {
        sourceUrl: "https://boat.example.com/rockerz",
      },
      landingPage: {
        url: "https://boat.example.com/rockerz",
        headline: "Rockerz launch offer",
        captureLabel: "Checked in browser",
        capturedAt: "2026-03-31T00:00:01.000Z",
        signals: [
          { label: "CTA", value: "Shop now" },
          { label: "Price", value: "₹999" },
          { label: "Form present", value: "No" },
        ],
      },
    });
  });

  it("does not present a failed proof attempt as a successful capture", () => {
    const proof: ProofCaptureRecord = {
      id: "proof-failed",
      proofTargetId: "target-1",
      status: "failed",
      skipReason: null,
      failureCode: "landing_blocked",
      failureReason: "Landing page was blocked.",
      screenshotArtifactKey: null,
      htmlArtifactKey: null,
      extractedFields: {},
      fieldConfidence: {},
      extractionWarnings: [],
      captureMetadata: {
        captureMethod: "browser_render",
        unreadableReasonCode: "landing_blocked",
      },
      renderMode: "mobile",
      deviceProfile: "mobile_default",
      extractorVersion: "lp-signals-v2",
      idempotencyKey: "proof-failed",
      attemptedAt: "2026-04-01T01:00:00.000Z",
      succeededAt: null,
      createdAt: "2026-04-01T01:00:00.000Z",
      updatedAt: "2026-04-01T01:00:00.000Z",
    };

    const report = buildWatchlistReport({
      watchlist,
      events: [watchEvent],
      adsById: new Map([
        [baseAd.metaAdId, { ...baseAd, landingPage: null }],
      ]),
      proofCapturesByEventId: new Map([[watchEvent.id, proof]]),
      generatedAt: "2026-04-01T02:00:00.000Z",
    });

    expect(report.rows[0]).toMatchObject({
      captureReasonCode: "landing_blocked",
      landingPage: {
        captureLabel: null,
        capturedAt: null,
      },
    });
  });

  it("keeps sparse successful proof evidence scoped to the historical capture", () => {
    const proof: ProofCaptureRecord = {
      id: "proof-succeeded",
      proofTargetId: "target-1",
      status: "succeeded",
      skipReason: null,
      failureCode: null,
      failureReason: null,
      screenshotArtifactKey: null,
      htmlArtifactKey: null,
      extractedFields: {},
      fieldConfidence: {},
      extractionWarnings: [],
      captureMetadata: {},
      renderMode: "mobile",
      deviceProfile: "mobile_default",
      extractorVersion: "lp-signals-v2",
      idempotencyKey: "proof-succeeded",
      attemptedAt: "2026-04-01T01:00:00.000Z",
      succeededAt: "2026-04-01T01:00:01.000Z",
      createdAt: "2026-04-01T01:00:00.000Z",
      updatedAt: "2026-04-01T01:00:01.000Z",
    };
    const adWithUnreadableCreative: AdRecord = {
      ...baseAd,
      creativeText: null,
      creativeTextMetadata: {
        unreadableReasonCode: "ocr_provider_failed",
      },
      landingPage: {
        ...baseAd.landingPage!,
        rawHeadline: " ",
      },
    };

    const report = buildWatchlistReport({
      watchlist,
      events: [watchEvent],
      adsById: new Map([[baseAd.metaAdId, adWithUnreadableCreative]]),
      proofCapturesByEventId: new Map([[watchEvent.id, proof]]),
      generatedAt: "2026-04-01T02:00:00.000Z",
    });

    expect(report.rows[0]?.creativeText).toBe("60 Hours Playback\nOnly ₹999");
    expect(report.rows[0]?.captureReasonCode).toBeNull();
    expect(report.rows[0]?.event?.sourceUrl).toBeNull();
    expect(report.rows[0]?.landingPage).toMatchObject({
      url: null,
      headline: null,
      captureLabel: null,
      capturedAt: "2026-04-01T01:00:01.000Z",
      signals: [],
    });
  });

  it("uses current ad and analysis landing evidence when no proof is linked", () => {
    const adWithAnalysisFallback: AdRecord = {
      ...baseAd,
      creativeText: null,
      creativeTextMetadata: {
        unreadableReasonCode: "ocr_provider_failed",
      },
      landingPage: {
        ...baseAd.landingPage!,
        rawHeadline: " ",
      },
    };

    const report = buildWatchlistReport({
      watchlist,
      events: [watchEvent],
      adsById: new Map([[baseAd.metaAdId, adWithAnalysisFallback]]),
      generatedAt: "2026-04-01T02:00:00.000Z",
    });

    expect(report.rows[0]?.creativeText).toBe("60 Hours Playback\nOnly ₹999");
    expect(report.rows[0]?.captureReasonCode).toBeNull();
    expect(report.rows[0]?.landingPage).toMatchObject({
      url: "https://boat.example.com/rockerz-neckband",
      headline: "Buy the new Rockerz neckband",
      captureLabel: "Page text checked",
      capturedAt: "2026-03-31T00:00:00.000Z",
      signals: [
        { label: "CTA", value: "Shop now" },
        { label: "Price", value: "₹999" },
        { label: "Form present", value: "No" },
      ],
    });
  });

  it("does not attach a newer landing failure reason to a linked successful proof", () => {
    const proof: ProofCaptureRecord = {
      id: "proof-succeeded",
      proofTargetId: "target-1",
      status: "succeeded",
      skipReason: null,
      failureCode: null,
      failureReason: null,
      screenshotArtifactKey: null,
      htmlArtifactKey: null,
      extractedFields: {
        rawHeadline: "Historical captured offer",
        ctaText: "Buy now",
        canonicalUrl: "https://historical.example.com/offer",
      },
      fieldConfidence: {},
      extractionWarnings: [],
      captureMetadata: { captureMethod: "landing_page_fetch" },
      renderMode: "mobile",
      deviceProfile: "mobile_default",
      extractorVersion: "lp-signals-v2",
      idempotencyKey: "proof-succeeded",
      attemptedAt: "2026-04-01T01:00:00.000Z",
      succeededAt: "2026-04-01T01:00:01.000Z",
      createdAt: "2026-04-01T01:00:00.000Z",
      updatedAt: "2026-04-01T01:00:01.000Z",
    };
    const adWithNewerLandingFailure: AdRecord = {
      ...baseAd,
      landingPage: {
        ...baseAd.landingPage!,
        metadata: {
          unreadableReasonCode: "landing_blocked",
        },
      },
    };

    const report = buildWatchlistReport({
      watchlist,
      events: [watchEvent],
      adsById: new Map([[baseAd.metaAdId, adWithNewerLandingFailure]]),
      proofCapturesByEventId: new Map([[watchEvent.id, proof]]),
      generatedAt: "2026-04-01T02:00:00.000Z",
    });

    expect(report.rows[0]?.captureReasonCode).toBeNull();
    expect(report.rows[0]?.event?.sourceUrl).toBe("https://historical.example.com/offer");
    expect(report.rows[0]?.landingPage.url).toBe("https://historical.example.com/offer");
    expect(report.rows[0]?.landingPage.headline).toBe("Historical captured offer");
    expect(report.rows[0]?.landingPage.signals).toEqual([
      { label: "CTA", value: "Buy now" },
    ]);
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

	it("includes the stored AI weekly summary when provided", () => {
		const report = buildWatchlistReport({
			watchlist,
			events: [watchEvent],
			adsById: new Map([[baseAd.metaAdId, baseAd]]),
			generatedAt: "2026-04-01T00:00:00.000Z",
			aiWeeklySummary: {
				paragraph:
					"boAt introduced a new ad and left its landing page untouched, so creative rotation was the only movement this week.",
				generatedAt: "2026-03-30T05:01:00.000Z",
				periodEnd: "2026-03-30T05:00:00.000Z",
			},
		});

		expect(report.aiWeeklySummary).toEqual({
			paragraph:
				"boAt introduced a new ad and left its landing page untouched, so creative rotation was the only movement this week.",
			generatedAt: "2026-03-30T05:01:00.000Z",
			periodEnd: "2026-03-30T05:00:00.000Z",
		});
	});

	it("omits the AI weekly summary field entirely when none is stored", () => {
		const withNull = buildWatchlistReport({
			watchlist,
			events: [watchEvent],
			adsById: new Map([[baseAd.metaAdId, baseAd]]),
			generatedAt: "2026-04-01T00:00:00.000Z",
			aiWeeklySummary: null,
		});
		const withoutKey = buildWatchlistReport({
			watchlist,
			events: [watchEvent],
			adsById: new Map([[baseAd.metaAdId, baseAd]]),
			generatedAt: "2026-04-01T00:00:00.000Z",
		});

		expect("aiWeeklySummary" in withNull).toBe(false);
		expect(withNull).toEqual(withoutKey);
	});
});
