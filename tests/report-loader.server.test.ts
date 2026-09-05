import { describe, expect, it, vi } from "vitest";

import type { AppEnv } from "~/lib/env.server";
import {
  loadOwnedReportDocument,
  type OwnedReportDataSource,
} from "~/lib/report-loader.server";
import type {
  AdRecord,
  CollectionItemRecord,
  CollectionRecord,
  ProofCaptureRecord,
  WatchEventRecord,
  WatchlistRecord,
} from "~/lib/types";

const env = {} as AppEnv;
const now = "2026-07-01T00:00:00.000Z";

const ad: AdRecord = {
  metaAdId: "ad-1",
  advertiser: "Acme",
  body: "A proven message.",
  previewHeadline: "Proof",
  previewSubhead: "",
  hook: "A proven message.",
  offer: "",
  cta: "Learn more",
  format: "image",
  languageLabel: "English",
  destinationType: "website",
  landingPageUrl: null,
  adSnapshotUrl: null,
  countries: [],
  platforms: [],
  firstSeenAt: now,
  lastSeenAt: now,
  active: true,
  researchSummary: "",
  source: "external",
  analysisFields: [],
  creativeText: null,
  creativeTextCaptureMethod: null,
  creativeTextMetadata: {},
  landingPage: null,
  tags: [],
};

const collection: CollectionRecord = {
  id: "collection-1",
  userId: "user-1",
  name: "Board",
  description: null,
  createdAt: now,
  updatedAt: now,
};

const collectionItem: CollectionItemRecord = {
  id: "item-1",
  collectionId: collection.id,
  adId: ad.metaAdId,
  note: "Saved",
  createdAt: now,
  updatedAt: now,
  ad,
  tags: ["proof"],
};

const watchlist: WatchlistRecord = {
  id: "watch-1",
  userId: "user-1",
  name: "Watch",
  targetType: "advertiser",
  targetId: "Acme",
  targetFingerprint: "fp",
  targetLabel: "Acme",
  targetCountry: null,
  isActive: true,
  lastScannedAt: now,
  createdAt: now,
  updatedAt: now,
};

const confirmedEvent: WatchEventRecord = {
  id: "event-1",
  watchlistId: watchlist.id,
  runId: "run-1",
  eventType: "ad_new",
  status: "confirmed",
  importanceScore: 65,
  adId: ad.metaAdId,
  baselineFromRunId: null,
  candidateId: null,
  proofCaptureId: "proof-1",
  title: "New ad",
  summary: "A new ad appeared.",
  metadata: { sourceStatus: "proof_backed" },
  confirmedAt: now,
  suppressedAt: null,
  invalidatedAt: null,
  lastEvaluatedAt: now,
  createdAt: now,
};

function createDataSource(): OwnedReportDataSource {
  return {
    getCollection: vi.fn(async () => null),
    getLatestDigestRunSummaryForWatchlist: vi.fn(async () => null),
    getWatchlist: vi.fn(async () => null),
    listAdsByIds: vi.fn(async () => []),
    listCollectionItems: vi.fn(async () => []),
    listProofCapturePairsForEventIds: vi.fn(async () => []),
    listWatchEvents: vi.fn(async () => []),
  };
}

describe("loadOwnedReportDocument", () => {
  it("loads an owner-scoped collection and skips watchlist sources", async () => {
    const data = createDataSource();
    vi.mocked(data.getCollection).mockResolvedValue(collection);
    vi.mocked(data.listCollectionItems).mockResolvedValue([collectionItem]);

    const report = await loadOwnedReportDocument(
      env,
      "user-1",
      "collection:collection-1",
      data,
      { verifyReportIdentity: true },
    );

    expect(data.getCollection).toHaveBeenCalledWith(env, collection.id, "user-1");
    expect(data.listCollectionItems).toHaveBeenCalledWith(env, collection.id);
    expect(data.getWatchlist).not.toHaveBeenCalled();
    expect(data.listWatchEvents).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      reportId: "collection:collection-1",
      resourceType: "collection",
      resourceId: collection.id,
      rows: [expect.objectContaining({ advertiser: "Acme", note: "Saved" })],
    });
  });

  it("loads watchlist evidence, coverage, and the stored summary", async () => {
    const data = createDataSource();
    const excludedEvent: WatchEventRecord = {
      ...confirmedEvent,
      id: "event-2",
      adId: "ad-2",
      status: "proof_failed",
      proofCaptureId: null,
      metadata: { sourceStatus: "proof_failed" },
    };
    vi.mocked(data.getWatchlist).mockResolvedValue(watchlist);
    vi.mocked(data.listWatchEvents).mockResolvedValue([confirmedEvent, excludedEvent]);
    vi.mocked(data.listAdsByIds).mockResolvedValue([ad]);
    const proof = {
      id: "proof-1",
      proofTargetId: "target-1",
      status: "succeeded",
      skipReason: null,
      failureCode: null,
      failureReason: null,
      screenshotArtifactKey: null,
      htmlArtifactKey: null,
      extractedFields: { rawHeadline: "Stored landing proof" },
      fieldConfidence: {},
      extractionWarnings: [],
      captureMetadata: { captureMethod: "landing_page_fetch" },
      renderMode: "mobile",
      deviceProfile: "mobile_default",
      extractorVersion: "lp-signals-v1",
      idempotencyKey: "proof-1",
      attemptedAt: now,
      succeededAt: now,
      createdAt: now,
      updatedAt: now,
    } satisfies ProofCaptureRecord;
    vi.mocked(data.listProofCapturePairsForEventIds).mockResolvedValue([
      { eventId: confirmedEvent.id, current: proof, previous: null },
    ]);
    vi.mocked(data.getLatestDigestRunSummaryForWatchlist).mockResolvedValue({
      paragraph: "Stored strategy",
      generatedAt: now,
      periodEnd: "2026-06-30T00:00:00.000Z",
    });

    const report = await loadOwnedReportDocument(
      env,
      "user-1",
      "watchlist:watch-1",
      data,
      { parallelWatchlistLookups: true },
    );

    expect(data.getWatchlist).toHaveBeenCalledWith(env, watchlist.id, "user-1");
    expect(data.listWatchEvents).toHaveBeenCalledWith(env, watchlist.id, 60);
    expect(data.listAdsByIds).toHaveBeenCalledWith(env, ["ad-1", "ad-2"]);
    expect(data.listProofCapturePairsForEventIds).toHaveBeenCalledWith(
      env,
      "user-1",
      ["event-1", "event-2"],
      { includePrevious: false },
    );
    expect(data.getLatestDigestRunSummaryForWatchlist).toHaveBeenCalledWith(
      env,
      "user-1",
      watchlist.id,
    );
    expect(report).toMatchObject({
      reportId: "watchlist:watch-1",
      resourceType: "watchlist",
      rows: [
        expect.objectContaining({
          advertiser: "Acme",
          landingPage: expect.objectContaining({ headline: "Stored landing proof" }),
        }),
      ],
      sourceCoverage: { totalInput: 2, included: 1, excluded: 1 },
      aiWeeklySummary: { paragraph: "Stored strategy" },
    });
  });

  it("applies the route-specific inactive-watchlist policy before evidence reads", async () => {
    const data = createDataSource();
    vi.mocked(data.getWatchlist).mockResolvedValue({ ...watchlist, isActive: false });

    await expect(
      loadOwnedReportDocument(env, "user-1", "watchlist:watch-1", data, {
        requireActiveWatchlist: true,
      }),
    ).resolves.toBeNull();
    expect(data.listWatchEvents).not.toHaveBeenCalled();

    await expect(
      loadOwnedReportDocument(env, "user-1", "watchlist:watch-1", data),
    ).resolves.toMatchObject({ reportId: "watchlist:watch-1" });
    expect(data.listWatchEvents).toHaveBeenCalledTimes(1);
  });

  it("fails closed for invalid IDs and optional identity mismatches", async () => {
    const data = createDataSource();
    await expect(
      loadOwnedReportDocument(env, "user-1", "digest:nope", data),
    ).resolves.toBeNull();
    expect(data.getCollection).not.toHaveBeenCalled();
    expect(data.getWatchlist).not.toHaveBeenCalled();

    vi.mocked(data.getCollection).mockResolvedValue({ ...collection, id: "actual" });
    await expect(
      loadOwnedReportDocument(env, "user-1", "collection:requested", data, {
        verifyReportIdentity: true,
      }),
    ).resolves.toBeNull();
    await expect(
      loadOwnedReportDocument(env, "user-1", "collection:requested", data),
    ).resolves.toMatchObject({ reportId: "collection:actual" });
  });

  it("preserves sequential client reads and parallel report reads", async () => {
    for (const parallelWatchlistLookups of [false, true]) {
      const data = createDataSource();
      vi.mocked(data.getWatchlist).mockResolvedValue(watchlist);
      vi.mocked(data.listWatchEvents).mockResolvedValue([confirmedEvent]);

      let releaseAds!: () => void;
      const adsGate = new Promise<void>((resolve) => {
        releaseAds = resolve;
      });
      vi.mocked(data.listAdsByIds).mockImplementation(async () => {
        await adsGate;
        return [ad];
      });

      const loading = loadOwnedReportDocument(
        env,
        "user-1",
        "watchlist:watch-1",
        data,
        { parallelWatchlistLookups },
      );
      await vi.waitFor(() => expect(data.listAdsByIds).toHaveBeenCalledOnce());
      if (parallelWatchlistLookups) {
        expect(data.getLatestDigestRunSummaryForWatchlist).toHaveBeenCalledOnce();
      } else {
        expect(data.getLatestDigestRunSummaryForWatchlist).not.toHaveBeenCalled();
      }

      releaseAds();
      await loading;
      expect(data.getLatestDigestRunSummaryForWatchlist).toHaveBeenCalledOnce();
    }
  });
});
