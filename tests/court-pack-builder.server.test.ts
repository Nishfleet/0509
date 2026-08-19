import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildCourtPack } from "~/lib/court-pack-builder.server";
import {
  createApprovedReportSnapshot,
  reportEvidenceFingerprint,
} from "~/lib/report-approval";
import { getWorkspaceBranding } from "~/lib/data/workspace-branding.server";
import type { AppEnv } from "~/lib/env.server";
import type { OwnedReportDataSource } from "~/lib/report-loader.server";
import {
  COURT_PACK_EXCLUSION_REASON_CODES,
  type CourtPack,
} from "~/lib/court-pack";
import type {
  AdRecord,
  ClientRoomRecord,
  ClientRoomResourceRef,
  CollectionItemRecord,
  CollectionRecord,
  ProofCaptureRecord,
  WatchEventRecord,
  WatchlistRecord,
} from "~/lib/types";

vi.mock("~/lib/data/workspace-branding.server", () => ({
  getWorkspaceBranding: vi.fn(),
}));

const env = {} as AppEnv;
const now = "2026-07-15T08:00:00.000Z";

const collectionAd: AdRecord = {
  metaAdId: "ad-col-1",
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
  landingPageUrl: "https://example.com/proof",
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
  landingPage: {
    rawUrl: "https://example.com/proof",
    canonicalUrl: "https://example.com/proof",
    rawHeadline: "Proof headline",
    normalizedHeadline: "Proof headline",
    normalizedHeadlineHash: "h",
    captureMethod: "landing_page_fetch",
    capturedAt: "2026-07-15T07:55:00.000Z",
  },
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
  adId: collectionAd.metaAdId,
  note: "Saved",
  createdAt: now,
  updatedAt: now,
  ad: collectionAd,
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
  adId: collectionAd.metaAdId,
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

const proof: ProofCaptureRecord = {
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

function collectionReadyDataSource() {
  const data = createDataSource();
  vi.mocked(data.getCollection).mockResolvedValue(collection);
  vi.mocked(data.listCollectionItems).mockResolvedValue([collectionItem]);
  return data;
}

function watchlistReadyDataSource() {
  const data = createDataSource();
  vi.mocked(data.getWatchlist).mockResolvedValue(watchlist);
  vi.mocked(data.listWatchEvents).mockResolvedValue([confirmedEvent]);
  vi.mocked(data.listAdsByIds).mockResolvedValue([collectionAd]);
  vi.mocked(data.listProofCapturePairsForEventIds).mockResolvedValue([
    { eventId: confirmedEvent.id, current: proof, previous: null },
  ]);
  return data;
}

function reportRef(resourceId: string, label: string): ClientRoomResourceRef {
  return { resourceType: "report", resourceId, label };
}

function room(
  refs: ClientRoomResourceRef[],
  notes: Record<string, unknown> = {},
): ClientRoomRecord {
  return {
    id: "room-1",
    userId: "user-1",
    name: "Nykaa weekly desk",
    clientLabel: "Nykaa",
    status: "active",
    resourceRefs: refs,
    notes,
    createdAt: now,
    updatedAt: now,
  };
}

function validApprovalMetadata(reportId: string) {
  const data = reportId.startsWith("collection:")
    ? collectionReadyDataSource()
    : watchlistReadyDataSource();
  return { data };
}

async function approvalForReport(reportId: string) {
  const { loadOwnedReportDocument } = await import(
    "~/lib/report-loader.server"
  );
  const data = reportId.startsWith("collection:")
    ? collectionReadyDataSource()
    : watchlistReadyDataSource();
  const report = await loadOwnedReportDocument(env, "user-1", reportId, data, {
    verifyReportIdentity: true,
  });
  if (!report) {
    throw new Error(`fixture report failed to load: ${reportId}`);
  }
  const reviewedAt = new Date(Date.now() - 60_000).toISOString();
  const approved = createApprovedReportSnapshot(report, reviewedAt);
  if (!approved) {
    throw new Error(`fixture report failed approval: ${reportId}`);
  }
  return {
    data,
    metadata: {
      evidenceFingerprint: approved.evidenceFingerprint,
      reviewedAt: approved.reviewedAt,
      approvalExpiresAt: approved.approvalExpiresAt,
    },
  };
}

beforeEach(() => {
  vi.mocked(getWorkspaceBranding).mockResolvedValue({
    brandName: null,
    brandWebsite: null,
    brandLogo: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildCourtPack", () => {
  it("includes an approved, current report as plate 1 with the full document", async () => {
    const { data, metadata } = await approvalForReport("collection:collection-1");
    const pack = await buildCourtPack(
      env,
      "user-1",
      room([reportRef("collection:collection-1", "Board report")], {
        reportApprovals: { "collection:collection-1": metadata },
      }),
      data,
    );

    expect(pack.plates).toHaveLength(1);
    expect(pack.plates[0]).toMatchObject({
      plateNumber: 1,
      reportId: "collection:collection-1",
      resourceType: "collection",
      title: "Board",
    });
    expect(pack.sections).toHaveLength(1);
    expect(pack.sections[0].report.rows[0].advertiser).toBe("Acme");
    expect(pack.sections[0].reviewedAt).toBe(metadata.reviewedAt);
    expect(pack.sections[0].approvalExpiresAt).toBe(metadata.approvalExpiresAt);
    expect(pack.sections[0].evidenceFingerprint).toBe(
      metadata.evidenceFingerprint,
    );
    expect(pack.excluded).toEqual([]);
    expect(pack.hasNothingToPack).toBe(false);
    expect(pack.coverage).toMatchObject({
      approvedReports: 1,
      includedSections: 1,
      excluded: 0,
      plates: 1,
    });
  });

  it("numbers multiple approved reports gap-free and deterministically", async () => {
    const collectionApproval = await approvalForReport(
      "collection:collection-1",
    );
    const watchlistApproval = await approvalForReport("watchlist:watch-1");
    const data = collectionApproval.data;
    vi.mocked(data.getWatchlist).mockResolvedValue(watchlist);
    vi.mocked(data.listWatchEvents).mockResolvedValue([confirmedEvent]);
    vi.mocked(data.listAdsByIds).mockResolvedValue([collectionAd]);
    vi.mocked(data.listProofCapturePairsForEventIds).mockResolvedValue([
      { eventId: confirmedEvent.id, current: proof, previous: null },
    ]);

    const build = () =>
      buildCourtPack(
        env,
        "user-1",
        room(
          [
            reportRef("watchlist:watch-1", "Watch report"),
            reportRef("collection:collection-1", "Board report"),
          ],
          {
            reportApprovals: {
              "watchlist:watch-1": watchlistApproval.metadata,
              "collection:collection-1": collectionApproval.metadata,
            },
          },
        ),
        data,
      );

    const first = await build();
    const second = await build();
    expect(first.plates.map((plate) => plate.plateNumber)).toEqual([1, 2]);
    expect(first.plates.map((plate) => plate.reportId)).toEqual([
      "collection:collection-1",
      "watchlist:watch-1",
    ]);
    expect(first.plates).toEqual(second.plates);
    expect(first.coverage.plates).toBe(2);
  });

  it("excludes a report with no approval entry as no_approval", async () => {
    const { data } = validApprovalMetadata("collection:collection-1");
    const pack = await buildCourtPack(
      env,
      "user-1",
      room([reportRef("collection:collection-1", "Board report")], {}),
      data,
    );

    expect(pack.plates).toEqual([]);
    expect(pack.sections).toEqual([]);
    expect(pack.hasNothingToPack).toBe(true);
    expect(pack.excluded).toHaveLength(1);
    expect(pack.excluded[0]).toMatchObject({
      reportId: "collection:collection-1",
      resourceType: "collection",
      resourceLabel: "Board report",
      reasonCode: COURT_PACK_EXCLUSION_REASON_CODES.noApproval,
    });
  });

  it("excludes an expired approval as approval_expired", async () => {
    const { data } = validApprovalMetadata("collection:collection-1");
    const expiredMetadata = {
      evidenceFingerprint: "sha256:stale",
      reviewedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      approvalExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    };
    const pack = await buildCourtPack(
      env,
      "user-1",
      room(
        [reportRef("collection:collection-1", "Board report")],
        { reportApprovals: { "collection:collection-1": expiredMetadata } },
      ),
      data,
    );

    expect(pack.plates).toEqual([]);
    expect(pack.excluded[0].reasonCode).toBe(
      COURT_PACK_EXCLUSION_REASON_CODES.approvalExpired,
    );
    expect(pack.coverage.excludedByReason.approval_expired).toBe(1);
  });

  it("excludes a malformed approval as approval_invalid", async () => {
    const { data } = validApprovalMetadata("collection:collection-1");
    const pack = await buildCourtPack(
      env,
      "user-1",
      room(
        [reportRef("collection:collection-1", "Board report")],
        {
          reportApprovals: {
            "collection:collection-1": { evidenceFingerprint: "fp" },
          },
        },
      ),
      data,
    );

    expect(pack.excluded[0].reasonCode).toBe(
      COURT_PACK_EXCLUSION_REASON_CODES.approvalInvalid,
    );
  });

  it("excludes a report that fails to load as load_failed", async () => {
    const { metadata } = await approvalForReport("collection:collection-1");
    const data = createDataSource();
    vi.mocked(data.getCollection).mockResolvedValue(null);
    const pack = await buildCourtPack(
      env,
      "user-1",
      room(
        [reportRef("collection:collection-1", "Board report")],
        { reportApprovals: { "collection:collection-1": metadata } },
      ),
      data,
    );

    expect(pack.excluded[0].reasonCode).toBe(
      COURT_PACK_EXCLUSION_REASON_CODES.loadFailed,
    );
    expect(pack.excluded[0].resourceType).toBe("collection");
  });

  it("excludes a report whose loader throws as load_failed, never a plate", async () => {
    const { metadata } = await approvalForReport("collection:collection-1");
    const data = createDataSource();
    vi.mocked(data.getCollection).mockRejectedValue(new Error("D1 down"));
    const pack = await buildCourtPack(
      env,
      "user-1",
      room(
        [reportRef("collection:collection-1", "Board report")],
        { reportApprovals: { "collection:collection-1": metadata } },
      ),
      data,
    );

    expect(pack.plates).toEqual([]);
    expect(pack.excluded[0].reasonCode).toBe(
      COURT_PACK_EXCLUSION_REASON_CODES.loadFailed,
    );
  });

  it("excludes a report that fails current readiness as readiness_failed", async () => {
    const { metadata } = await approvalForReport("collection:collection-1");
    // The current collection item lost its landing-page capture: the rebuilt
    // report has no current evidence, so readiness fails before fingerprinting.
    const data = createDataSource();
    const degradedAd: AdRecord = { ...collectionAd, landingPage: null };
    vi.mocked(data.getCollection).mockResolvedValue(collection);
    vi.mocked(data.listCollectionItems).mockResolvedValue([
      { ...collectionItem, ad: degradedAd },
    ]);

    const pack = await buildCourtPack(
      env,
      "user-1",
      room(
        [reportRef("collection:collection-1", "Board report")],
        { reportApprovals: { "collection:collection-1": metadata } },
      ),
      data,
    );

    expect(pack.excluded[0].reasonCode).toBe(
      COURT_PACK_EXCLUSION_REASON_CODES.readinessFailed,
    );
  });

  it("excludes a report whose fingerprint changed as fingerprint_mismatch", async () => {
    const { metadata } = await approvalForReport("watchlist:watch-1");
    // Same evidence shape, but a different advertiser changes the fingerprint.
    const data = watchlistReadyDataSource();
    vi.mocked(data.listAdsByIds).mockResolvedValue([
      { ...collectionAd, advertiser: "Other Co" },
    ]);

    const pack = await buildCourtPack(
      env,
      "user-1",
      room(
        [reportRef("watchlist:watch-1", "Watch report")],
        { reportApprovals: { "watchlist:watch-1": metadata } },
      ),
      data,
    );

    expect(pack.plates).toEqual([]);
    expect(pack.excluded[0].reasonCode).toBe(
      COURT_PACK_EXCLUSION_REASON_CODES.fingerprintMismatch,
    );
  });

  it("attaches validated branding when present", async () => {
    const { data, metadata } = await approvalForReport("collection:collection-1");
    vi.mocked(getWorkspaceBranding).mockResolvedValue({
      brandName: "Acme Agency",
      brandWebsite: "https://acme.example",
      brandLogo: "data:image/png;base64,AAAA",
    });
    const pack = await buildCourtPack(
      env,
      "user-1",
      room(
        [reportRef("collection:collection-1", "Board report")],
        { reportApprovals: { "collection:collection-1": metadata } },
      ),
      data,
    );

    expect(pack.preparedBy).toBe("Acme Agency");
    expect(pack.branding).toEqual({
      brandName: "Acme Agency",
      brandWebsite: "https://acme.example",
      brandLogo: "data:image/png;base64,AAAA",
    });
  });

  it("renders no brand block when branding is absent or fails to load", async () => {
    const { data, metadata } = await approvalForReport("collection:collection-1");
    vi.mocked(getWorkspaceBranding).mockRejectedValue(new Error("D1 down"));
    const pack = await buildCourtPack(
      env,
      "user-1",
      room(
        [reportRef("collection:collection-1", "Board report")],
        { reportApprovals: { "collection:collection-1": metadata } },
      ),
      data,
    );

    expect(pack.preparedBy).toBeNull();
    expect(pack.branding).toBeNull();
    expect(pack.plates).toHaveLength(1);
  });

  it("shows the approval empty state with exclusions listed for zero approved reports", async () => {
    const { data } = validApprovalMetadata("collection:collection-1");
    const pack = await buildCourtPack(
      env,
      "user-1",
      room(
        [
          reportRef("collection:collection-1", "Board report"),
          reportRef("watchlist:watch-1", "Watch report"),
        ],
        {},
      ),
      data,
    );

    expect(pack.hasNothingToPack).toBe(true);
    expect(pack.plates).toEqual([]);
    expect(pack.excluded).toHaveLength(2);
    expect(pack.excluded.every((entry) => entry.reasonCode === "no_approval")).toBe(
      true,
    );
  });

  it("produces an empty pack for a room with no report refs", async () => {
    const data = createDataSource();
    const pack = await buildCourtPack(env, "user-1", room([]), data);

    expect(pack.plates).toEqual([]);
    expect(pack.sections).toEqual([]);
    expect(pack.excluded).toEqual([]);
    expect(pack.hasNothingToPack).toBe(true);
    expect(pack.coverage).toMatchObject({
      approvedReports: 0,
      includedSections: 0,
      excluded: 0,
      plates: 0,
    });
  });

  it("keeps an unparseable report id out of plates while listing it honestly", async () => {
    const data = createDataSource();
    const pack = await buildCourtPack(
      env,
      "user-1",
      room([reportRef("synthetic-report", "Synthetic")], {}),
      data,
    );

    expect(pack.plates).toEqual([]);
    expect(pack.excluded).toHaveLength(1);
    expect(pack.excluded[0]).toMatchObject({
      reportId: "synthetic-report",
      resourceType: null,
      reasonCode: COURT_PACK_EXCLUSION_REASON_CODES.noApproval,
    });
  });

  it("keeps approved and excluded reports distinguishable in coverage", async () => {
    const { data, metadata } = await approvalForReport("collection:collection-1");
    const pack = await buildCourtPack(
      env,
      "user-1",
      room(
        [
          reportRef("collection:collection-1", "Board report"),
          reportRef("watchlist:watch-1", "Watch report"),
        ],
        { reportApprovals: { "collection:collection-1": metadata } },
      ),
      data,
    );

    expect(pack.sections).toHaveLength(1);
    expect(pack.excluded).toHaveLength(1);
    expect(pack.excluded[0].reportId).toBe("watchlist:watch-1");
    expect(pack.excluded[0].reasonCode).toBe("no_approval");
    expect(pack.coverage.approvedReports).toBe(1);
    expect(pack.coverage.includedSections).toBe(1);
    expect(pack.coverage.excluded).toBe(1);
  });

  it("revalidates the fingerprint against the current document", async () => {
    const { data } = await approvalForReport("watchlist:watch-1");
    const current = await (async () => {
      const { loadOwnedReportDocument } = await import(
        "~/lib/report-loader.server"
      );
      const doc = await loadOwnedReportDocument(
        env,
        "user-1",
        "watchlist:watch-1",
        data,
        { verifyReportIdentity: true },
      );
      if (!doc) throw new Error("fixture");
      return doc;
    })();
    const pack = await buildCourtPack(
      env,
      "user-1",
      room(
        [reportRef("watchlist:watch-1", "Watch report")],
        {
          reportApprovals: {
            "watchlist:watch-1": {
              evidenceFingerprint: reportEvidenceFingerprint(current),
              reviewedAt: new Date(Date.now() - 60_000).toISOString(),
              approvalExpiresAt: new Date(
                Date.now() + 23 * 60 * 60 * 1000,
              ).toISOString(),
            },
          },
        },
      ),
      data,
    );

    expect(pack.sections).toHaveLength(1);
    expect(pack.excluded).toEqual([]);
  });
});

describe("buildCourtPack type surface", () => {
  it("returns a CourtPack value", async () => {
    const pack = await buildCourtPack(env, "user-1", room([]), createDataSource());
    const check: CourtPack = pack;
    expect(check.roomId).toBe("room-1");
  });
});
