import { describe, expect, it } from "vitest";

import { buildCounterMoveBrief } from "~/lib/counter-move-brief.server";
import type { WatchEventRecord, WatchlistRecord } from "~/lib/types";

const watchlist: WatchlistRecord = {
  id: "watch-1",
  userId: "user-1",
  name: "Nykaa watch",
  targetType: "advertiser",
  targetId: "nykaa",
  targetFingerprint: "fp-nykaa",
  targetLabel: "Nykaa",
  targetCountry: "India",
  trackingRole: "competitor",
  isActive: true,
  lastScannedAt: "2026-06-19T00:00:00.000Z",
  createdAt: "2026-06-18T00:00:00.000Z",
  updatedAt: "2026-06-19T00:00:00.000Z",
};

const offerEvent: WatchEventRecord = {
  id: "event-offer",
  watchlistId: "watch-1",
  runId: "run-1",
  eventType: "landing_page_offer_changed",
  status: "confirmed",
  importanceScore: 92,
  adId: "ad-1",
  baselineFromRunId: null,
  candidateId: "candidate-1",
  proofCaptureId: "proof-1",
  title: "Offer changed",
  summary: "The offer moved.",
  metadata: {
    advertiser: "Nykaa",
    from: "Starting at ₹499",
    to: "Starting at ₹799",
  },
  confirmedAt: "2026-06-19T00:00:00.000Z",
  suppressedAt: null,
  invalidatedAt: null,
  lastEvaluatedAt: "2026-06-19T00:00:00.000Z",
  createdAt: "2026-06-19T00:00:00.000Z",
};

describe("buildCounterMoveBrief", () => {
  it("prioritizes source-backed moves and turns them into counter-move briefs", () => {
    const brief = buildCounterMoveBrief({
      watchlist,
      events: [
        {
          ...offerEvent,
          id: "event-low",
          importanceScore: 50,
          createdAt: "2026-06-19T01:00:00.000Z",
        },
        offerEvent,
      ],
      adsById: new Map(),
      generatedAt: "2026-06-19T02:00:00.000Z",
      limit: 1,
      timeZone: "Asia/Kolkata",
      workflow: {
        ownerLabel: "Growth owner",
        channel: "app",
        expiryDays: 5,
      },
    });

    expect(brief).toMatchObject({
      kind: "counter_move_brief",
      watchlistId: "watch-1",
      targetLabel: "Nykaa",
      generatedAt: "2026-06-19T02:00:00.000Z",
      summary: "1 source-backed move to review for Nykaa.",
    });
    expect(brief.workflow).toMatchObject({
      ownerLabel: "Growth owner",
      channel: "app",
      status: "needs_review",
      expiresAt: "2026-06-24T02:00:00.000Z",
      openCount: 1,
    });
    expect(brief.workflow.followUps[0]).toMatchObject({
      eventId: "event-offer",
      status: "open",
      dueAt: "2026-06-24T02:00:00.000Z",
      recommendedAction: expect.stringContaining("review pricing"),
      priorityBand: "High priority",
    });
    expect(brief.moves).toHaveLength(1);
    expect(brief.moves[0]).toMatchObject({
      eventId: "event-offer",
      priorityBand: "High priority",
      counterMove: expect.stringContaining("price, bundle, guarantee"),
      evidence: expect.stringContaining("Starting at ₹499"),
    });
  });

  it("returns quiet workflow state when no source-backed moves are ready", () => {
    const brief = buildCounterMoveBrief({
      watchlist,
      events: [],
      adsById: new Map(),
      generatedAt: "2026-06-19T02:00:00.000Z",
    });

    expect(brief.summary).toBe("No source-backed moves are ready for Nykaa.");
    expect(brief.workflow).toMatchObject({
      ownerLabel: "Workspace owner",
      channel: "app",
      status: "quiet",
      expiresAt: "2026-06-26T02:00:00.000Z",
      openCount: 0,
      followUps: [],
    });
  });
});
