import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WatchEventRecord, WatchlistRecord } from "~/lib/types";

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

function makeEvent(id: string, createdAt: string): WatchEventRecord {
  return {
    id,
    watchlistId: "watch-1",
    runId: "run-1",
    eventType: "landing_page_offer_changed",
    status: "confirmed",
    importanceScore: 80,
    adId: null,
    baselineFromRunId: null,
    candidateId: null,
    proofCaptureId: null,
    title: "Landing page offer changed",
    summary: "The landing-page offer changed.",
    metadata: { advertiser: "Nykaa" },
    confirmedAt: createdAt,
    suppressedAt: null,
    invalidatedAt: null,
    lastEvaluatedAt: createdAt,
    createdAt,
  };
}

// The feed window: 24 most recent events, newest first. The oldest event
// (`event-0`) sits just outside it — exactly the digest deep-link case.
const oldestEvent = makeEvent("event-0", "2026-04-17T10:00:00.000Z");
const feedEvents = Array.from({ length: 24 }, (_, i) =>
  makeEvent(`event-${24 - i}`, `2026-04-18T${String(10 + i % 10).padStart(2, "0")}:${String(i).padStart(2, "0")}:00.000Z`),
);

const listWatchEventsByIds = vi.fn();

describe("watchlists route loader — ?event= deep link outside the feed window", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("~/lib/data.server");
    vi.restoreAllMocks();
  });

  it("pins the deep-linked event into the feed when it is older than the 24-event window", async () => {
    const listWatchEvents = vi.fn().mockResolvedValue(feedEvents);
    listWatchEventsByIds.mockResolvedValue([oldestEvent]);

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
      listWatchEvents,
      listWatchEventsByIds,
      listWatchlistRuns: vi.fn().mockResolvedValue([]),
      listWatchlists: vi.fn().mockResolvedValue([watchlist]),
    }));

    const { loader } = await import("~/routes/app.watchlists");
    const payload = await loader({
      context: { cloudflare: { env: {} } },
      request: new Request(
        "http://localhost/app/watchlists?watchlist=watch-1&event=event-0",
      ),
    } as never);

    // The deep-linked event must be the first row so the existing
    // scroll-to-`event-<id>` effect finds it — the link never no-ops.
    expect(payload.events[0].id).toBe("event-0");
    expect(listWatchEventsByIds).toHaveBeenCalledWith(
      expect.anything(),
      "watch-1",
      ["event-0"],
    );
  });
});
