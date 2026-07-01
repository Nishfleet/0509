import { describe, expect, it } from "vitest";

import { buildMarketDeskBrief } from "~/lib/market-desk-brief";
import type { DigestRecord, WatchEventRecord, WatchlistRecord } from "~/lib/types";

function watchlist(input: Partial<WatchlistRecord> = {}): WatchlistRecord {
  return {
    id: input.id ?? "watch-1",
    userId: "user-1",
    name: input.name ?? "Boat watch",
    targetType: input.targetType ?? "advertiser",
    trackingRole: input.trackingRole ?? "competitor",
    targetId: input.targetId ?? "https://boat-lifestyle.com",
    targetFingerprint: input.targetFingerprint ?? "fingerprint-1",
    targetLabel: input.targetLabel ?? "Boat Lifestyle",
    targetCountry: input.targetCountry ?? "all",
    isActive: input.isActive ?? true,
    lastScannedAt: input.lastScannedAt ?? null,
    createdAt: input.createdAt ?? "2026-06-20T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-06-20T00:00:00.000Z",
  };
}

function event(input: Partial<WatchEventRecord> = {}): WatchEventRecord {
  return {
    id: input.id ?? "event-1",
    watchlistId: input.watchlistId ?? "watch-1",
    runId: input.runId ?? "run-1",
    eventType: input.eventType ?? "landing_page_url_changed",
    status: input.status ?? "confirmed",
    importanceScore: input.importanceScore ?? 70,
    adId: input.adId ?? null,
    baselineFromRunId: input.baselineFromRunId ?? null,
    candidateId: input.candidateId ?? null,
    proofCaptureId: input.proofCaptureId ?? "proof-1",
    title: input.title ?? "Boat changed its landing page",
    summary: input.summary ?? "New discount language appeared on the hero.",
    metadata: input.metadata ?? {},
    confirmedAt: input.confirmedAt ?? "2026-06-20T00:10:00.000Z",
    suppressedAt: input.suppressedAt ?? null,
    invalidatedAt: input.invalidatedAt ?? null,
    lastEvaluatedAt: input.lastEvaluatedAt ?? "2026-06-20T00:10:00.000Z",
    createdAt: input.createdAt ?? "2026-06-20T00:10:00.000Z",
  };
}

function digest(input: Partial<DigestRecord> = {}): DigestRecord {
  return {
    id: input.id ?? "digest-1",
    userId: "user-1",
    periodStart: input.periodStart ?? "2026-06-19T00:00:00.000Z",
    periodEnd: input.periodEnd ?? "2026-06-20T00:00:00.000Z",
    createdAt: input.createdAt ?? "2026-06-20T00:00:00.000Z",
    items: input.items ?? [],
    delivery: input.delivery ?? {
      id: "delivery-1",
      digestRunId: "digest-1",
      provider: "email",
      status: "sent",
      recipientEmail: "owner@example.com",
      externalMessageId: "provider-1",
      errorMessage: null,
      deliveredAt: null,
    },
  };
}

function baseInput(overrides: Partial<Parameters<typeof buildMarketDeskBrief>[0]> = {}) {
  return {
    watchlists: [],
    recentEvents: [],
    counterMoveFollowUps: [],
    digests: [],
    proofUsage: { used: 0, limit: 0, remaining: 0 },
    overnightStats: { runs: 0, watchlistsChecked: 0, adsSeen: 0 },
    successfulProofCount: 0,
    nextScanLabel: "nightly",
    ...overrides,
  };
}

describe("buildMarketDeskBrief", () => {
  it("starts empty accounts at the Market Desk setup path", () => {
    const brief = buildMarketDeskBrief(baseInput());

    expect(brief).toMatchObject({
      state: "empty",
      kicker: "Market Desk Brief",
      title: "Build your Market Desk",
      action: {
        href: "/app/onboard?resume=1",
        label: "Add competitors",
      },
      hasMetrics: false,
    });
  });

  it("shows queued first sweep copy when competitors exist but no scan has completed", () => {
    const brief = buildMarketDeskBrief(baseInput({
      watchlists: [
        watchlist({ id: "watch-1", targetLabel: "Boat Lifestyle" }),
        watchlist({ id: "watch-2", targetLabel: "Noise" }),
      ],
      nextScanLabel: "tonight",
    }));

    expect(brief.state).toBe("queued");
    expect(brief.title).toBe("First sweep is queued");
    expect(brief.summary).toContain("2 competitors are ready");
    expect(brief.items.map((item) => item.title)).toEqual(["Boat Lifestyle", "Noise"]);
    expect(brief.hasMetrics).toBe(true);
  });

  it("summarizes quiet overnight checks without inventing a move", () => {
    const brief = buildMarketDeskBrief(baseInput({
      watchlists: [watchlist({ lastScannedAt: "2026-06-20T02:00:00.000Z" })],
      overnightStats: { runs: 1, watchlistsChecked: 1, adsSeen: 18 },
    }));

    expect(brief.state).toBe("quiet");
    expect(brief.title).toBe("Quiet check completed");
    expect(brief.summary).toBe("All quiet - 18 ads checked across 1 competitor. Completed checks found no action-worthy movement.");
  });

  it("prioritizes confirmed competitor changes over quiet run stats", () => {
    const brief = buildMarketDeskBrief(baseInput({
      watchlists: [watchlist()],
      recentEvents: [event()],
      overnightStats: { runs: 1, watchlistsChecked: 1, adsSeen: 18 },
    }));

    expect(brief.state).toBe("changes");
    expect(brief.title).toBe("1 competitor move to review");
    expect(brief.items[0]).toMatchObject({
      title: "Boat changed its landing page",
      detail: "New discount language appeared on the hero.",
    });
  });

  it("prioritizes open proof-backed follow-ups over changes", () => {
    const brief = buildMarketDeskBrief(baseInput({
      watchlists: [watchlist()],
      recentEvents: [event()],
      counterMoveFollowUps: [
        {
          title: "Review pricing move",
          ownerLabel: "Growth lead",
          channelLabel: "Client room",
        },
      ],
    }));

    expect(brief.state).toBe("follow_up");
    expect(brief.title).toBe("1 follow-up to decide");
    expect(brief.items[0]).toMatchObject({
      title: "Review pricing move",
      detail: "Growth lead · Client room",
    });
  });

  it("keeps paused watchlists out of the active brief state", () => {
    const brief = buildMarketDeskBrief(baseInput({
      watchlists: [watchlist({ isActive: false, targetLabel: "Paused Brand" })],
      recentEvents: [event()],
    }));

    expect(brief.state).toBe("paused");
    expect(brief.title).toBe("Tracking is paused");
    expect(brief.items[0]).toMatchObject({
      label: "Paused",
      title: "Paused Brand",
    });
  });

  it("counts sent digest delivery as an email trail, not delivery proof", () => {
    const brief = buildMarketDeskBrief(baseInput({
      watchlists: [watchlist()],
      digests: [digest()],
      proofUsage: { used: 4, limit: 20, remaining: 16 },
      successfulProofCount: 2,
    }));

    expect(brief.metrics).toContainEqual({
      label: "Digests sent",
      value: 1,
      detail: "Email trail active",
    });
    expect(brief.metrics).toContainEqual({
      label: "Evidence checks",
      value: 4,
      detail: "16 left this month",
    });
  });
});
