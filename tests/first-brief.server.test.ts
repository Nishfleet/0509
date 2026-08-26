import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WatchEventRecord, WatchlistRecord } from "~/lib/types";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/delivery.server");
  vi.doUnmock("~/lib/cron-failure-alert.server");
});

function watchlist(overrides: Partial<WatchlistRecord> = {}): WatchlistRecord {
  return {
    id: "watch-1",
    userId: "user-1",
    name: "Glowkart",
    targetType: "advertiser",
    trackingRole: "competitor",
    targetId: "https://glowkart.example",
    targetFingerprint: "fingerprint-1",
    targetLabel: "Glowkart",
    targetCountry: "all",
    isActive: true,
    lastScannedAt: "2026-08-26T10:05:00.000Z",
    createdAt: "2026-08-26T10:00:00.000Z",
    updatedAt: "2026-08-26T10:05:00.000Z",
    ...overrides,
  };
}

function event(overrides: Partial<WatchEventRecord> = {}): WatchEventRecord {
  return {
    id: "event-1",
    watchlistId: "watch-1",
    runId: "run-1",
    eventType: "ad_new",
    status: "confirmed",
    importanceScore: 40,
    adId: "ad-1",
    baselineFromRunId: null,
    candidateId: null,
    proofCaptureId: "proof-1",
    title: "Baseline captured: 3 active ads",
    summary: "We recorded 3 active ads for Glowkart as your starting point.",
    metadata: { kind: "baseline", adsSeen: 3 },
    confirmedAt: "2026-08-26T10:05:01.000Z",
    suppressedAt: null,
    invalidatedAt: null,
    lastEvaluatedAt: "2026-08-26T10:05:01.000Z",
    createdAt: "2026-08-26T10:05:00.000Z",
    ...overrides,
  };
}

const OWNER_ADDRESS = ["owner", "example.com"].join("@");
const SNAPSHOT = "https://www.facebook.com/ads/library/?id=ad-1";
const LANDING = "https://glowkart.example/sale";

function filedDigest() {
  return {
    id: "digest-1",
    userId: "user-1",
    periodStart: "2026-08-26T10:00:00.000Z",
    periodEnd: "2026-09-02T10:00:00.000Z",
    createdAt: "2026-08-26T10:05:02.000Z",
    summary: { kind: "first_brief" },
    items: [
      {
        id: "item-1",
        digestRunId: "digest-1",
        watchlistId: "watch-1",
        watchlistName: "Glowkart",
        eventType: "ad_new" as const,
        title: "Baseline captured: 3 active ads",
        summary: "We recorded 3 active ads for Glowkart as your starting point.",
        createdAt: "2026-08-26T10:05:02.000Z",
        metadata: {
          eventId: "event-1",
          sourceUrl: SNAPSHOT,
          proofCaptureId: "proof-1",
        },
      },
    ],
    delivery: null,
  };
}

function verifiedOwner() {
  return {
    email: OWNER_ADDRESS,
    name: "Owner",
    emailVerified: true,
  };
}

describe("maybeFileAndDeliverFirstBrief", () => {
  it("files a first brief with an evidence URL and sends it on the digest path", async () => {
    const createDigestRun = vi.fn().mockResolvedValue({
      digestRunId: "digest-1",
      created: true,
    });
    const getDigest = vi.fn().mockResolvedValue(filedDigest());
    const listDigests = vi.fn().mockResolvedValue([]);
    const listAdsByIds = vi.fn().mockResolvedValue([
      {
        metaAdId: "ad-1",
        landingPageUrl: LANDING,
        adSnapshotUrl: SNAPSHOT,
      },
    ]);
    const deliverWeeklyDigest = vi.fn().mockResolvedValue({
      attempts: 1,
      details: [{ status: "sent" }],
    });

    vi.doMock("~/lib/data.server", () => ({
      createDigestRun,
      getDigest,
      listDigests,
      listAdsByIds,
    }));
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWeeklyDigest,
    }));
    vi.doMock("~/lib/cron-failure-alert.server", () => ({
      reportScheduledTaskFailure: vi.fn(),
    }));

    const { maybeFileAndDeliverFirstBrief } = await import(
      "~/lib/first-brief.server"
    );
    const result = await maybeFileAndDeliverFirstBrief({} as never, {
      watchlist: watchlist(),
      events: [event()],
      adsSeen: 3,
      observations: [{ ad_id: "ad-1", landing_page_url: LANDING }],
      userDeliveryProfile: verifiedOwner(),
    });

    expect(result).toEqual({
      filed: true,
      delivered: true,
      digestRunId: "digest-1",
      reason: "filed",
    });
    expect(createDigestRun).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "2026-08-26T10:00:00.000Z",
      "2026-09-02T10:00:00.000Z",
      expect.objectContaining({ kind: "first_brief", adsSeen: 3 }),
      expect.objectContaining({ returnClaim: true }),
    );
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        firstBrief: true,
        cadence: "weekly",
        digestRunId: "digest-1",
      }),
    );
  });

  it("does not file when the baseline has no capture, screenshot, or ad URL", async () => {
    const createDigestRun = vi.fn();
    const deliverWeeklyDigest = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      createDigestRun,
      getDigest: vi.fn(),
      listDigests: vi.fn().mockResolvedValue([]),
      listAdsByIds: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWeeklyDigest,
    }));
    vi.doMock("~/lib/cron-failure-alert.server", () => ({
      reportScheduledTaskFailure: vi.fn(),
    }));

    const { maybeFileAndDeliverFirstBrief } = await import(
      "~/lib/first-brief.server"
    );
    const result = await maybeFileAndDeliverFirstBrief({} as never, {
      watchlist: watchlist(),
      events: [event({ adId: null, proofCaptureId: null, metadata: { kind: "baseline" } })],
      adsSeen: 0,
      observations: [{ ad_id: null, landing_page_url: null }],
      userDeliveryProfile: verifiedOwner(),
    });

    expect(result.reason).toBe("no_evidence");
    expect(result.filed).toBe(false);
    expect(createDigestRun).not.toHaveBeenCalled();
    expect(deliverWeeklyDigest).not.toHaveBeenCalled();
  });

  it("does not send when the account address is still unverified", async () => {
    const deliverWeeklyDigest = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      createDigestRun: vi.fn().mockResolvedValue({
        digestRunId: "digest-1",
        created: true,
      }),
      getDigest: vi.fn().mockResolvedValue(filedDigest()),
      listDigests: vi.fn().mockResolvedValue([]),
      listAdsByIds: vi.fn().mockResolvedValue([
        {
          metaAdId: "ad-1",
          landingPageUrl: LANDING,
          adSnapshotUrl: SNAPSHOT,
        },
      ]),
    }));
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWeeklyDigest,
    }));
    vi.doMock("~/lib/cron-failure-alert.server", () => ({
      reportScheduledTaskFailure: vi.fn(),
    }));

    const { maybeFileAndDeliverFirstBrief } = await import(
      "~/lib/first-brief.server"
    );
    const result = await maybeFileAndDeliverFirstBrief({} as never, {
      watchlist: watchlist(),
      events: [event()],
      adsSeen: 3,
      observations: [{ ad_id: "ad-1" }],
      userDeliveryProfile: {
        ...verifiedOwner(),
        emailVerified: false,
      },
    });

    expect(result.filed).toBe(true);
    expect(result.delivered).toBe(false);
    expect(deliverWeeklyDigest).not.toHaveBeenCalled();
  });
});

describe("ensureFirstBriefForWorkspace", () => {
  it("loads the finished activation scan and files from it", async () => {
    const listWatchlists = vi.fn().mockResolvedValue([watchlist()]);
    const getRecentSuccessfulRuns = vi.fn().mockResolvedValue([{ id: "run-1" }]);
    const getUserDeliveryProfile = vi.fn().mockResolvedValue(verifiedOwner());
    const listWatchEventsForRun = vi.fn().mockResolvedValue([event()]);
    const listObservationsForRun = vi.fn().mockResolvedValue([
      { ad_id: "ad-1", landing_page_url: LANDING },
    ]);
    const createDigestRun = vi.fn().mockResolvedValue({
      digestRunId: "digest-1",
      created: true,
    });
    const deliverWeeklyDigest = vi.fn().mockResolvedValue({
      attempts: 1,
      details: [{ status: "sent" }],
    });

    vi.doMock("~/lib/data.server", () => ({
      listWatchlists,
      getRecentSuccessfulRuns,
      getUserDeliveryProfile,
      listWatchEventsForRun,
      listObservationsForRun,
      createDigestRun,
      getDigest: vi.fn().mockResolvedValue(filedDigest()),
      listDigests: vi.fn().mockResolvedValue([]),
      listAdsByIds: vi.fn().mockResolvedValue([
        {
          metaAdId: "ad-1",
          landingPageUrl: LANDING,
          adSnapshotUrl: SNAPSHOT,
        },
      ]),
    }));
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWeeklyDigest,
    }));
    vi.doMock("~/lib/cron-failure-alert.server", () => ({
      reportScheduledTaskFailure: vi.fn(),
    }));

    const { ensureFirstBriefForWorkspace } = await import(
      "~/lib/first-brief.server"
    );
    const result = await ensureFirstBriefForWorkspace({} as never, "user-1");

    expect(result.reason).toBe("filed");
    expect(result.delivered).toBe(true);
    expect(listWatchEventsForRun).toHaveBeenCalledWith(expect.anything(), "watch-1", "run-1");
  });
});
