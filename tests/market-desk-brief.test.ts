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
    nextScanLabel: "regular",
    ...overrides,
  };
}

describe("buildMarketDeskBrief", () => {
  it("starts empty accounts at the Market Desk setup path", () => {
    const brief = buildMarketDeskBrief(baseInput());

    expect(brief).toMatchObject({
      state: "empty",
      kicker: "Brief",
      title: "Build your brief",
      action: {
        href: "/app#setup-checklist",
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

  it("describes free as an activation scan followed by a weekly check", () => {
    const brief = buildMarketDeskBrief(baseInput({
      plan: "free",
      watchlists: [watchlist()],
      nextScanLabel: "Mon 15 Jun, 3:00 am UTC",
    }));

    expect(brief.title).toBe("Activation scan is queued");
    expect(brief.summary).toContain("activation scan, then a weekly check");
    expect(brief.summary).toContain("Paid plans check every 3–6 hours");
    expect(brief.summary).not.toContain("Scheduled checks run");
  });

  it("says the first sweep is running now and that results land in-session", () => {
    const brief = buildMarketDeskBrief(baseInput({
      watchlists: [
        watchlist({ id: "watch-1", targetLabel: "Boat Lifestyle" }),
        watchlist({ id: "watch-2", targetLabel: "Noise" }),
      ],
      nextScanLabel: "tonight",
      firstScanStates: [
        { watchlistId: "watch-1", status: "running", errorCode: null },
        { watchlistId: "watch-2", status: "pending", errorCode: null },
      ],
    }));

    expect(brief.state).toBe("queued");
    expect(brief.title).toBe("First sweep is running now");
    expect(brief.summary).toContain("results and your first mini-brief land here automatically");
    expect(brief.items[0]).toMatchObject({
      label: "Scanning",
      title: "Boat Lifestyle",
      detail: "First scan running now — results land here",
    });
    expect(brief.items[1]).toMatchObject({
      label: "Scanning",
      title: "Noise",
      detail: "First scan starts shortly",
    });
  });

  it("says the free activation scan is running now without a paid claim", () => {
    const brief = buildMarketDeskBrief(baseInput({
      plan: "free",
      watchlists: [watchlist({ id: "watch-1", targetLabel: "Boat Lifestyle" })],
      nextScanLabel: "Mon 15 Jun, 3:00 am UTC",
      firstScanStates: [
        { watchlistId: "watch-1", status: "running", errorCode: null },
      ],
    }));

    expect(brief.title).toBe("Activation scan is running now");
    expect(brief.summary).toContain("mini-brief land here automatically");
    expect(brief.summary).toContain("weekly brief");
    expect(brief.items[0]).toMatchObject({
      label: "Scanning",
      title: "Boat Lifestyle",
      detail: "First scan running now — results land here",
    });
  });

  it("stays on the queued first sweep copy while no run state is known", () => {
    const brief = buildMarketDeskBrief(baseInput({
      watchlists: [watchlist({ id: "watch-1", targetLabel: "Boat Lifestyle" })],
      nextScanLabel: "tonight",
      firstScanStates: null,
    }));

    expect(brief.title).toBe("First sweep is queued");
    expect(brief.items[0]).toMatchObject({
      label: "Queued",
      detail: "First scan pending",
    });
  });

  it("names a failed first scan honestly instead of promising a landing", () => {
    const brief = buildMarketDeskBrief(baseInput({
      watchlists: [watchlist({ id: "watch-1", targetLabel: "Boat Lifestyle" })],
      nextScanLabel: "tonight",
      firstScanStates: [
        { watchlistId: "watch-1", status: "failed", errorCode: "provider_unavailable" },
      ],
    }));

    expect(brief.title).toBe("First sweep is queued");
    expect(brief.summary).not.toContain("land here automatically");
    expect(brief.items[0]).toMatchObject({
      detail: "First scan couldn't finish — open for next steps",
    });
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

  it("describes the free quiet state as a weekly check, never a one-time activation", () => {
    const brief = buildMarketDeskBrief(baseInput({
      plan: "free",
      watchlists: [watchlist({ lastScannedAt: "2026-06-20T02:00:00.000Z" })],
      overnightStats: { runs: 1, watchlistsChecked: 1, adsSeen: 6 },
    }));

    expect(brief.state).toBe("quiet");
    expect(brief.title).toBe("Weekly check complete");
    expect(brief.summary).toBe(
      "We checked 1 competitor — nothing moved. The next weekly check runs Monday. Paid plans check every 3–6 hours and add instant alerts.",
    );
    expect(brief.items[0]).toMatchObject({
      label: "Watched",
      title: "Boat Lifestyle",
      detail: "Checked this week",
    });
    expect(JSON.stringify(brief)).not.toContain("activation");
  });

  it("frames the free Briefs sent metric around the weekly brief, not a paid pitch", () => {
    const brief = buildMarketDeskBrief(baseInput({
      plan: "free",
      watchlists: [watchlist()],
    }));

    expect(brief.metrics).toContainEqual({
      label: "Briefs sent",
      value: 0,
      detail: "Weekly brief lands Monday",
    });
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
      label: "Briefs sent",
      value: 1,
      detail: "Email trail active",
    });
    expect(brief.metrics).toContainEqual({
      label: "Proof captures",
      value: 4,
      detail: "16 left this month",
    });
  });
});

describe("proof honesty — detected events are provisional", () => {
  it("never counts detected events as confirmed moves", () => {
    const brief = buildMarketDeskBrief(baseInput({
      watchlists: [watchlist({ id: "watch-1", lastScannedAt: "2026-06-20T00:00:00.000Z" })],
      recentEvents: [
        event({ id: "event-1", status: "confirmed" }),
        event({ id: "event-2", status: "detected", confirmedAt: null }),
        event({ id: "event-3", status: "detected", confirmedAt: null }),
      ],
    }));

    expect(brief.title).toBe("1 competitor move to review");
    const moves = brief.metrics.find((metric) => metric.label === "Moves found");
    expect(moves?.value).toBe(1);
  });

  it("states possible changes without claiming a move when nothing is confirmed", () => {
    const brief = buildMarketDeskBrief(baseInput({
      watchlists: [watchlist({ id: "watch-1", lastScannedAt: "2026-06-20T00:00:00.000Z" })],
      recentEvents: [
        event({ id: "event-1", status: "detected", confirmedAt: null }),
        event({ id: "event-2", status: "detected", confirmedAt: null }),
      ],
    }));

    expect(brief.title).toBe("2 possible changes to check");
    expect(brief.summary).toContain("have not confirmed");
    const moves = brief.metrics.find((metric) => metric.label === "Moves found");
    expect(moves?.value).toBe(0);
    expect(moves?.detail).toBe("2 possible changes still unproven");
  });
});

describe("quiet is a proof claim (remediation)", () => {
  it("proof_pending events read as possible changes, never as a quiet check", () => {
    const brief = buildMarketDeskBrief(baseInput({
      watchlists: [watchlist({ id: "watch-1", lastScannedAt: "2026-06-20T00:00:00.000Z" })],
      recentEvents: [event({ id: "event-1", status: "proof_pending", confirmedAt: null })],
      overnightStats: { runs: 2, watchlistsChecked: 1, adsSeen: 12 },
    }));

    expect(brief.title).toBe("1 possible change to check");
    expect(brief.state).not.toBe("quiet");
  });

  it("a failed check can never produce a quiet brief", () => {
    const brief = buildMarketDeskBrief(baseInput({
      watchlists: [watchlist({ id: "watch-1", lastScannedAt: "2026-06-20T00:00:00.000Z" })],
      recentEvents: [event({ id: "event-1", status: "proof_failed", confirmedAt: null })],
      overnightStats: { runs: 2, watchlistsChecked: 1, adsSeen: 12 },
    }));

    expect(brief.title).toBe("1 check failed");
    expect(brief.state).toBe("queued");
    expect(brief.summary).toContain("cannot be called quiet");
  });
});

describe("brief retention frame (lane 1)", () => {
  it("carries material delta, owner, confidence, and expiry on a changed brief", () => {
    const brief = buildMarketDeskBrief(
      baseInput({
        watchlists: [watchlist({ id: "watch-1", lastScannedAt: "2026-06-20T00:00:00.000Z" })],
        recentEvents: [
          event({
            id: "event-1",
            status: "confirmed",
            metadata: {
              proofCaptureId: "proof-1",
              sourceStatus: "proof_backed",
            },
          }),
        ],
        digests: [
          digest({ id: "digest-prev", items: [{} as never] }),
        ],
        ownerName: "Priya",
        nextScanAt: "2026-06-27T03:00:00.000Z",
      }),
    );

    expect(brief.retention).toBeDefined();
    expect(brief.retention.delta).toContain("1 change filed");
    expect(brief.retention.owner).toBe("Priya");
    expect(brief.retention.confidence).toBe("high");
    expect(brief.retention.expiry).toContain("Expires at the next check");
  });

  it("renders an explicit unavailable confidence when no items are filed", () => {
    const brief = buildMarketDeskBrief(
      baseInput({
        nextScanLabel: "",
        nextScanAt: null,
      }),
    );

    expect(brief.retention.confidence).toBe("unavailable");
    expect(brief.retention.confidenceLabel).toContain("Confidence unavailable");
    expect(brief.retention.expiry).toContain("Expiry unset");
  });

  it("downgrades confidence to low when source access is degraded", () => {
    const brief = buildMarketDeskBrief(
      baseInput({
        watchlists: [watchlist({ id: "watch-1", lastScannedAt: "2026-06-20T00:00:00.000Z" })],
        recentEvents: [
          event({
            id: "event-1",
            status: "confirmed",
            metadata: {
              proofCaptureId: "proof-1",
              sourceStatus: "proof_backed",
            },
          }),
        ],
        sourceStatus: "degraded",
        ownerName: "Priya",
      }),
    );

    expect(brief.retention.confidence).toBe("low");
    expect(brief.retention.confidenceLabel).toContain("Low confidence");
  });
});
