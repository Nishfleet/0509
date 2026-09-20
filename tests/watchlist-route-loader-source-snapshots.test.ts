import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WatchlistRecord } from "~/lib/types";

/**
 * Issue #2581 — the /app/watchlists loader feeds `sourceSnapshots` into the
 * competitor detail's SourceSections slot, but only when the Evidence tab is
 * open (the same only-when-open rule the Archive tab follows, issue #2173).
 * `loadCompetitorSourceSnapshots` is the mocked boundary; the loader's own
 * gating is what is under test.
 */

const session = {
  user: {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
    onboardedAt: "2026-04-02 18:30:00",
  },
  session: {
    id: "session-1",
    userId: "user-1",
    expiresAt: "2026-04-03T00:00:00.000Z",
  },
};

const watchlist: WatchlistRecord = {
  id: "watch-1",
  userId: "user-1",
  name: "Nykaa watch",
  targetType: "advertiser",
  targetId: "nykaa",
  targetFingerprint: "fp-nykaa",
  targetLabel: "Nykaa",
  targetCountry: null,
  isActive: true,
  lastScannedAt: "2026-04-18T09:00:00.000Z",
  createdAt: "2026-04-10T00:00:00.000Z",
  updatedAt: "2026-04-18T09:00:00.000Z",
};

const SNAPSHOTS = {
  google_ads: {
    snapshot: {
      id: "snap-1",
      watchlistId: "watch-1",
      sourceId: "google_ads",
      fetchedAt: "2026-04-18T09:00:00.000Z",
      payload: { creatives: [{ creativeId: "c1" }] },
      createdAt: "2026-04-18T09:00:00.000Z",
    },
    diff: [],
  },
};

const loadCompetitorSourceSnapshots = vi.fn();

function mockLoaderBoundaries() {
  vi.doMock("~/lib/auth.server", () => ({
    requireSession: vi.fn().mockResolvedValue(session),
    requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
      session,
      workspaceUserId: session.user.id,
      isMember: false,
      ownerName: null,
    })),
  }));
  vi.doMock("~/lib/plan.server", () => ({
    getUserPlan: vi.fn().mockResolvedValue("starter"),
    checkPlanLimit: vi.fn(),
  }));
  vi.doMock("~/lib/email-verification.server", () => ({
    isUserEmailVerified: vi.fn().mockResolvedValue(true),
  }));
  vi.doMock("~/lib/data.server", () => ({
    getWatchlist: vi.fn().mockResolvedValue(watchlist),
    getWatchlistDeliveryConfig: vi.fn().mockResolvedValue(null),
    getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue(null),
    listDeliveryAttempts: vi.fn().mockResolvedValue([]),
    listDeliveryTargets: vi.fn().mockResolvedValue([]),
    listEventCandidates: vi.fn().mockResolvedValue([]),
    listRecentProofCapturesForWatchlist: vi.fn().mockResolvedValue([]),
    listWatchEvents: vi.fn().mockResolvedValue([]),
    listWatchlistRuns: vi.fn().mockResolvedValue([]),
    listWatchlists: vi.fn().mockResolvedValue([watchlist]),
  }));
  vi.doMock("~/lib/sources/run.server", () => ({
    loadCompetitorSourceSnapshots,
  }));
}

describe("watchlists route loader — sourceSnapshots", () => {
  beforeEach(() => {
    vi.resetModules();
    loadCompetitorSourceSnapshots.mockReset();
    loadCompetitorSourceSnapshots.mockResolvedValue(SNAPSHOTS);
  });

  afterEach(() => {
    vi.doUnmock("~/lib/data.server");
    vi.doUnmock("~/lib/sources/run.server");
    vi.restoreAllMocks();
  });

  it("loads the snapshots map when the evidence tab is open", async () => {
    mockLoaderBoundaries();
    const { loader } = await import("~/routes/app.watchlists");
    const payload = await loader({
      context: { cloudflare: { env: {} } },
      request: new Request(
        "http://localhost/app/watchlists?watchlist=watch-1&tab=evidence",
      ),
    } as never);

    expect(loadCompetitorSourceSnapshots).toHaveBeenCalledTimes(1);
    expect(loadCompetitorSourceSnapshots).toHaveBeenCalledWith(
      expect.anything(),
      "watch-1",
      "starter",
    );
    expect(payload.sourceSnapshots).toEqual(SNAPSHOTS);
  });

  it("does not read source snapshots on the default tab", async () => {
    mockLoaderBoundaries();
    const { loader } = await import("~/routes/app.watchlists");
    const payload = await loader({
      context: { cloudflare: { env: {} } },
      request: new Request("http://localhost/app/watchlists?watchlist=watch-1"),
    } as never);

    expect(loadCompetitorSourceSnapshots).not.toHaveBeenCalled();
    expect(payload.sourceSnapshots).toEqual({});
  });

  it("degrades to an empty map when the snapshot read fails on an open evidence tab", async () => {
    loadCompetitorSourceSnapshots.mockRejectedValue(new Error("D1 down"));
    mockLoaderBoundaries();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { loader } = await import("~/routes/app.watchlists");
    const payload = await loader({
      context: { cloudflare: { env: {} } },
      request: new Request(
        "http://localhost/app/watchlists?watchlist=watch-1&tab=evidence",
      ),
    } as never);

    expect(payload.sourceSnapshots).toEqual({});
    expect(warn).toHaveBeenCalledWith(
      "Competitor source snapshots load failed; hiding the sections.",
      expect.objectContaining({ errorName: "Error" }),
    );
  });

  it("pays nothing when no competitor is open, even with tab=evidence", async () => {
    mockLoaderBoundaries();
    const { loader } = await import("~/routes/app.watchlists");
    const payload = await loader({
      context: { cloudflare: { env: {} } },
      request: new Request("http://localhost/app/watchlists?tab=evidence"),
    } as never);

    expect(loadCompetitorSourceSnapshots).not.toHaveBeenCalled();
    expect(payload.sourceSnapshots).toEqual({});
  });
});
