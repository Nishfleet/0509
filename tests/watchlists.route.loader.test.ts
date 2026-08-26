import { describe, expect, it, vi } from "vitest";

import {
  createContext,
  deliveryTargets,
  discoveryStatus,
  recentCandidates,
  recentDeliveryAttempts,
  recentEvents,
  recentProofCaptures,
  recentRuns,
  session,
  setupWatchlistsRouteTestIsolation,
  watchlist,
  watchlistDeliveryConfig,
  workspaceDeliveryConfig,
} from "./helpers/watchlists-route-fixtures";

setupWatchlistsRouteTestIsolation();

describe("watchlists route loader", () => {
  it("returns bounded proof, delivery, and candidate state for the selected watchlist", async () => {
    const listDeliveryAttempts = vi
      .fn()
      .mockResolvedValueOnce(recentDeliveryAttempts)
      .mockResolvedValue([]);
    const listDeliveryTargets = vi
      .fn()
      .mockResolvedValueOnce(deliveryTargets)
      .mockResolvedValue([]);

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
    vi.doMock("~/lib/ad-source.server", () => ({
      resolveCommercialAdSourceStatus: vi
        .fn()
        .mockResolvedValue(discoveryStatus),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      getWatchlistDeliveryConfig: vi
        .fn()
        .mockResolvedValue(watchlistDeliveryConfig),
      getWorkspaceDeliveryConfig: vi
        .fn()
        .mockResolvedValue(workspaceDeliveryConfig),
      listDeliveryAttempts,
      listDeliveryTargets,
      listEventCandidates: vi.fn().mockResolvedValue(recentCandidates),
      listRecentProofCapturesForWatchlist: vi
        .fn()
        .mockResolvedValue(recentProofCaptures),
      listWatchEvents: vi.fn().mockResolvedValue(recentEvents),
      listWatchlistRuns: vi.fn().mockResolvedValue(recentRuns),
      listWatchlists: vi.fn().mockResolvedValue([watchlist]),
    }));

    const { loader } = await import("~/routes/app.watchlists");
    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists?watchlist=watch-1&event=event-1"),
    } as never);

    expect(result).toMatchObject({
      selectedWatchlist: watchlist,
      highlightedEventId: "event-1",
      eventCandidates: recentCandidates,
      events: recentEvents,
      runs: recentRuns.map((run) => ({ ...run, errorMessage: null })),
      deliveryTargets: deliveryTargets.map((target) => ({
        ...target,
        targetValue: session.user.email,
      })),
      recentDeliveryAttempts: [
        {
          digestRunId: null,
          channel: "email",
          status: "sent",
          webhookStatus: "delivered",
          targetValue: "Configured email recipient",
          eventIds: ["event-1"],
          providerStatusLastSeenAt: "2026-04-18T10:05:10.000Z",
          sentAt: "2026-04-18T10:05:00.000Z",
          createdAt: "2026-04-18T10:05:00.000Z",
          errorMessage: null,
        },
      ],
      effectiveDeliveryConfig: {
        sensitivityMode: "quiet",
        instantEnabled: true,
        digestEnabled: true,
        emailEnabled: true,
        whatsappEnabled: false,
        slackEnabled: false,
      },
      discoveryStatus: {
        status: "healthy",
        summary: "Live ad checks are ready.",
        lastCheckedAt: discoveryStatus.lastCheckedAt,
        recovery: null,
      },
      proofSummary: {
        totalAttempts: 2,
        successfulAttempts: 2,
        failedAttempts: 0,
        skippedDueToBudget: 0,
        skippedDueToRateLimit: 0,
        skippedDueToDedupe: 0,
        lastSuccessfulProofAt: "2026-04-18T09:59:50.000Z",
      },
    });
    expect(listDeliveryTargets).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "user-1",
      {
        watchlistId: "watch-1",
        channel: "email",
        limit: 12,
      },
    );
    expect(listDeliveryTargets).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "user-1",
      {
        watchlistId: "watch-1",
        channel: "slack",
        limit: 12,
      },
    );
    // Slack and Teams are live webhook channels: the workspace-default target
    // batch for email is the 4th call (channels are email, slack, teams).
    expect(listDeliveryTargets).toHaveBeenNthCalledWith(
      4,
      expect.anything(),
      "user-1",
      {
        watchlistId: null,
        channel: "email",
        limit: 8,
      },
    );
    expect(listDeliveryAttempts).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      watchlistId: "watch-1",
      channel: "email",
      limit: 16,
    });
    expect(result).toMatchObject({
      canManageDelivery: true,
      verifiedAccountEmail: session.user.email,
    });
  });

  // BL-006 list/detail split (brief §7): `/app/watchlists` is the watch board.
  // Nothing about a single competitor loads until a band is opened.
  it("loads the board only until a competitor is opened", async () => {
    const getWatchlist = vi.fn().mockResolvedValue(watchlist);
    const listWatchEvents = vi.fn().mockResolvedValue(recentEvents);
    const listWatchlistRuns = vi.fn().mockResolvedValue(recentRuns);

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
    vi.doMock("~/lib/ad-source.server", () => ({
      resolveCommercialAdSourceStatus: vi.fn().mockResolvedValue(discoveryStatus),
    }));
    vi.doMock("~/lib/watchlist-board.server", () => ({
      loadWatchBoardCaptureWindow: vi.fn().mockRejectedValue(new Error("rollup unavailable")),
      emptyWatchBoardCaptureWindow: vi.fn().mockReturnValue({
        endDate: "2026-04-18",
        windowDays: 30,
        days: {},
        capturedChanges: {},
        totalCapturedChanges: 0,
        failedChecks: {},
      }),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist,
      getWatchlistDeliveryConfig: vi.fn().mockResolvedValue(watchlistDeliveryConfig),
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue(workspaceDeliveryConfig),
      listDeliveryAttempts: vi.fn().mockResolvedValue([]),
      listDeliveryTargets: vi.fn().mockResolvedValue([]),
      listEventCandidates: vi.fn().mockResolvedValue([]),
      listRecentProofCapturesForWatchlist: vi.fn().mockResolvedValue([]),
      listWatchEvents,
      listWatchlistRuns,
      listWatchlists: vi.fn().mockResolvedValue([watchlist]),
    }));

    const { loader } = await import("~/routes/app.watchlists");
    const board = (await loader({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists"),
    } as never)) as {
      selectedWatchlist: unknown;
      watchlists: unknown[];
      captureWindow: { windowDays: number; days: Record<string, unknown> };
      captureWindowDegraded: boolean;
      effectiveDeliveryConfig: { timezone: string | null };
    };

    expect(board.selectedWatchlist).toBeNull();
    expect(board.watchlists).toEqual([watchlist]);
    expect(board.captureWindow.windowDays).toBe(30);
    expect(board.captureWindowDegraded).toBe(true);
    // The board is the default view, so it must resolve the workspace
    // delivery timezone: "Next check" would otherwise print UTC beside a
    // viewer-local "Last check" and disagree with /app/dashboard.
    expect(board.effectiveDeliveryConfig.timezone).toBe(workspaceDeliveryConfig.timezone);
    // No detail query runs for a board-only view.
    expect(getWatchlist).not.toHaveBeenCalled();
    expect(listWatchEvents).not.toHaveBeenCalled();
    expect(listWatchlistRuns).not.toHaveBeenCalled();

    const opened = (await loader({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists?watchlist=watch-1"),
    } as never)) as { selectedWatchlist: unknown };

    expect(opened.selectedWatchlist).toEqual(watchlist);
    expect(getWatchlist).toHaveBeenCalledWith(expect.anything(), "watch-1", "user-1");
    expect(listWatchEvents).toHaveBeenCalled();
  });

  it("does not return owner delivery targets to workspace members", async () => {
    const memberSession = {
      ...session,
      user: { ...session.user, id: "member-1", email: "member@example.com" },
    };
    const listDeliveryTargets = vi.fn().mockResolvedValue(deliveryTargets);
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session: memberSession,
        workspaceUserId: session.user.id,
        isMember: true,
        ownerName: "Owner",
      }),
    }));
    vi.doMock("~/lib/email-verification.server", () => ({
      isUserEmailVerified: vi.fn().mockResolvedValue(true),
    }));
    vi.doMock("~/lib/plan.server", () => ({ getUserPlan: vi.fn().mockResolvedValue("starter") }));
    vi.doMock("~/lib/ad-source.server", () => ({
      resolveCommercialAdSourceStatus: vi.fn().mockResolvedValue(discoveryStatus),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      getWatchlistDeliveryConfig: vi.fn().mockResolvedValue(watchlistDeliveryConfig),
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue(workspaceDeliveryConfig),
      listDeliveryAttempts: vi.fn().mockResolvedValue([]),
      listDeliveryTargets,
      listEventCandidates: vi.fn().mockResolvedValue([]),
      listRecentProofCapturesForWatchlist: vi.fn().mockResolvedValue([]),
      listWatchEvents: vi.fn().mockResolvedValue([]),
      listWatchlistRuns: vi.fn().mockResolvedValue([]),
      listWatchlists: vi.fn().mockResolvedValue([watchlist]),
    }));

    const { loader } = await import("~/routes/app.watchlists");
    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists?watchlist=watch-1"),
    } as never);

    expect(result).toMatchObject({
      canManageDelivery: false,
      verifiedAccountEmail: "member@example.com",
      deliveryTargets: [],
      workspaceDeliveryTargets: [],
    });
    expect(JSON.stringify(result)).not.toContain("owner@example.com");
    expect(JSON.stringify(result)).not.toContain("providerIdentifier");
    expect(listDeliveryTargets).toHaveBeenCalled();
  });
});
