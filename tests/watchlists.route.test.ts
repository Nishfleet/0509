import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DeliveryAttemptRecord,
  DeliveryTargetRecord,
  EventCandidateRecord,
  ProofCaptureRecord,
  WatchEventRecord,
  WatchlistDeliveryConfigRecord,
  WatchlistRecord,
  WatchlistRunRecord,
  WorkspaceDeliveryConfigRecord,
} from "~/lib/types";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<
  string,
  unknown
>;

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

const workspaceDeliveryConfig: WorkspaceDeliveryConfigRecord = {
  id: "workspace-delivery-1",
  userId: "user-1",
  sensitivityMode: "auto",
  instantEnabled: false,
  digestEnabled: true,
  digestCadencePreference: "plan_default",
  emailEnabled: true,
  whatsappEnabled: false,
  slackEnabled: false,
  teamsEnabled: false,
  quietHours: null,
  timezone: "Asia/Kolkata",
  createdAt: "2026-04-18T00:00:00.000Z",
  updatedAt: "2026-04-18T00:00:00.000Z",
};

const watchlistDeliveryConfig: WatchlistDeliveryConfigRecord = {
  id: "watch-delivery-1",
  watchlistId: "watch-1",
  userId: "user-1",
  sensitivityMode: "quiet",
  instantEnabled: true,
  digestEnabled: true,
  emailEnabled: true,
  whatsappEnabled: true,
  slackEnabled: false,
  teamsEnabled: false,
  quietHours: {
    startHour: 22,
    endHour: 8,
  },
  timezone: "Asia/Kolkata",
  createdAt: "2026-04-18T00:00:00.000Z",
  updatedAt: "2026-04-18T00:00:00.000Z",
};

const recentEvents: WatchEventRecord[] = [
  {
    id: "event-1",
    watchlistId: "watch-1",
    runId: "run-1",
    eventType: "landing_page_offer_changed",
    status: "confirmed",
    importanceScore: 84,
    adId: "ad-1",
    baselineFromRunId: null,
    candidateId: "candidate-1",
    proofCaptureId: "proof-1",
    title: "Landing page offer changed",
    summary: "The landing-page offer changed.",
    metadata: {
      advertiser: "Nykaa",
      proofTargetIdentity: "watch-1:ad-1:example.com/page",
      from: "Starting at ₹499",
      to: "Starting at ₹799",
    },
    confirmedAt: "2026-04-18T10:00:00.000Z",
    suppressedAt: null,
    invalidatedAt: null,
    lastEvaluatedAt: "2026-04-18T10:00:00.000Z",
    createdAt: "2026-04-18T10:00:00.000Z",
  },
];

const recentCandidates: EventCandidateRecord[] = [
  {
    id: "candidate-1",
    watchlistId: "watch-1",
    runId: "run-1",
    eventType: "landing_page_offer_changed",
    status: "confirmed",
    importanceScore: 84,
    adId: "ad-1",
    proofTargetId: "target-1",
    title: "Landing page offer changed",
    summary: "The landing-page offer changed.",
    metadata: {
      advertiser: "Nykaa",
    },
    proofRequired: true,
    skipReason: null,
    dedupeReason: null,
    detectedAt: "2026-04-18T10:00:00.000Z",
    lastEvaluatedAt: "2026-04-18T10:00:05.000Z",
    createdAt: "2026-04-18T10:00:00.000Z",
    updatedAt: "2026-04-18T10:00:05.000Z",
  },
];

const recentRuns: WatchlistRunRecord[] = [
  {
    id: "run-1",
    watchlistId: "watch-1",
    triggerType: "manual",
    status: "succeeded",
    pageBudget: 5,
    pagesScanned: 2,
    baselineFromRunId: "run-0",
    summary: {
      adsSeen: 4,
      events: 2,
      candidatesDetected: 3,
      proofsAttempted: 1,
      eventsConfirmed: 2,
      sendsTriggered: 1,
    },
    startedAt: "2026-04-18T10:00:00.000Z",
    finishedAt: "2026-04-18T10:01:00.000Z",
    errorCode: null,
    errorMessage: null,
  },
];

const recentProofCaptures: ProofCaptureRecord[] = [
  {
    id: "proof-1",
    proofTargetId: "target-1",
    status: "succeeded",
    skipReason: null,
    failureCode: null,
    failureReason: null,
    screenshotArtifactKey: "proofs/proof-1.jpeg",
    htmlArtifactKey: "proofs/proof-1.html",
    extractedFields: {
      rawHeadline: "Glow sale",
      normalizedHeadline: "glow sale",
      normalizedHeadlineHash: "hash-a",
      ctaText: "Shop now",
      priceText: "Starting at ₹799",
      formPresent: true,
    },
    fieldConfidence: {
      headline: 0.95,
      ctaText: 0.82,
      priceText: 0.88,
    },
    extractionWarnings: [],
    captureMetadata: {},
    renderMode: "mobile",
    deviceProfile: "mobile_default",
    extractorVersion: "lp-signals-v1",
    idempotencyKey: "proof-request:1",
    attemptedAt: "2026-04-18T09:59:40.000Z",
    succeededAt: "2026-04-18T09:59:50.000Z",
    createdAt: "2026-04-18T09:59:50.000Z",
    updatedAt: "2026-04-18T09:59:50.000Z",
  },
  {
    id: "proof-0",
    proofTargetId: "target-1",
    status: "succeeded",
    skipReason: null,
    failureCode: null,
    failureReason: null,
    screenshotArtifactKey: "proofs/proof-0.jpeg",
    htmlArtifactKey: "proofs/proof-0.html",
    extractedFields: {
      rawHeadline: "Glow sale",
      normalizedHeadline: "glow sale",
      normalizedHeadlineHash: "hash-b",
      ctaText: "Shop now",
      priceText: "Starting at ₹499",
      formPresent: true,
    },
    fieldConfidence: {
      headline: 0.9,
      ctaText: 0.8,
      priceText: 0.85,
    },
    extractionWarnings: [],
    captureMetadata: {},
    renderMode: "mobile",
    deviceProfile: "mobile_default",
    extractorVersion: "lp-signals-v1",
    idempotencyKey: "proof-request:0",
    attemptedAt: "2026-04-17T09:59:40.000Z",
    succeededAt: "2026-04-17T09:59:50.000Z",
    createdAt: "2026-04-17T09:59:50.000Z",
    updatedAt: "2026-04-17T09:59:50.000Z",
  },
];

const deliveryTargets: DeliveryTargetRecord[] = [
  {
    id: "target-email-1",
    userId: "user-1",
    watchlistId: "watch-1",
    channel: "email",
    targetValue: "owner@example.com",
    validationStatus: "validated",
    isValidated: true,
    isOptedIn: true,
    optInSource: "manual",
    optedInAt: "2026-04-18T00:00:00.000Z",
    isPaused: false,
    pausedAt: null,
    optedOutAt: null,
    templateEligible: true,
    lastSuccessfulDeliveryAt: "2026-04-18T10:05:00.000Z",
    lastSuccessfulAttemptId: "attempt-1",
    providerIdentifier: null,
    metadata: {},
    createdAt: "2026-04-18T00:00:00.000Z",
    updatedAt: "2026-04-18T10:05:00.000Z",
  },
];

const recentDeliveryAttempts: DeliveryAttemptRecord[] = [
  {
    id: "attempt-1",
    userId: "user-1",
    watchlistId: "watch-1",
    digestRunId: null,
    deliveryTargetId: "target-email-1",
    lane: "customer",
    channel: "email",
    provider: "resend",
    status: "sent",
    webhookStatus: "delivered",
    targetValue: "owner@example.com",
    providerMessageId: "msg-1",
    providerStatusLastSeenAt: "2026-04-18T10:05:10.000Z",
    templateName: null,
    eventIds: ["event-1"],
    payloadSnapshot: {
      kind: "watch_event_alert",
    },
    idempotencyKey: "delivery-1",
    errorMessage: null,
    sentAt: "2026-04-18T10:05:00.000Z",
    failedAt: null,
    createdAt: "2026-04-18T10:05:00.000Z",
    updatedAt: "2026-04-18T10:05:10.000Z",
  },
];

const discoveryStatus = {
  status: "healthy",
  provider: "meta_library_browser",
  mode: "live",
  summary: "Live commercial discovery running through Browser Run.",
  lastCheckedAt: "2026-04-18T10:06:00.000Z",
  lastErrorCode: null,
  lastErrorMessage: null,
} as const;

function createContext() {
  return {
    cloudflare: {
      env: {},
    },
  };
}

async function mockRouter(overrides: {
  actionData?: unknown;
  fetcher?: {
    state: "idle" | "submitting" | "loading";
    formData?: FormData;
  };
  loaderData?: unknown;
  searchParams?: URLSearchParams;
}) {
  vi.doMock("react-router", async () => {
    const actual =
      await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement(
          "a",
          { ...props, href: typeof to === "string" ? to : "" },
          children,
        ),
      useActionData: vi.fn().mockReturnValue(overrides.actionData),
      // WP-42: pause/resume submits through a fetcher; render it as a plain
      // form in static markup.
      useFetcher: vi.fn().mockReturnValue({
        state: overrides.fetcher?.state ?? "idle",
        data: undefined,
        formData: overrides.fetcher?.formData,
        Form: ({ children, ...props }: MockFormProps) =>
          React.createElement("form", props, children),
      }),
      useLoaderData: vi.fn().mockReturnValue(overrides.loaderData),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
      useRevalidator: vi
        .fn()
        .mockReturnValue({ state: "idle", revalidate: vi.fn() }),
      useSearchParams: vi
        .fn()
        .mockReturnValue([
          overrides.searchParams ?? new URLSearchParams("watchlist=watch-1"),
          vi.fn(),
        ]),
    };
  });
}

/**
 * Renders `/app/watchlists` with an opened competitor on `tab`. BL-007 made
 * the detail URL-addressable, so a render helper has to name the tab the way
 * a customer's URL does.
 */
async function renderWatchlistsRoute(
  loaderData: unknown,
  tab?: string,
  fetcher?: { state: "idle" | "submitting" | "loading"; formData?: FormData },
) {
  vi.resetModules();
  await mockRouter({
    actionData: undefined,
    fetcher,
    loaderData,
    searchParams: new URLSearchParams(
      tab ? `watchlist=watch-1&tab=${tab}` : "watchlist=watch-1",
    ),
  });
  const { default: WatchlistsRoute } = await import("~/routes/app.watchlists");
  return renderToStaticMarkup(createElement(WatchlistsRoute));
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

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

describe("watchlists route actions", () => {
  it("blocks every delivery management intent for workspace members before loading target data", async () => {
    const requireWorkspaceSession = vi.fn().mockResolvedValue({
      session,
      workspaceUserId: session.user.id,
      isMember: true,
      ownerName: "Owner",
    });

    vi.doMock("~/lib/auth.server", () => ({ requireWorkspaceSession }));
    const { action } = await import("~/routes/app.watchlists");

    for (const intent of [
      "save-delivery-config",
      "add-delivery-target",
      "send-test-email",
      "toggle-delivery-target",
    ]) {
      const formData = new FormData();
      formData.set("intent", intent);
      formData.set("targetId", "owner-target");
      const result = await action({
        context: createContext(),
        request: new Request("http://localhost/app/watchlists", { method: "POST", body: formData }),
      } as never);

      expect("data" in result).toBe(true);
      if (!("data" in result)) {
        throw new Error("Expected a status-aware delivery authorization response.");
      }
      expect(result.data).toEqual({
        ok: false,
        error: undefined,
        message: "Only the account owner can manage delivery settings and targets for this workspace.",
      });
      expect(result.init?.status).toBe(403);
    }
    expect(requireWorkspaceSession).toHaveBeenCalledTimes(4);
  });

  it("keeps send-test-email responses free of recipient addresses", async () => {
    const target = deliveryTargets[0];
    const sendDeliveryTestEmail = vi.fn().mockResolvedValue(true);
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      }),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDeliveryTargetById: vi.fn().mockResolvedValue(target),
    }));
    vi.doMock("~/lib/delivery.server", () => ({ sendDeliveryTestEmail }));
    vi.doMock("~/lib/plan-feature-gate.server", () => ({
      requireDeliveryConfigSave: vi.fn().mockResolvedValue({ ok: true, plan: "starter" }),
      planFeatureDeniedActionResult: vi.fn(),
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "send-test-email");
    formData.set("targetId", target.id);
    formData.set("requestToken", "00000000-0000-4000-8000-000000000000");
    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", { method: "POST", body: formData }),
    } as never);

    expect(result).toEqual({
      ok: true,
      message: "Test email sent — if it doesn't arrive within a few minutes, check your inbox and spam folder.",
    });
    expect(JSON.stringify(result)).not.toContain(target.targetValue);
    expect(sendDeliveryTestEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      email: target.targetValue,
      targetId: target.id,
      idempotencyKey: `delivery-test:user-1:${target.id}:00000000-0000-4000-8000-000000000000`,
    }));
  });

  it("rejects missing or malformed test-email request tokens before reading targets", async () => {
    const getDeliveryTargetById = vi.fn();
    const sendDeliveryTestEmail = vi.fn();
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      }),
    }));
    vi.doMock("~/lib/data.server", () => ({ getDeliveryTargetById }));
    vi.doMock("~/lib/delivery.server", () => ({ sendDeliveryTestEmail }));

    const { action } = await import("~/routes/app.watchlists");
    for (const requestToken of ["", "not-a-route-token"]) {
      const formData = new FormData();
      formData.set("intent", "send-test-email");
      formData.set("targetId", "target-1");
      formData.set("requestToken", requestToken);

      await expect(action({
        context: createContext(),
        request: new Request("http://localhost/app/watchlists", { method: "POST", body: formData }),
      } as never)).resolves.toEqual({
        ok: false,
        message: "This test request expired. Refresh the page and try again.",
      });
    }

    expect(getDeliveryTargetById).not.toHaveBeenCalled();
    expect(sendDeliveryTestEmail).not.toHaveBeenCalled();
  });

  it("blocks manual refresh on the free plan and points at plans", async () => {
    const runWatchlistManual = vi.fn();
    vi.doMock("~/lib/ad-source.server", () => ({
      CommercialDiscoveryError: class extends Error {},
    }));
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("free"),
      checkPlanLimit: vi.fn(),
    }));
    vi.doMock("~/lib/monitoring.server", () => ({
      runWatchlistManual,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "refresh-watchlist");
    formData.set("watchlistId", "watch-1");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toMatchObject({ ok: false, error: "plan_limit_exceeded" });
    // the usage-billed live scan must never run for a free workspace
    expect(runWatchlistManual).not.toHaveBeenCalled();
  });

  it("returns a structured agency-share gate before creating a share link", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      }),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
    vi.doMock("~/lib/plan-feature-gate.server", () => ({
      requireWorkspacePlanFeature: vi
        .fn()
        .mockResolvedValue({ ok: false, plan: "starter" }),
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "share-watchlist");
    formData.set("watchlistId", "watch-1");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      error: "plan_gated",
      feature: "share_links",
      plan: "starter",
      message: "Share links are included on Starter and Agency plans.",
    });
    vi.doUnmock("~/lib/plan-feature-gate.server");
  });

  it("saves the free weekly digest toggle (free weekly watch)", async () => {
    const upsertWatchlistDeliveryConfig = vi.fn();
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      }),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
    vi.doMock("~/lib/env.server", () => ({
      isWhatsAppProviderConfigured: vi.fn(() => false),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      getWatchlistDeliveryConfig: vi.fn().mockResolvedValue(null),
      getWorkspaceDeliveryConfig: vi
        .fn()
        .mockResolvedValue(workspaceDeliveryConfig),
      upsertWatchlistDeliveryConfig,
    }));
    vi.doMock("~/lib/plan-feature-gate.server", () => ({
      planFeatureDeniedActionResult: (feature: string, plan: string) => ({
        ok: false,
        error: "plan_gated",
        feature,
        plan,
        message: "This capability is not included in your current plan.",
      }),
      requireDeliveryConfigSave: vi
        .fn()
        .mockResolvedValue({ ok: true, plan: "free" }),
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "save-delivery-config");
    formData.set("watchlistId", "watch-1");
    formData.set("digestEnabled", "on");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    // Free carries the weekly_digest entitlement now, so the digest toggle
    // saves instead of plan-gating (opt-out must work for free users).
    expect(result).toMatchObject({
      ok: true,
    });
    expect(upsertWatchlistDeliveryConfig).toHaveBeenCalled();
    vi.doUnmock("~/lib/plan-feature-gate.server");
    vi.doUnmock("~/lib/env.server");
    vi.doUnmock("~/lib/data.server");
    vi.doUnmock("~/lib/auth.server");
    vi.doUnmock("~/lib/context.server");
  });

  it("returns a friendly message when manual refresh is rate limited", async () => {
    class MockCommercialDiscoveryError extends Error {
      failureClass = "rate_limited" as const;
      retryAfterSeconds: number | null = null;

      constructor(message: string) {
        super(message);
        this.name = "CommercialDiscoveryError";
      }
    }

    vi.doMock("~/lib/ad-source.server", () => ({
      CommercialDiscoveryError: MockCommercialDiscoveryError,
    }));
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
      checkPlanLimit: vi.fn(),
    }));
    vi.doMock("~/lib/monitoring.server", () => ({
      runWatchlistManual: vi
        .fn()
        .mockRejectedValue(
          new MockCommercialDiscoveryError("Rate limit exceeded"),
        ),
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "refresh-watchlist");
    formData.set("watchlistId", "watch-1");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message:
        "Competitor ad checks are temporarily rate limited. Scheduled checks will keep retrying.",
      ok: false,
    });
  });

  it("includes the retry window when manual refresh receives one", async () => {
    class MockCommercialDiscoveryError extends Error {
      failureClass = "rate_limited" as const;
      retryAfterSeconds: number | null;

      constructor(message: string, retryAfterSeconds: number) {
        super(message);
        this.name = "CommercialDiscoveryError";
        this.retryAfterSeconds = retryAfterSeconds;
      }
    }

    vi.doMock("~/lib/ad-source.server", () => ({
      CommercialDiscoveryError: MockCommercialDiscoveryError,
    }));
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
      checkPlanLimit: vi.fn(),
    }));
    vi.doMock("~/lib/monitoring.server", () => ({
      runWatchlistManual: vi
        .fn()
        .mockRejectedValue(
          new MockCommercialDiscoveryError("Rate limit exceeded", 7200),
        ),
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "refresh-watchlist");
    formData.set("watchlistId", "watch-1");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message:
        "Competitor ad checks are temporarily rate limited. Retry after about 2h. Scheduled checks will keep retrying.",
      ok: false,
    });
  });

  it("does not refresh an inactive watchlist left behind by retargeting", async () => {
    const runWatchlistManual = vi.fn();
    vi.doMock("~/lib/ad-source.server", () => ({
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {},
    }));
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue({
        ...watchlist,
        isActive: false,
      }),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
      checkPlanLimit: vi.fn(),
    }));
    vi.doMock("~/lib/monitoring.server", () => ({
      runWatchlistManual,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "refresh-watchlist");
    formData.set("watchlistId", "watch-1");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "We couldn't find that watchlist. Refresh the page and try again.",
      ok: false,
    });
    expect(runWatchlistManual).not.toHaveBeenCalled();
  });

  it("saves watchlist delivery settings with parsed quiet hours and timezone", async () => {
    const upsertWatchlistDeliveryConfig = vi
      .fn()
      .mockResolvedValue(watchlistDeliveryConfig);

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      getWatchlistDeliveryConfig: vi.fn().mockResolvedValue(null),
      getWorkspaceDeliveryConfig: vi
        .fn()
        .mockResolvedValue(workspaceDeliveryConfig),
      upsertWatchlistDeliveryConfig,
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
      checkPlanLimit: vi.fn(),
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "save-delivery-config");
    formData.set("watchlistId", "watch-1");
    formData.set("sensitivityMode", "aggressive");
    formData.set("instantEnabled", "on");
    formData.set("digestEnabled", "on");
    formData.set("emailEnabled", "on");
    formData.set("timezone", "Asia/Kolkata");
    formData.set("quietHoursStart", "22");
    formData.set("quietHoursEnd", "8");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Delivery settings updated.",
      ok: true,
    });
    expect(upsertWatchlistDeliveryConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        watchlistId: "watch-1",
        userId: "user-1",
        sensitivityMode: "aggressive",
        instantEnabled: true,
        digestEnabled: true,
        emailEnabled: true,
        whatsappEnabled: false,
        slackEnabled: false,
        timezone: "Asia/Kolkata",
        quietHours: {
          startHour: 22,
          endHour: 8,
        },
      }),
    );
  });

  it("rejects an invalid delivery timezone before persistence", async () => {
    const upsertWatchlistDeliveryConfig = vi.fn();
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      }),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      getWatchlistDeliveryConfig: vi.fn().mockResolvedValue(null),
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue(workspaceDeliveryConfig),
      upsertWatchlistDeliveryConfig,
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
      checkPlanLimit: vi.fn(),
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "save-delivery-config");
    formData.set("watchlistId", "watch-1");
    formData.set("emailEnabled", "on");
    formData.set("timezone", "Not/AZone");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", { method: "POST", body: formData }),
    } as never);

    expect(result).toEqual({
      ok: false,
      message: "Enter a valid IANA timezone, such as America/New_York or UTC.",
    });
    expect(upsertWatchlistDeliveryConfig).not.toHaveBeenCalled();
  });

  it("preserves dormant WhatsApp settings and applies live Slack/Teams toggles on delivery saves", async () => {
    const upsertWatchlistDeliveryConfig = vi
      .fn()
      .mockResolvedValue(watchlistDeliveryConfig);

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      getWatchlistDeliveryConfig: vi.fn().mockResolvedValue({
        ...watchlistDeliveryConfig,
        whatsappEnabled: true,
        slackEnabled: true,
        teamsEnabled: true,
      }),
      getWorkspaceDeliveryConfig: vi
        .fn()
        .mockResolvedValue(workspaceDeliveryConfig),
      upsertWatchlistDeliveryConfig,
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
      checkPlanLimit: vi.fn(),
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "save-delivery-config");
    formData.set("watchlistId", "watch-1");
    formData.set("sensitivityMode", "balanced");
    formData.set("emailEnabled", "on");
    formData.set("slackEnabled", "on");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Delivery settings updated.",
      ok: true,
    });
    expect(upsertWatchlistDeliveryConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        watchlistId: "watch-1",
        userId: "user-1",
        sensitivityMode: "balanced",
        emailEnabled: true,
        // WhatsApp is still a dormant GA channel: its stored value is
        // preserved no matter what the form sends.
        whatsappEnabled: true,
        // Slack is live: the checked box applies.
        slackEnabled: true,
        // Teams is live but unchecked: it turns off.
        teamsEnabled: false,
      }),
    );
  });

  it("updates the selected watchlist competitor and name", async () => {
    const updateWatchlist = vi.fn().mockResolvedValue({
      ...watchlist,
      name: "Mamaearth launch watch",
      targetId: "Mamaearth",
      targetLabel: "Mamaearth",
      targetCountry: null,
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      updateWatchlist,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "update-watchlist");
    formData.set("watchlistId", "watch-1");
    formData.set("name", "Mamaearth launch watch");
    formData.set("targetLabel", "Mamaearth");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Watchlist updated.",
      ok: true,
    });
    expect(updateWatchlist).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "watch-1",
      expect.objectContaining({
        name: "Mamaearth launch watch",
        targetType: "advertiser",
        targetId: "Mamaearth",
        targetLabel: "Mamaearth",
        targetCountry: null,
      }),
    );
    expect(updateWatchlist.mock.calls[0][3].targetFingerprint).toMatch(
      /^fnv1a-/,
    );
  });

  it("redirects to the replacement watchlist when retargeting creates a new baseline", async () => {
    const updateWatchlist = vi.fn().mockResolvedValue({
      ...watchlist,
      id: "watch-2",
      name: "Mamaearth launch watch",
      targetId: "Mamaearth",
      targetLabel: "Mamaearth",
      targetCountry: null,
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      updateWatchlist,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "update-watchlist");
    formData.set("watchlistId", "watch-1");
    formData.set("name", "Mamaearth launch watch");
    formData.set("targetLabel", "Mamaearth");

    let redirectResponse: Response | null = null;
    try {
      await action({
        context: createContext(),
        request: new Request("http://localhost/app/watchlists", {
          method: "POST",
          body: formData,
        }),
      } as never);
    } catch (error) {
      redirectResponse = error as Response;
    }

    expect(redirectResponse?.status).toBe(302);
    expect(redirectResponse?.headers.get("Location")).toBe(
      "/app/watchlists?watchlist=watch-2",
    );
  });

  it("preserves direct competitor website proof tracking when editing a watchlist", async () => {
    const updateWatchlist = vi.fn().mockResolvedValue({
      ...watchlist,
      name: "Nykaa launch watch",
      targetId: "https://nykaa.com",
      targetLabel: "Nykaa",
      targetCountry: null,
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue({
        ...watchlist,
        targetId: "https://nykaa.com",
        targetLabel: "Nykaa",
        targetCountry: null,
      }),
      updateWatchlist,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "update-watchlist");
    formData.set("watchlistId", "watch-1");
    formData.set("name", "Nykaa launch watch");
    formData.set("competitorWebsite", "https://www.nykaa.com/?utm_source=meta");
    formData.set("targetLabel", "Nykaa");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Watchlist updated.",
      ok: true,
    });
    expect(updateWatchlist).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "watch-1",
      expect.objectContaining({
        name: "Nykaa launch watch",
        targetType: "advertiser",
        targetId: "https://nykaa.com",
        targetLabel: "Nykaa",
        targetCountry: null,
      }),
    );
    expect(updateWatchlist.mock.calls[0][3].targetFingerprint).toBe("fp-nykaa");
  });

  it("rejects an incomplete website when editing a watchlist", async () => {
    const updateWatchlist = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      updateWatchlist,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "update-watchlist");
    formData.set("watchlistId", "watch-1");
    formData.set("name", "Samplebrand watch");
    formData.set("competitorWebsite", "samplebrand");
    formData.set("targetLabel", "Samplebrand");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message:
        "That website looks incomplete. Add the full domain, like brand.com.",
      ok: false,
    });
    expect(updateWatchlist).not.toHaveBeenCalled();
  });

  it("passes self tracking through watchlist edits", async () => {
    const updateWatchlist = vi.fn().mockResolvedValue({
      ...watchlist,
      name: "Samplebrand watch",
      trackingRole: "self",
      targetId: "https://samplebrand.com",
      targetLabel: "Samplebrand",
      targetCountry: null,
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      updateWatchlist,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "update-watchlist");
    formData.set("watchlistId", "watch-1");
    formData.set("trackingRole", "self");
    formData.set("name", "Samplebrand watch");
    formData.set("competitorWebsite", "samplebrand.com");
    formData.set("targetLabel", "Samplebrand");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Watchlist updated.",
      ok: true,
    });
    expect(updateWatchlist).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "watch-1",
      expect.objectContaining({
        name: "Samplebrand watch",
        targetId: "https://samplebrand.com",
        targetLabel: "Samplebrand",
        trackingRole: "self",
      }),
    );
  });

  it("keeps the existing fingerprint when only the tracking role changes", async () => {
    const countryWatchlist = {
      ...watchlist,
      targetId: "https://samplebrand.com",
      targetFingerprint: "existing-us-fingerprint",
      targetLabel: "Samplebrand",
      targetCountry: "US",
    };
    const updateWatchlist = vi.fn().mockResolvedValue({
      ...countryWatchlist,
      trackingRole: "self",
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(countryWatchlist),
      updateWatchlist,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "update-watchlist");
    formData.set("watchlistId", "watch-1");
    formData.set("trackingRole", "self");
    formData.set("name", "Samplebrand watch");
    formData.set("competitorWebsite", "samplebrand.com");
    formData.set("targetLabel", "Samplebrand");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Watchlist updated.",
      ok: true,
    });
    expect(updateWatchlist).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "watch-1",
      expect.objectContaining({
        targetFingerprint: "existing-us-fingerprint",
        targetCountry: "US",
        trackingRole: "self",
      }),
    );
  });

  it("preserves saved-query targets and labels when editing a watchlist name", async () => {
    const savedQueryWatchlist = {
      ...watchlist,
      targetType: "saved_query" as const,
      targetId: "saved-query-1",
      targetFingerprint: "saved-query-fingerprint",
      targetLabel: "Nykaa launch searches",
      targetCountry: null,
    };
    const updateWatchlist = vi.fn().mockResolvedValue({
      ...savedQueryWatchlist,
      name: "Renamed saved query watch",
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(savedQueryWatchlist),
      updateWatchlist,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "update-watchlist");
    formData.set("watchlistId", "watch-1");
    formData.set("name", "Renamed saved query watch");
    formData.set("targetLabel", "Renamed query label");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Watchlist updated.",
      ok: true,
    });
    expect(updateWatchlist).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "watch-1",
      expect.objectContaining({
        name: "Renamed saved query watch",
        targetType: "saved_query",
        targetId: "saved-query-1",
        targetFingerprint: "saved-query-fingerprint",
        targetLabel: "Nykaa launch searches",
        targetCountry: null,
      }),
    );
  });

  it("returns a friendly message when a watchlist edit duplicates another target", async () => {
    const updateWatchlist = vi
      .fn()
      .mockRejectedValue(new Error("watchlist_duplicate_target"));

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      updateWatchlist,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "update-watchlist");
    formData.set("watchlistId", "watch-1");
    formData.set("name", "Duplicate watch");
    formData.set("targetLabel", "Nykaa");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Another active watchlist already tracks that competitor.",
      ok: false,
    });
  });

  it("blocks WhatsApp delivery targets while WhatsApp is not customer-facing", async () => {
    const upsertDeliveryTarget = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      upsertDeliveryTarget,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "add-delivery-target");
    formData.set("watchlistId", "watch-1");
    formData.set("channel", "whatsapp");
    formData.set("targetValue", "+919999999999");
    formData.set("explicitOptIn", "on");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message:
        "WhatsApp delivery isn’t available. Nothing was saved — use email delivery instead.",
      ok: false,
    });
    expect(upsertDeliveryTarget).not.toHaveBeenCalled();
  });

  it("points watchlist-scoped Slack delivery targets to the Notifications page", async () => {
    const upsertDeliveryTarget = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      upsertDeliveryTarget,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "add-delivery-target");
    formData.set("watchlistId", "watch-1");
    formData.set("channel", "slack");
    formData.set("targetValue", "https://hooks.slack.test/services/fake");
    formData.set("explicitOptIn", "on");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message:
        "Connect Slack or Teams delivery from the Notifications page — watchlist-scoped webhook targets aren't supported.",
      ok: false,
    });
    expect(upsertDeliveryTarget).not.toHaveBeenCalled();
  });

  it("pauses an existing watchlist delivery target", async () => {
    const upsertDeliveryTarget = vi.fn();
    const getDeliveryTargetById = vi.fn().mockResolvedValue(deliveryTargets[0]);

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      getDeliveryTargetById,
      upsertDeliveryTarget,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "toggle-delivery-target");
    formData.set("targetId", "target-email-1");
    formData.set("watchlistId", "forged-watchlist");
    formData.set("channel", "whatsapp");
    formData.set("targetValue", "forged@example.com");
    formData.set("isPaused", "false");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Delivery target paused.",
      ok: true,
    });
    expect(upsertDeliveryTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        watchlistId: "watch-1",
        userId: "user-1",
        channel: "email",
        targetValue: "owner@example.com",
        isPaused: true,
      }),
    );
    expect(getDeliveryTargetById).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      targetId: "target-email-1",
    });
  });

  it("resumes every unsubscribe-suppressed email target when the workspace default is re-opted", async () => {
    const defaultTarget = {
      ...deliveryTargets[0],
      id: "target-email-default",
      watchlistId: null,
      isOptedIn: false,
      isPaused: true,
      pausedAt: "2026-07-16T00:00:00.000Z",
      optedOutAt: "2026-07-16T00:00:00.000Z",
    };
    const getDeliveryTargetById = vi.fn().mockResolvedValue(defaultTarget);
    const resumeEmailTargetsForUserAndAddress = vi.fn().mockResolvedValue(2);
    const upsertDeliveryTarget = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn(),
      getDeliveryTargetById,
      resumeEmailTargetsForUserAndAddress,
      upsertDeliveryTarget,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "toggle-delivery-target");
    formData.set("targetId", defaultTarget.id);

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Delivery target resumed.",
      ok: true,
    });
    expect(resumeEmailTargetsForUserAndAddress).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      targetValue: "owner@example.com",
      source: "delivery_settings",
    });
    expect(upsertDeliveryTarget).not.toHaveBeenCalled();
  });

  it("resumes every unsubscribe-suppressed email target when a watchlist target is re-opted", async () => {
    const watchlistTarget = {
      ...deliveryTargets[0],
      isOptedIn: false,
      isPaused: true,
      pausedAt: "2026-07-16T00:00:00.000Z",
      optedOutAt: "2026-07-16T00:00:00.000Z",
    };
    const getDeliveryTargetById = vi.fn().mockResolvedValue(watchlistTarget);
    const resumeEmailTargetsForUserAndAddress = vi.fn().mockResolvedValue(2);
    const upsertDeliveryTarget = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      getDeliveryTargetById,
      resumeEmailTargetsForUserAndAddress,
      upsertDeliveryTarget,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "toggle-delivery-target");
    formData.set("targetId", watchlistTarget.id);

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Delivery target resumed.",
      ok: true,
    });
    expect(resumeEmailTargetsForUserAndAddress).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      targetValue: "owner@example.com",
      source: "delivery_settings",
    });
    expect(upsertDeliveryTarget).not.toHaveBeenCalled();
  });

  it("resumes only the workspace default when it was merely paused", async () => {
    const defaultTarget = {
      ...deliveryTargets[0],
      id: "target-email-default",
      watchlistId: null,
      isOptedIn: true,
      isPaused: true,
      pausedAt: "2026-07-16T00:00:00.000Z",
      optedOutAt: null,
    };
    const getDeliveryTargetById = vi.fn().mockResolvedValue(defaultTarget);
    const resumeEmailTargetsForUserAndAddress = vi.fn();
    const upsertDeliveryTarget = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn(),
      getDeliveryTargetById,
      resumeEmailTargetsForUserAndAddress,
      upsertDeliveryTarget,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "toggle-delivery-target");
    formData.set("targetId", defaultTarget.id);

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Delivery target resumed.",
      ok: true,
    });
    expect(upsertDeliveryTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        watchlistId: null,
        channel: "email",
        targetValue: "owner@example.com",
        isPaused: false,
        pausedAt: null,
        optedOutAt: null,
      }),
    );
    expect(resumeEmailTargetsForUserAndAddress).not.toHaveBeenCalled();
  });

  it("blocks toggling WhatsApp delivery targets while WhatsApp is not customer-facing", async () => {
    const upsertDeliveryTarget = vi.fn();
    const getDeliveryTargetById = vi.fn().mockResolvedValue({
      ...deliveryTargets[0],
      id: "target-whatsapp-1",
      channel: "whatsapp",
      targetValue: "+919999999999",
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      getDeliveryTargetById,
      upsertDeliveryTarget,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "toggle-delivery-target");
    formData.set("watchlistId", "watch-1");
    formData.set("channel", "whatsapp");
    formData.set("targetValue", "+919999999999");
    formData.set("isPaused", "true");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message:
        "WhatsApp delivery isn’t available. Nothing was saved — use email delivery instead.",
      ok: false,
    });
    expect(upsertDeliveryTarget).not.toHaveBeenCalled();
  });

  it("points watchlist-scoped Slack delivery toggles to the Notifications page", async () => {
    const upsertDeliveryTarget = vi.fn();
    const getDeliveryTargetById = vi.fn().mockResolvedValue({
      ...deliveryTargets[0],
      id: "target-slack-1",
      channel: "slack",
      targetValue: "slack-target",
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      getDeliveryTargetById,
      upsertDeliveryTarget,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "toggle-delivery-target");
    formData.set("watchlistId", "watch-1");
    formData.set("channel", "slack");
    formData.set("targetValue", "https://hooks.slack.test/services/fake");
    formData.set("isPaused", "true");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message:
        "Manage Slack or Teams delivery from the Notifications page — watchlist-scoped webhook targets aren't supported.",
      ok: false,
    });
    expect(upsertDeliveryTarget).not.toHaveBeenCalled();
  });
});

describe("watchlists route rendering", () => {
  it("derives list-card scan truth from the durable run instead of a missing completion timestamp", async () => {
    const { resolveWatchlistListScanPresentation } = await import("~/routes/app.watchlists");
    const run = (status: WatchlistRunRecord["status"], errorCode: string | null = null) => ({
      ...recentRuns[0],
      errorCode,
      finishedAt: status === "succeeded" ? "2026-04-18T10:01:00.000Z" : null,
      status,
    });

    expect(resolveWatchlistListScanPresentation({
      isActive: true,
      lastScannedAt: null,
      latestRun: null,
      plan: "starter",
    }).label).toBe("No completed check yet — open for status");
    expect(resolveWatchlistListScanPresentation({
      isActive: true,
      lastScannedAt: null,
      latestRun: run("pending", "workflow_binding_missing"),
      plan: "starter",
    }).label).toBe("Check delayed — we're retrying");
    expect(resolveWatchlistListScanPresentation({
      isActive: true,
      lastScannedAt: null,
      latestRun: run("running"),
      plan: "free",
    }).label).toBe("Activation scan running");
    expect(resolveWatchlistListScanPresentation({
      isActive: true,
      lastScannedAt: null,
      latestRun: run("failed", "provider_unavailable"),
      plan: "starter",
    }).label).toBe("Latest check failed — open for next steps");
    expect(resolveWatchlistListScanPresentation({
      isActive: true,
      lastScannedAt: null,
      latestRun: run("skipped", "e2e_provider_network_denied"),
      plan: "starter",
    }).label).toBe("New checks paused — source access needed");
    expect(resolveWatchlistListScanPresentation({
      isActive: true,
      lastScannedAt: null,
      latestRun: run("succeeded"),
      plan: "starter",
    })).toEqual({
      label: "Last successful check",
      timestamp: "2026-04-18T10:01:00.000Z",
    });
  });

  it("keeps empty evidence, recent-check timing, and polling identity bound to the durable run", async () => {
    const {
      firstScanPollingKey,
      resolveEmptyWatchlistEventCopy,
      resolveWatchlistRunCustomerError,
      resolveWatchlistRunTiming,
    } = await import("~/routes/app.watchlists");
    const run = (status: WatchlistRunRecord["status"], errorCode: string | null = null) => ({
      ...recentRuns[0],
      errorCode,
      finishedAt: null,
      id: `run-${status}-${errorCode ?? "none"}`,
      status,
    });
    const copy = (latestRun: WatchlistRunRecord | null) => resolveEmptyWatchlistEventCopy({
      lastScannedAt: null,
      latestRun,
      nextScanLabel: null,
      plan: "free",
    });

    expect(copy(run("running"))).toContain("activation scan is running now");
    expect(copy(run("pending"))).toContain("activation scan is in line");
    expect(copy(run("pending", "workflow_binding_missing"))).toContain("retrying it automatically");
    expect(copy(run("failed", "provider_unavailable"))).toContain("couldn't finish");
    expect(copy(run("skipped", "e2e_provider_network_denied"))).toContain("paused safely");
    expect(copy(run("succeeded"))).toContain("activation scan is complete");
    expect(copy(run("succeeded"))).toContain("checked weekly");
    for (const state of [
      null,
      run("pending"),
      run("pending", "workflow_binding_missing"),
      run("failed"),
      run("skipped"),
      run("succeeded"),
    ]) {
      expect(copy(state)).not.toContain("running now");
    }
    for (const state of [
      run("pending"),
      run("running"),
      run("failed"),
      run("skipped"),
    ]) {
      expect(resolveEmptyWatchlistEventCopy({
        lastScannedAt: "2026-04-17T10:00:00.000Z",
        latestRun: state,
        nextScanLabel: "tomorrow",
        plan: "free",
      })).not.toContain("activation-only scan is complete");
    }
    for (const state of [
      null,
      run("failed"),
      run("skipped", "e2e_provider_network_denied"),
    ]) {
      const recoveryCopy = copy(state);
      expect(recoveryCopy).not.toMatch(/\bretry\b/i);
      expect(recoveryCopy).toContain("support");
    }

    expect(resolveWatchlistRunTiming(run("pending"))).toEqual({
      label: "In line — starts automatically",
      timestamp: null,
    });
    expect(resolveWatchlistRunTiming(run("pending", "dispatch_failed")).label).toBe("Retrying automatically");
    expect(resolveWatchlistRunTiming(run("running")).label).toBe("Still running");
    expect(resolveWatchlistRunTiming(run("failed")).label).toBe("Stopped after a failed check");
    expect(resolveWatchlistRunTiming(run("skipped")).label).toBe("Stopped before results were saved");

    const failedWithPrivateError = {
      ...run("failed"),
      errorMessage: "provider token leaked",
    };
    expect(resolveWatchlistRunCustomerError(failedWithPrivateError, "free")).toBe(
      "This activation scan failed. Check Source access, and email support if the next attempt fails too.",
    );
    expect(resolveWatchlistRunCustomerError(failedWithPrivateError, "free")).not.toMatch(/\bretry\b/i);
    expect(resolveWatchlistRunCustomerError(failedWithPrivateError, "starter")).toBe(
      "This scan failed. Check Source access, then retry — or email support and we'll dig in.",
    );
    expect(resolveWatchlistRunCustomerError(failedWithPrivateError, "free")).not.toContain(
      "provider token leaked",
    );

    const pending = run("pending");
    expect(firstScanPollingKey({ watchlistId: "watch-1", run: pending })).not.toBe(
      firstScanPollingKey({ watchlistId: "watch-1", run: { ...pending, id: "retry-run" } }),
    );
    expect(firstScanPollingKey({ watchlistId: "watch-1", run: pending })).not.toBe(
      firstScanPollingKey({ watchlistId: "watch-1", run: { ...pending, status: "running" } }),
    );
  });

  it("keeps saved evidence visible without promising a recurring check when source access is unavailable", async () => {
    const { resolveWatchlistTrackingPresentation } = await import("~/routes/app.watchlists");
    const presentation = resolveWatchlistTrackingPresentation(
      {
        status: "demo",
        summary: "Live ad checks aren't configured yet, so searches show labeled sample data.",
        lastCheckedAt: null,
        recovery: null,
      },
      recentRuns,
      {
        totalAttempts: 1,
        successfulAttempts: 1,
        failedAttempts: 0,
        skippedAttempts: 0,
        lastAttemptAt: "2026-04-18T09:59:50.000Z",
        lastSuccessfulProofAt: "2026-04-18T09:59:50.000Z",
      },
    );

    expect(presentation).toEqual({
      headline: "Monitoring history is saved; new checks need source access",
      summary: "Your last successful evidence remains available. Review source access before relying on new competitor changes.",
      statusLabel: "Needs source access",
      lastCheckedAt: "2026-04-18T10:01:00.000Z",
    });
  });

  // BL-006 — brief §6.1/§6.3/§7: the board is the page.
  it("renders the watch board with one band per competitor and no detail panel", async () => {
    await mockRouter({
      actionData: undefined,
      searchParams: new URLSearchParams(),
      loaderData: {
        renderedAt: "2026-04-18T10:59:50.000Z",
        plan: "starter",
        canManageDelivery: true,
        verifiedAccountEmail: "owner@example.com",
        watchlists: [watchlist, { ...watchlist, id: "watch-2", name: "Paused rival", isActive: false }],
        selectedWatchlist: null,
        captureWindow: {
          endDate: "2026-04-18",
          windowDays: 30,
          days: {
            "watch-1": [
              { date: "2026-04-17", state: "quiet" },
              { date: "2026-04-18", state: "captured" },
            ],
          },
          capturedChanges: { "watch-1": 2 },
          totalCapturedChanges: 2,
          failedChecks: {},
        },
        captureWindowDegraded: true,
        eventCandidates: [],
        events: [],
        runs: [],
        workspaceDeliveryConfig,
        watchlistDeliveryConfig: null,
        discoveryStatus,
        effectiveDeliveryConfig: {
          sensitivityMode: "balanced",
          instantEnabled: false,
          digestEnabled: true,
          digestCadencePreference: "plan_default",
          emailEnabled: true,
          whatsappEnabled: false,
          slackEnabled: false,
          quietHours: null,
          timezone: "UTC",
        },
        deliveryTargets: [],
        workspaceDeliveryTargets: [],
        recentDeliveryAttempts: [],
        recentProofCaptures: [],
        proofSummary: {
          totalAttempts: 0,
          successfulAttempts: 0,
          failedAttempts: 0,
          skippedAttempts: 0,
          lastAttemptAt: null,
          lastSuccessfulProofAt: null,
        },
        creativeWall: [],
        trendDailyActivity: [],
      },
    });

    const { default: WatchlistsRoute } = await import("~/routes/app.watchlists");
    const markup = renderToStaticMarkup(createElement(WatchlistsRoute));

    // BL-030 — the list is a list: one ruled row per competitor, each with a
    // name, one plain sentence, one status word and one date. The band, its
    // 30-day histogram, the ticker and the five-cell status strip are gone;
    // the same facts are one line of text or one row of the detail pane.
    expect(markup.match(/class="f9-wk-row(?: [^"]*)?"/g)).toHaveLength(2);
    expect(markup).toContain("Nykaa watch");
    expect(markup).toContain("Paused rival");
    expect(markup).toContain("Recent change and failed-check totals could not be loaded.");
    expect(markup).toContain("Recent change and failed-check totals are unavailable.");
    expect(markup).toContain("Recent totals are unavailable.");
    expect(markup).not.toContain("2 changes captured in the last 30 days.");
    expect(markup).not.toContain("Checked, and nothing has changed");
    expect(markup).not.toContain("competitor-detail");
    expect(markup).toContain("Paused. No checks run and the history stays.");
    expect(markup).not.toContain("f9-evidence-capture-strip");
    expect(markup).not.toContain("f9-evidence-ticker");
    expect(markup).not.toContain("f9-evidence-status-strip");
    // Exactly one filled button — the page's single action.
    expect(markup.match(/class="f9-wk-btn"/g)).toHaveLength(1);
    expect(markup).toContain("Add competitor");
    expect(markup).not.toContain("f9-evidence-cta--rank1");
    // Aggregate-derived state filters stand down while their rollup is unavailable.
    expect(markup).not.toContain('class="f9-wk-tab');
    // The detail pane and the full record stay closed until a row is opened.
    expect(markup).not.toContain("f9-wk-detail");
    expect(markup).not.toContain("Evidence and alerts");
    expect(markup).not.toContain("Watchlist setup");
    // No bulk bar without a selection.
    expect(markup).not.toContain("competitors selected");
  });

  it("renders the designed specimen panel when nothing is tracked yet", async () => {
    await mockRouter({
      actionData: undefined,
      searchParams: new URLSearchParams(),
      loaderData: {
        renderedAt: "2026-04-18T10:59:50.000Z",
        plan: "free",
        canManageDelivery: true,
        verifiedAccountEmail: null,
        watchlists: [],
        selectedWatchlist: null,
        captureWindow: {
          endDate: "2026-04-18",
          windowDays: 30,
          days: {},
          capturedChanges: {},
          totalCapturedChanges: 0,
          failedChecks: {},
        },
        eventCandidates: [],
        events: [],
        runs: [],
        workspaceDeliveryConfig,
        watchlistDeliveryConfig: null,
        discoveryStatus,
        effectiveDeliveryConfig: {
          sensitivityMode: "balanced",
          instantEnabled: false,
          digestEnabled: true,
          digestCadencePreference: "plan_default",
          emailEnabled: true,
          whatsappEnabled: false,
          slackEnabled: false,
          quietHours: null,
          timezone: "UTC",
        },
        deliveryTargets: [],
        workspaceDeliveryTargets: [],
        recentDeliveryAttempts: [],
        recentProofCaptures: [],
        proofSummary: {
          totalAttempts: 0,
          successfulAttempts: 0,
          failedAttempts: 0,
          skippedAttempts: 0,
          lastAttemptAt: null,
          lastSuccessfulProofAt: null,
        },
        creativeWall: [],
        trendDailyActivity: [],
      },
    });

    const { default: WatchlistsRoute } = await import("~/routes/app.watchlists");
    const markup = renderToStaticMarkup(createElement(WatchlistsRoute));

    // BL-030 round 2: an empty board gets a sentence and a way in, not a
    // dimmed specimen plate. The caps-mono "BAND 01 — RESERVED" diagram of the
    // thing the customer does not have yet was the v3 ornament habit.
    expect(markup).not.toContain("f9-evidence-specimen");
    expect(markup).not.toContain("BAND 01 — RESERVED");
    expect(markup).not.toContain("WATCH BOARD · NOTHING TRACKED YET");
    expect(markup).toContain("Nothing tracked yet");
    expect(markup).toContain(
      "Add your first competitor and its first check starts immediately.",
    );
    expect(markup).toContain("See a proof brief");
    // The screen still carries exactly one filled button, and it is the
    // header's — the one thing this page exists to do.
    expect(markup).not.toContain("f9-evidence-cta--rank1");
    expect(markup.match(/class="f9-wk-btn"/g)).toHaveLength(1);
    // No board chrome without competitors.
    expect(markup).not.toContain("f9-wk-tabs");
    expect(markup).not.toContain("f9-evidence-ticker");
    expect(markup).not.toContain("f9-evidence-status-strip");
  });

  const selectedPanelLoaderData = {
    renderedAt: "2026-04-18T10:59:50.000Z",
    plan: "starter",
    canManageDelivery: false,
    verifiedAccountEmail: "member@example.com",
    watchlists: [watchlist],
    selectedWatchlist: watchlist,
    eventCandidates: recentCandidates,
    events: recentEvents,
    runs: recentRuns,
    workspaceDeliveryConfig,
    watchlistDeliveryConfig,
    discoveryStatus,
    effectiveDeliveryConfig: {
      sensitivityMode: "quiet",
      instantEnabled: true,
      digestEnabled: true,
      digestCadencePreference: "plan_default",
      emailEnabled: true,
      whatsappEnabled: true,
      slackEnabled: false,
      quietHours: {
        startHour: 22,
        endHour: 8,
      },
      timezone: "Asia/Kolkata",
    },
    deliveryTargets,
    workspaceDeliveryTargets: [],
    recentDeliveryAttempts,
    recentProofCaptures,
    proofSummary: {
      totalAttempts: 2,
      successfulAttempts: 2,
      failedAttempts: 0,
      skippedAttempts: 0,
      lastAttemptAt: "2026-04-18T09:59:50.000Z",
      lastSuccessfulProofAt: "2026-04-18T09:59:50.000Z",
    },
    creativeWall: [],
    trendDailyActivity: [],
  };

  it("renders a selected competitor as one entity-owned detail surface", async () => {
    const markup = await renderWatchlistsRoute(selectedPanelLoaderData);

    expect(markup).toContain('<h1 class="f9-wk-title">Nykaa watch</h1>');
    expect(markup).toContain('href="/app/watchlists">All competitors</a>');
    expect(markup.match(/id="competitor-detail"/g)).toHaveLength(1);
    expect(markup).not.toContain('aria-label="Competitors"');
    // BL-035 keeps a split INSIDE the detail (panel + fact rail). What must be
    // gone is the board's list/peek split that used to sit under it.
    expect(markup).not.toContain('class="f9-wk-split is-single"');
    expect(markup).not.toContain('class="f9-wk-split-list"');
    expect(markup).toContain('class="f9-wk-split is-wide f9-watchdetail-split"');
  });

  it("does not turn a failed capture-window rollup into a quiet or zero finding", async () => {
    const markup = await renderWatchlistsRoute({
      ...selectedPanelLoaderData,
      captureWindowDegraded: true,
    });

    expect(markup).toContain("Recent aggregate totals are unavailable");
    expect(markup).toContain("Unavailable — refresh to try again");
    expect(markup).not.toContain("Checked, and nothing has changed in 30 days.");
    expect(markup).not.toContain('class="f9-evidence-number-value">0</p>');
    // The status strip is gone in BL-035, so the same statement is carried by
    // the working header's context line and the caught number card.
    expect(markup).toContain("Recent totals unavailable");
    expect(markup).toContain('class="f9-evidence-number-value">Unavailable</p>');
  });

  it("does not promise automatic checks while source access is blocked", async () => {
    const markup = await renderWatchlistsRoute(
      {
        ...selectedPanelLoaderData,
        discoveryStatus: {
          status: "demo",
          provider: "meta_library_browser",
          mode: "demo",
          summary: "Live source access is unavailable.",
          lastCheckedAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      },
      "setup",
    );

    expect(markup).toContain("Automatic checks are waiting for source access");
    expect(markup).not.toContain("Automatic checks are on.");
    expect(markup).toContain('href="/app/source-access"');
  });

  it("keeps action feedback text from becoming an external navigation sink", async () => {
    await mockRouter({
      actionData: { ok: true, message: "http://evil.example/phish" },
      loaderData: selectedPanelLoaderData,
      searchParams: new URLSearchParams("watchlist=watch-1"),
    });
    const { default: WatchlistsRoute } = await import("~/routes/app.watchlists");
    const markup = renderToStaticMarkup(createElement(WatchlistsRoute));

    expect(markup).toContain("http://evil.example/phish");
    expect(markup).not.toContain('href="http://evil.example/phish"');
    expect(markup).not.toContain('target="_blank"');
  });

  it("escapes watchlist and event text as markup-safe customer content", async () => {
    const hostileWatchlist = {
      ...watchlist,
      name: '<img src=x onerror="alert(1)">',
      targetLabel: "<script>alert(2)</script>",
    };
    const markup = await renderWatchlistsRoute({
      ...selectedPanelLoaderData,
      watchlists: [hostileWatchlist],
      selectedWatchlist: hostileWatchlist,
      events: recentEvents.map((event) => ({
        ...event,
        summary: "<b>untrusted event</b>",
      })),
    });

    expect(markup).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(markup).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
    expect(markup).toContain("&lt;b&gt;untrusted event&lt;/b&gt;");
    expect(markup).not.toContain("<img src=x");
    expect(markup).not.toContain("<script>alert(2)</script>");
  });

  // BL-007 (brief §6.4): the opened competitor is five URL-addressable
  // surfaces, not one scroll. Each assertion below now names the tab the
  // customer has to be on to see it.
  it("opens the competitor on the change feed with the tab bar and the fact rail", async () => {
    const markup = await renderWatchlistsRoute(selectedPanelLoaderData);

    // BL-035: `?watchlist=` is its own working surface. The old board + peek
    // + below-board BL-007 record stack is gone; the entity owns the header,
    // tabs follow immediately, and there is one content split.
    expect(markup).toContain("<h1 class=\"f9-wk-title\">Nykaa watch</h1>");
    expect(markup).toContain("All competitors");
    expect(markup).toContain('class="f9-watchdetail-detail"');
    expect(markup).not.toContain('aria-label="Competitors"');
    expect(markup).not.toContain("f9-wk-detail");
    expect(markup).not.toContain("f9-wk-record");
    expect(markup).not.toContain("f9-evidence-detail-head");
    expect(markup).not.toContain("f9-evidence-status-strip");

    // The tab bar is real navigation: five links, fixed order, the active one
    // marked with aria-current and not by ink alone (brief §10).
    expect(markup).toContain('aria-label="Competitor sections"');
    for (const [label, href] of [
      ["What changed", "/app/watchlists?watchlist=watch-1"],
      ["Evidence", "/app/watchlists?watchlist=watch-1&amp;tab=evidence"],
      ["Creative", "/app/watchlists?watchlist=watch-1&amp;tab=creative"],
      ["Delivery", "/app/watchlists?watchlist=watch-1&amp;tab=delivery"],
      ["Setup", "/app/watchlists?watchlist=watch-1&amp;tab=setup"],
    ]) {
      expect(markup).toContain(`href="${href}"`);
      expect(markup).toContain(label);
    }
    expect(markup).toMatch(
      /<a(?=[^>]*aria-current="page")(?=[^>]*class="f9-wk-tab is-on")(?=[^>]*href="\/app\/watchlists\?watchlist=watch-1")[^>]*><span>What changed<\/span><\/a>/,
    );

    // The change feed is the default panel.
    expect(markup).toContain("What changed");
    expect(markup).toContain("f9-evidence-diff-plate");
    expect(markup).toContain("High confidence");
    expect(markup).toContain("This is the stored capture, not a re-render.");
    expect(markup).toContain("Starting at ₹499");
    expect(markup).toContain("Starting at ₹799");
    expect(markup).not.toContain("Insight depth");
    expect(markup).not.toContain("Meta ads tracking beta");

    // The rail is exactly three objects (brief §7): number card, fact rail,
    // delivery card — and nothing from the other tabs leaks onto this one.
    expect(markup).toContain("f9-evidence-number-card");
    expect(markup).toContain("f9-evidence-fact-rail");
    expect(markup).toContain("Who gets told");
    expect(markup).toContain("Watching");
    expect(markup).not.toContain("Save watchlist");
    expect(markup).not.toContain("Recent evidence checks");
    expect(markup).not.toContain("Recent proof captures");
  });

  it("keeps Package for client available for a quiet completed Agency check", async () => {
    const markup = await renderWatchlistsRoute({
      ...selectedPanelLoaderData,
      plan: "agency",
      events: [],
    });

    expect(markup).toContain("Package for client");
    expect(markup).toContain(
      'href="/app/reports/watchlist:watch-1"',
    );
  });

  it.each([
    {
      plan: "free",
      share: false,
      export: false,
      report: false,
      primary: "Upgrade plan",
    },
    {
      plan: "scout",
      share: false,
      export: false,
      report: false,
      primary: "Upgrade plan",
    },
    {
      plan: "starter",
      share: true,
      export: true,
      report: false,
      primary: "Upgrade plan",
    },
    {
      plan: "agency",
      share: true,
      export: true,
      report: true,
      primary: "Refresh now",
    },
  ])(
    "re-proves the completed active $plan action contract",
    async ({ plan, share, export: canExport, report, primary }) => {
      const markup = await renderWatchlistsRoute(
        { ...selectedPanelLoaderData, plan },
        "evidence",
      );

      expect(markup.match(/class="f9-wk-btn"/g)).toHaveLength(1);
      expect(markup).toContain(`>${primary}</`);
      expect(markup.includes("Share summary")).toBe(share);
      expect(markup.includes("Export CSV")).toBe(canExport);
      expect(markup.includes("Export JSON")).toBe(canExport);
      expect(markup.includes("Package for client")).toBe(report);
      expect(markup).not.toContain("f9-evidence-detail-head");
      expect(markup).not.toContain("f9-evidence-status-strip");
    },
  );

  it.each([
    { plan: "free", hasLockedCapabilities: true },
    { plan: "scout", hasLockedCapabilities: true },
    { plan: "starter", hasLockedCapabilities: true },
    { plan: "agency", hasLockedCapabilities: false },
  ])(
    "makes resume the one Rank-1 action for a paused $plan competitor",
    async ({ plan, hasLockedCapabilities }) => {
      const paused = { ...watchlist, isActive: false };
      const markup = await renderWatchlistsRoute(
        {
          ...selectedPanelLoaderData,
          plan,
          watchlists: [paused],
          selectedWatchlist: paused,
        },
        "setup",
      );

      expect(markup.match(/class="f9-wk-btn"/g)).toHaveLength(1);
      expect(markup).toContain(">Resume watching</button>");
      expect(markup).toContain(
        "Watching is paused. The evidence already on file stays here.",
      );
      expect(markup.includes(">Upgrade plan</a>")).toBe(hasLockedCapabilities);
      expect(markup).not.toContain(">Refresh now</button>");
    },
  );

  it("keeps manual refresh for an active Agency competitor before its first successful scan", async () => {
    const firstScanWatchlist = { ...watchlist, lastScannedAt: null };
    const markup = await renderWatchlistsRoute(
      {
        ...selectedPanelLoaderData,
        plan: "agency",
        watchlists: [firstScanWatchlist],
        selectedWatchlist: firstScanWatchlist,
      },
    );

    expect(markup.match(/>Refresh now<\/button>/g)).toHaveLength(1);
    expect(markup).not.toContain(">Upgrade plan</a>");
  });

  it("shows the fetcher-backed resume pending state in the working header", async () => {
    const paused = { ...watchlist, isActive: false };
    const formData = new FormData();
    formData.set("intent", "resume-watchlist");
    formData.set("watchlistId", paused.id);
    const markup = await renderWatchlistsRoute(
      {
        ...selectedPanelLoaderData,
        plan: "agency",
        watchlists: [paused],
        selectedWatchlist: paused,
      },
      "setup",
      { state: "submitting", formData },
    );

    expect(markup).toMatch(
      /<button(?=[^>]*aria-busy="true")(?=[^>]*disabled)[^>]*>[\s\S]*?Resuming…<\/button>/,
    );
  });

  it("keeps repeated failures as page state and points to the Evidence section", async () => {
    const failedRuns = Array.from({ length: 3 }, (_, index) => ({
      ...recentRuns[0],
      id: `failed-${index}`,
      status: "failed" as const,
      finishedAt: `2026-04-18T0${8 - index}:01:00.000Z`,
      errorCode: "source_timeout",
      errorMessage: "private provider detail",
    }));
    const markup = await renderWatchlistsRoute({
      ...selectedPanelLoaderData,
      runs: failedRuns,
      captureWindow: {
        endDate: "2026-04-18",
        windowDays: 30,
        days: {},
        capturedChanges: {},
        totalCapturedChanges: 0,
        failedChecks: { "watch-1": 3 },
      },
    });

    expect(markup).toContain("the last 3 checks failed");
    expect(markup).toContain("recent errors are listed under Evidence");
    expect(markup).not.toContain("private provider detail");
  });

  it("keeps the entity detail coherent if the parallel board list misses its selected row", async () => {
    const markup = await renderWatchlistsRoute({
      ...selectedPanelLoaderData,
      watchlists: [],
    });

    expect(markup).toContain("<h1 class=\"f9-wk-title\">Nykaa watch</h1>");
    expect(markup).toContain("All competitors");
    expect(markup).toContain('aria-label="Competitor sections"');
    expect(markup).toContain('class="f9-watchdetail-detail"');
    expect(markup).not.toContain('aria-label="Competitors"');
  });

  it("keeps blocked source access actionable in the compressed working header", async () => {
    const markup = await renderWatchlistsRoute(
      {
        ...selectedPanelLoaderData,
        discoveryStatus: {
          status: "demo",
          provider: "meta_library_browser",
          mode: "demo",
          summary: "Live source access is unavailable.",
          lastCheckedAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      },
      "setup",
    );

    expect(markup).toContain('href="/app/source-access"');
    expect(markup).toContain("Needs source access");
    expect(markup).toContain(
      "Automatic checks are waiting for source access. The evidence already on file stays here.",
    );
    expect(markup).not.toContain("Automatic checks are on.");
    expect(markup.indexOf("Needs source access")).toBeLessThan(
      markup.indexOf('aria-label="Competitor sections"'),
    );
  });

  // Reconciled with BL-035: every honesty assertion from main's degraded test
  // is kept; the control assertions follow the controls to the tab that now
  // owns them (pause -> Setup, share/export -> Evidence).
  it("keeps the selected overview honest when recent capture totals are unavailable", async () => {
    const failedRuns = Array.from({ length: 3 }, (_, index) => ({
      ...recentRuns[0],
      id: `failed-run-${index + 1}`,
      status: "failed" as const,
      errorCode: "provider_unavailable",
      errorMessage: "Provider unavailable.",
    }));
    const degraded = {
      ...selectedPanelLoaderData,
      plan: "agency",
      captureWindowDegraded: true,
      runs: failedRuns,
    };
    const markup = await renderWatchlistsRoute(degraded);

    expect(markup).toContain("Nykaa watch");
    expect(markup).toContain("Unavailable — refresh to try again");
    expect(markup).toContain("Recent aggregate totals are unavailable");
    expect(markup).toContain("is-capture-window-degraded");
    expect(markup).toContain('id="competitor-detail"');
    expect(markup).toContain("Open the capture");
    expect(markup).toContain("Package for client");
    expect(markup).toContain("Refresh now");
    expect(markup).toContain("Delivery");
    expect(markup).toContain("Setup");
    expect(markup).toContain("the last 3 checks failed");
    // A failed rollup must never read as a believable zero.
    expect(markup).not.toContain("Checked, and nothing has changed in 30 days.");
    expect(markup).not.toContain('class="f9-evidence-number-value">0</p>');

    const setupMarkup = await renderWatchlistsRoute(degraded, "setup");
    expect(setupMarkup).toContain("Pause watching");
    expect(setupMarkup).toContain("Recent aggregate totals are unavailable");

    const evidenceMarkup = await renderWatchlistsRoute(degraded, "evidence");
    expect(evidenceMarkup).toContain("Share summary");
    expect(evidenceMarkup).toContain("Export CSV");
    expect(evidenceMarkup).toContain("Export JSON");
    expect(evidenceMarkup).toContain("Recent aggregate totals are unavailable");
  });

  it("keeps setup, its explainers and the source-access route behind the Setup tab", async () => {
    const markup = await renderWatchlistsRoute(selectedPanelLoaderData, "setup");

    expect(markup).toContain("Watchlist setup");
    expect(markup).toContain("Save watchlist");
    expect(markup).toContain("How tracking works");
    expect(markup).toContain("Live ad check");
    expect(markup).toContain("Check source access");
    // The change feed panel is not also rendered underneath it (tab label may still show).
    expect(markup).not.toContain('aria-label="What changed"');
    expect(markup).not.toContain("f9-evidence-diff-plate");
  });

  it("keeps evidence, freshness and the glossary behind the Evidence tab", async () => {
    const markup = await renderWatchlistsRoute(selectedPanelLoaderData, "evidence");

    expect(markup).toContain("Evidence and delivery");
    expect(markup).toContain("Recent proof captures");
    expect(markup).toContain("Last good check");
    expect(markup).toContain("1h ago");
    expect(markup).toContain("Evidence labels");
    expect(markup).toContain("f9-evidence-report-glossary");
    expect(markup).not.toContain("Insight depth");
    expect(markup).not.toContain("No evidence yet");
  });

  it("keeps delivery settings and recipient targets behind the Delivery tab", async () => {
    const markup = await renderWatchlistsRoute(selectedPanelLoaderData, "delivery");

    expect(markup).toContain("Delivery settings");
    expect(
      markup.match(/Delivery settings and recipient targets are managed by the workspace owner\./g),
    ).toHaveLength(1);
    expect(markup).toContain("Ask the workspace owner to add or change delivery targets.");
    expect(markup).not.toContain("Slack enabled");
    expect(markup).not.toContain("WhatsApp — not yet available");
    expect(markup).not.toContain("WhatsApp enabled");
  });

  it("renders cache-only discovery status", async () => {
    const cacheOnlyStatus = {
      status: "cache_only",
      provider: "meta_library_browser",
      mode: "cache",
      summary: "Browser Run with cached live results.",
      lastCheckedAt: "2026-04-18T10:06:00.000Z",
      lastErrorCode: null,
      lastErrorMessage: null,
    } as const;

    await mockRouter({
      actionData: undefined,
      // BL-007: the tracking headline and its summary live on the Setup tab.
      searchParams: new URLSearchParams("watchlist=watch-1&tab=setup"),
      loaderData: {
        renderedAt: "2026-04-18T10:59:50.000Z",
        plan: "starter",
        watchlists: [watchlist],
        selectedWatchlist: watchlist,
        eventCandidates: recentCandidates,
        events: recentEvents,
        runs: recentRuns,
        workspaceDeliveryConfig,
        watchlistDeliveryConfig,
        discoveryStatus: cacheOnlyStatus,
        effectiveDeliveryConfig: {
          sensitivityMode: "quiet",
          instantEnabled: true,
          digestEnabled: true,
  digestCadencePreference: "plan_default",
          emailEnabled: true,
          whatsappEnabled: true,
          slackEnabled: false,
          quietHours: {
            startHour: 22,
            endHour: 8,
          },
          timezone: "Asia/Kolkata",
        },
        deliveryTargets,
        workspaceDeliveryTargets: [],
        recentDeliveryAttempts,
        recentProofCaptures,
        proofSummary: {
          totalAttempts: 1,
          successfulAttempts: 1,
          failedAttempts: 0,
          skippedAttempts: 0,
          lastAttemptAt: "2026-04-18T09:59:50.000Z",
          lastSuccessfulProofAt: "2026-04-18T09:59:50.000Z",
        },
        creativeWall: [],
        trendDailyActivity: [],
      },
    });

    const { default: WatchlistsRoute } =
      await import("~/routes/app.watchlists");
    const markup = renderToStaticMarkup(createElement(WatchlistsRoute));

    expect(markup).toContain("Using recent competitor results");
    expect(markup).toContain("Recent results");
    expect(markup).not.toContain("Browser Run");
    expect(markup).not.toContain("cached live results");
  });

  it("uses calm shared customer copy when live ad checks are delayed", async () => {
    const degradedStatus = {
      status: "degraded",
      provider: "meta_library_browser",
      mode: "live",
      summary:
        "Commercial discovery degraded and no cached results are available.",
      lastCheckedAt: "2026-04-18T10:06:00.000Z",
      lastErrorCode: "browser_launch_failed",
      lastErrorMessage: "Browser process exited before startup.",
    } as const;

    await mockRouter({
      actionData: undefined,
      // BL-007: the tracking headline and its summary live on the Setup tab.
      searchParams: new URLSearchParams("watchlist=watch-1&tab=setup"),
      loaderData: {
        renderedAt: "2026-04-18T10:59:50.000Z",
        plan: "starter",
        watchlists: [watchlist],
        selectedWatchlist: watchlist,
        eventCandidates: recentCandidates,
        events: recentEvents,
        runs: recentRuns,
        workspaceDeliveryConfig,
        watchlistDeliveryConfig,
        discoveryStatus: degradedStatus,
        effectiveDeliveryConfig: {
          sensitivityMode: "quiet",
          instantEnabled: true,
          digestEnabled: true,
  digestCadencePreference: "plan_default",
          emailEnabled: true,
          whatsappEnabled: true,
          slackEnabled: false,
          quietHours: {
            startHour: 22,
            endHour: 8,
          },
          timezone: "Asia/Kolkata",
        },
        deliveryTargets,
        workspaceDeliveryTargets: [],
        recentDeliveryAttempts,
        recentProofCaptures,
        proofSummary: {
          totalAttempts: 1,
          successfulAttempts: 1,
          failedAttempts: 0,
          skippedAttempts: 0,
          lastAttemptAt: "2026-04-18T09:59:50.000Z",
          lastSuccessfulProofAt: "2026-04-18T09:59:50.000Z",
        },
        creativeWall: [],
        trendDailyActivity: [],
      },
    });

    const { default: WatchlistsRoute } =
      await import("~/routes/app.watchlists");
    const markup = renderToStaticMarkup(createElement(WatchlistsRoute));

    expect(markup).toContain("Live ad checks are temporarily delayed");
    expect(markup).toContain("results refresh as soon as checks recover");
    expect(markup).toContain("The visual ad check is temporarily delayed");
    expect(markup).not.toContain("Tracking path needs attention");
    expect(markup).not.toContain("The visual ad check could not start");
    expect(markup).not.toContain("Competitor ad checks degraded");
  });
});
