import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    onboardedAt: "2026-05-15T00:00:00.000Z",
  },
  session: {
    id: "session-1",
    userId: "user-1",
    expiresAt: "2026-05-16T00:00:00.000Z",
  },
};

function createContext(env = {}) {
  return {
    cloudflare: {
      env,
    },
  };
}

function createCounterMoveAudit(options: {
  id: string;
  targetLabel: string;
  workflowStatus: "needs_review" | "quiet";
  openCount: number;
  title?: string;
  expiresAt?: string | null;
  updatedAt: string;
}) {
  const expiresAt =
    "expiresAt" in options ? options.expiresAt : "2026-06-24T02:00:00.000Z";
  return {
    id: options.id,
    userId: "user-1",
    apiKeyId: "api-key-1",
    actionName: "counter_move_brief.create",
    resourceType: "watchlist",
    resourceId: options.id,
    idempotencyKey: options.id,
    status: "succeeded",
    result: {
      brief: {
        targetLabel: options.targetLabel,
        workflow: {
          ownerLabel: "Growth lead",
          channel: "client_room",
          status: options.workflowStatus,
          openCount: options.openCount,
          expiresAt,
          followUps:
            options.openCount > 0
              ? [
                  {
                    title: options.title ?? "Review counter-move",
                    status: "open",
                    ownerLabel: "Growth lead",
                    channel: "client_room",
                    expiresAt,
                  },
                ]
              : [],
        },
      },
    },
    errorCode: null,
    errorMessage: null,
    metadata: {},
    createdAt: options.updatedAt,
    updatedAt: options.updatedAt,
  };
}

async function mockRouter(loaderData: unknown) {
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
      useActionData: vi.fn().mockReturnValue(undefined),
      useLoaderData: vi.fn().mockReturnValue(loaderData),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
      useRevalidator: vi.fn().mockReturnValue({ revalidate: vi.fn() }),
    };
  });
}

function mockDashboardLoaderDependencies(
  options: {
    counterMoveAudits?: unknown[];
    watchlists?: unknown[];
    metaStatus?: Record<string, unknown>;
    recentWorkspaceEvents?: unknown[];
    failedSection?: "collections" | "recentProofCaptures";
    workspace?: {
      workspaceUserId?: string;
      isMember?: boolean;
      ownerName?: string | null;
    };
  } = {},
) {
  const liveKey = ["f9", "live", "dashboard"].join("_");
  const counterMoveAudits = options.counterMoveAudits ?? [];
  const listWatchlists = vi.fn().mockResolvedValue(options.watchlists ?? []);
  const listWatchEvents = vi.fn().mockResolvedValue([]);
  const listRecentWorkspaceWatchEvents = vi
    .fn()
    .mockResolvedValue(options.recentWorkspaceEvents ?? []);
  const getWorkspaceDeliveryConfig = vi
    .fn()
    .mockResolvedValue({ timezone: "Asia/Kolkata" });
  const workspace = {
    workspaceUserId: options.workspace?.workspaceUserId ?? session.user.id,
    isMember: options.workspace?.isMember ?? false,
    ownerName: options.workspace?.ownerName ?? null,
  };
  const getWorkspaceReadiness = vi.fn().mockResolvedValue({
    generatedAt: "2026-06-20T00:00:00.000Z",
    readyCount: 1,
    totalCount: 1,
    items: [],
    nextActions: [],
    nudges: [],
    counts: {
      agentMemoryEntries: 1,
    },
  });

  vi.doMock("~/lib/auth.server", () => ({
    requireWorkspaceSession: vi.fn(async () => ({
      session,
      ...workspace,
    })),
  }));
  vi.doMock("~/lib/ad-source.server", () => ({
    resolveCommercialAdSourceStatus: vi.fn().mockResolvedValue({
      status: options.metaStatus?.status ?? "healthy",
      summary: options.metaStatus?.summary ?? "Healthy",
      lastCheckedAt: null,
      ...options.metaStatus,
    }),
  }));
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn((context) => context.cloudflare.env),
  }));
  vi.doMock("~/lib/data.server", () => ({
    getSuccessfulProofCaptureStatsForUser: vi
      .fn()
      .mockResolvedValue({ count: 0, latestAt: null }),
    getSuccessfulRunStatsForUserBetween: vi
      .fn()
      .mockResolvedValue({ runs: 0, watchlistsChecked: 0, adsSeen: 0 }),
    getUserPlanBillingInfo: vi
      .fn()
      .mockResolvedValue({ plan: "free", dodoStatus: null }),
    listRecentAgentActionAudits: vi.fn(
      async (
        _env,
        _userId,
        query: { limit?: number; offset?: number } = {},
      ) => {
        const offset = query.offset ?? 0;
        return counterMoveAudits.slice(
          offset,
          offset + (query.limit ?? counterMoveAudits.length),
        );
      },
    ),
    listAgentMemory: vi.fn().mockResolvedValue([
      {
        id: "memory-1",
        userId: "user-1",
        scope: "workspace",
        key: liveKey,
        watchlistId: null,
        clientRoomId: null,
        value: { value: ["password", "hunter2"].join("=") },
        source: "owner_ui",
        createdAt: "2026-06-20T00:00:00.000Z",
        updatedAt: "2026-06-20T00:00:00.000Z",
      },
    ]),
    listCollections:
      options.failedSection === "collections"
        ? vi.fn().mockRejectedValue(new Error("private database detail"))
        : vi.fn().mockResolvedValue([]),
    listDeliveryTargets: vi.fn().mockResolvedValue([]),
    listDigests: vi.fn().mockResolvedValue([]),
    listRecentWorkspaceProofCaptures:
      options.failedSection === "recentProofCaptures"
        ? vi.fn().mockRejectedValue(new Error("private provider detail"))
        : vi.fn().mockResolvedValue([]),
    listRecentWorkspaceWatchEvents,
    getWorkspaceDeliveryConfig,
    listSavedQueries: vi.fn().mockResolvedValue([]),
    listWatchEvents,
    listWatchlists,
  }));
  vi.doMock("~/lib/plan.server", () => ({
    getProofUsageSummary: vi.fn().mockResolvedValue({
      warningLevel: "ok",
      used: 0,
      limit: 0,
      remaining: 0,
      plan: "free",
    }),
  }));
  vi.doMock("~/lib/workspace-readiness.server", () => ({
    getWorkspaceReadiness,
  }));
  vi.doMock("~/lib/workspace.server", () => ({
    listWorkspaceMembers: vi.fn().mockResolvedValue([]),
  }));

  return {
    getWorkspaceReadiness,
    listWatchEvents,
    listRecentWorkspaceWatchEvents,
    listWatchlists,
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
});

describe("dashboard route agent memory", () => {
  it("provides a complete fail-closed readiness fallback shape", async () => {
    const { unavailableWorkspaceReadiness } = await import("~/routes/app.dashboard");

    expect(
      unavailableWorkspaceReadiness({
        workspaceUserId: "owner-1",
        isMember: false,
        billingOwnerName: null,
      }),
    ).toMatchObject({
      status: "attention",
      value: {
        hasFirstValue: false,
        hasRecurringPaidCadence: false,
        hasRetainedReadiness: false,
      },
      counts: {
        completedScans: 0,
        noChangeBaselines: 0,
      },
    });
  });

  it("does not expose agent memory on the customer overview", async () => {
    const deps = mockDashboardLoaderDependencies();

    const { loader } = await import("~/routes/app.dashboard");
    const loaderData = await loader({
      context: createContext(),
      request: new Request("http://localhost/app"),
    } as never);

    expect(deps.listWatchlists).toHaveBeenCalledWith(
      expect.anything(),
      session.user.id,
      { includeInactive: true },
    );
    expect(loaderData).not.toHaveProperty("agentMemories");
    expect(JSON.stringify(loaderData)).not.toContain("hunter2");

    vi.resetModules();
    await mockRouter(loaderData);
    const { default: AppDashboardRoute } =
      await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    // WP-C2 Beat 1: empty free workspace leads with the Wire hero + spine.
    expect(markup).toContain("THE 5·9 WIRE · NOTHING FILED YET");
    expect(markup).toContain("Name one competitor.");
    // First-run hero has one dominant add path: the search form.
    expect(markup).toContain("Assign the beat →");
    expect(markup).toContain(
      "Free includes one watchlist — activation scan, weekly check, weekly email brief.",
    );
    expect(markup).not.toContain("Account context saved");
    expect(markup).not.toContain("[redacted]: [redacted]");
    expect(markup).not.toContain("hunter2");
    expect(markup).not.toContain(["f9", "live", "dashboard"].join("_"));
    expect(markup).not.toContain("password=");
  });

  it("does not load dashboard events for paused competitors", async () => {
    const deps = mockDashboardLoaderDependencies({
      watchlists: [
        {
          id: "paused-watchlist",
          name: "Nykaa watch",
          targetType: "advertiser",
          targetLabel: "Nykaa",
          isActive: false,
          lastScannedAt: "2026-06-20T08:00:00.000Z",
        },
      ],
    });

    const { loader } = await import("~/routes/app.dashboard");
    const loaderData = await loader({
      context: createContext(),
      request: new Request("http://localhost/app"),
    } as never);

    expect(deps.listWatchEvents).not.toHaveBeenCalled();
    expect(loaderData.recentEvents).toEqual([]);
  });

  it("loads recent events once across every active watchlist", async () => {
    const recentWorkspaceEvents = Array.from({ length: 8 }, (_, index) => ({
      id: `event-${index}`,
      watchlistId: `watch-${index}`,
      title: `Move ${index}`,
      summary: "A source-backed change.",
      eventType: "ad_new",
      status: "confirmed",
      createdAt: `2026-06-20T00:0${index}:00.000Z`,
    }));
    const deps = mockDashboardLoaderDependencies({
      watchlists: Array.from({ length: 8 }, (_, index) => ({
        id: `watch-${index}`,
        name: `Watch ${index}`,
        targetType: "advertiser",
        targetLabel: `Brand ${index}`,
        isActive: true,
        lastScannedAt: "2026-06-20T08:00:00.000Z",
      })),
      recentWorkspaceEvents,
    });

    const { loader } = await import("~/routes/app.dashboard");
    const loaderData = await loader({
      context: createContext(),
      request: new Request("http://localhost/app"),
    } as never);

    expect(deps.listRecentWorkspaceWatchEvents).toHaveBeenCalledTimes(1);
    expect(loaderData.recentEvents).toEqual(recentWorkspaceEvents);
  });

  it("keeps the dashboard usable when a non-critical section fails", async () => {
    mockDashboardLoaderDependencies({ failedSection: "collections" });

    const { loader } = await import("~/routes/app.dashboard");
    const loaderData = await loader({
      context: createContext(),
      request: new Request("http://localhost/app"),
    } as never);

    expect(loaderData.collections).toEqual([]);
    expect(loaderData.watchlists).toEqual([]);
    expect(loaderData.sectionWarnings).toEqual([
      {
        section: "collections",
        message: "We couldn't load this section.",
      },
    ]);
    expect(JSON.stringify(loaderData)).not.toContain("private database detail");
  });

  it.each([
    [
      "degraded",
      "Live ad checks are temporarily delayed. We'll retry automatically — results refresh as soon as checks recover.",
    ],
    [
      "disabled",
      "Live ad checks are unavailable right now. Review source access before relying on fresh results.",
    ],
  ])(
    "surfaces %s source status with a recovery link",
    async (status, summary) => {
      const data = {
        savedQueries: [],
        collections: [],
        watchlists: [],
        digests: [],
        recentEvents: [],
        recentProofCaptures: [],
        deliveryTargets: [],
        metaStatus: { status, summary, lastCheckedAt: null },
        proofUsage: {
          warningLevel: "ok",
          used: 0,
          limit: 0,
          remaining: 0,
          plan: "free",
        },
        overnightStats: { runs: 0, watchlistsChecked: 0, adsSeen: 0 },
        successfulProofStats: { count: 0, latestAt: null },
        workspaceReadiness: {
          readyCount: 0,
          totalCount: 0,
          items: [],
          nudges: [],
        },
        counterMoveFollowUps: [],
        plan: "free",
        teamMemberCount: 1,
        nextScanLabel:
          "Activation scan only — paid plans include recurring monitoring.",
        hasPaymentIssue: false,
        checkoutReturn: false,
      };
      await mockRouter(data);
      const { default: AppDashboardRoute } =
        await import("~/routes/app.dashboard");
      const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

      expect(markup).toContain(
        status === "disabled"
          ? "Live ad checks are unavailable right now"
          : "Live ad checks are temporarily delayed",
      );
      expect(markup).toContain(
        status === "disabled"
          ? "Source unavailable"
          : "Source access needs attention",
      );
      expect(markup).toContain('href="/app/source-access"');
      expect(markup).not.toContain("Live source ready");
    },
  );

  it("describes payment interruption without inventing provider retry behavior", async () => {
    await mockRouter({
      savedQueries: [],
      collections: [],
      watchlists: [],
      digests: [],
      recentEvents: [],
      recentProofCaptures: [],
      deliveryTargets: [],
      metaStatus: { status: "healthy", summary: "Healthy", lastCheckedAt: null },
      proofUsage: { warningLevel: "ok", used: 0, limit: 100, remaining: 100, plan: "starter" },
      overnightStats: { runs: 0, watchlistsChecked: 0, adsSeen: 0 },
      successfulProofStats: { count: 0, latestAt: null },
      workspaceReadiness: { readyCount: 0, totalCount: 0, items: [], nudges: [] },
      counterMoveFollowUps: [],
      plan: "starter",
      teamMemberCount: 0,
      nextScanLabel: "Next weekly check",
      hasPaymentIssue: true,
      checkoutReturn: false,
    });
    const { default: AppDashboardRoute } = await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("Billing reported a payment issue");
    expect(markup).not.toContain("provider retries");
    expect(markup).not.toContain("Dodo is retrying");
  });

  it("passes workspace member billing context into readiness", async () => {
    const deps = mockDashboardLoaderDependencies({
      workspace: {
        workspaceUserId: "owner-1",
        isMember: true,
        ownerName: "Agency Owner",
      },
    });

    const { loader } = await import("~/routes/app.dashboard");
    await loader({
      context: createContext(),
      request: new Request("http://localhost/app"),
    } as never);

    expect(deps.getWorkspaceReadiness).toHaveBeenCalledWith(
      expect.anything(),
      "owner-1",
      {
        isMember: true,
        billingOwnerName: "Agency Owner",
        canManageBilling: false,
      },
    );
  });

  it("renders the Beat 2 Wire hero when a first competitor's scan is in flight", async () => {
    mockDashboardLoaderDependencies({
      watchlists: [
        {
          id: "watch-boat",
          name: "Boat watch",
          targetType: "advertiser",
          targetLabel: "Boat Lifestyle",
          isActive: true,
          lastScannedAt: null,
        },
      ],
    });

    const { loader } = await import("~/routes/app.dashboard");
    const loaderData = await loader({
      context: createContext(),
      request: new Request("http://localhost/app"),
    } as never);

    vi.resetModules();
    await mockRouter(loaderData);
    const { default: AppDashboardRoute } =
      await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    // WP-C2 Beat 2: competitor added, first scan in flight — spine node 2 now.
    expect(markup).toContain("THE 5·9 WIRE · BEAT ASSIGNED");
    expect(markup).toContain("on the wire.");
    expect(markup).toContain("We’re covering Boat Lifestyle.");
    expect(markup).toContain("Boat Lifestyle");
    // Honesty: the scan is queued, not confirmed running — no "running now"
    // claim, and the mirror feed shows Queued (not Reading now).
    expect(markup).toContain("The first scan is underway");
    expect(markup).not.toContain("The first scan is running now");
    // Spine advanced: node 1 done, node 2 now.
    expect(markup).toContain('data-status="done"');
    expect(markup).toContain('data-fill="gradient"');
    // Overview mirror shows the honesty-gated ON-THE-WIRE feed.
    expect(markup).toContain("ON THE WIRE");
    // P5 capacity truth: free is a one-watchlist plan and is already at its
    // limit, so the queue-more card is the upgrade affordance, not an add form
    // that would be rejected.
    expect(markup).toContain("Watch more competitors");
    expect(markup).toContain("View plans");
    expect(markup).not.toContain("Add another");
    expect(markup).not.toContain("Activation scan is queued");
  });

  it("surfaces safe counter-move follow-ups from agent action audits", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-20T00:00:00.000Z"));

    mockDashboardLoaderDependencies({
      counterMoveAudits: [
        {
          id: "audit-counter-move-1",
          userId: "user-1",
          apiKeyId: "api-key-1",
          actionName: "counter_move_brief.create",
          resourceType: "watchlist",
          resourceId: "watchlist-1",
          idempotencyKey: "brief-1",
          status: "succeeded",
          result: {
            brief: {
              targetLabel: "Nykaa",
              workflow: {
                ownerLabel: "Growth lead",
                channel: "client_room",
                status: "needs_review",
                openCount: 1,
                expiresAt: "2026-06-24T02:00:00.000Z",
                followUps: [
                  {
                    title: "Review pricing move",
                    status: "open",
                    ownerLabel: "Growth lead",
                    channel: "client_room",
                    expiresAt: "2026-06-24T02:00:00.000Z",
                  },
                ],
              },
            },
          },
          errorCode: null,
          errorMessage: null,
          metadata: {},
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:01:00.000Z",
        },
        {
          id: "audit-legacy-brief",
          userId: "user-1",
          apiKeyId: "api-key-1",
          actionName: "counter_move_brief.create",
          resourceType: "watchlist",
          resourceId: "watchlist-1",
          idempotencyKey: "brief-legacy",
          status: "succeeded",
          result: {
            brief: {
              targetLabel: "Legacy",
              summary: "Legacy payload without workflow metadata",
            },
          },
          errorCode: null,
          errorMessage: null,
          metadata: {},
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:01:00.000Z",
        },
        {
          id: "audit-quiet-brief",
          userId: "user-1",
          apiKeyId: "api-key-1",
          actionName: "counter_move_brief.create",
          resourceType: "watchlist",
          resourceId: "watchlist-quiet",
          idempotencyKey: "brief-quiet",
          status: "succeeded",
          result: {
            brief: {
              targetLabel: "Quiet",
              summary: "No proof-backed moves are ready.",
              workflow: {
                ownerLabel: "Growth lead",
                channel: "app",
                status: "quiet",
                openCount: 0,
                expiresAt: "2026-06-24T02:00:00.000Z",
                followUps: [],
              },
            },
          },
          errorCode: null,
          errorMessage: null,
          metadata: {},
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:01:00.000Z",
        },
        {
          id: "audit-closed-brief",
          userId: "user-1",
          apiKeyId: "api-key-1",
          actionName: "counter_move_brief.create",
          resourceType: "watchlist",
          resourceId: "watchlist-closed",
          idempotencyKey: "brief-closed",
          status: "succeeded",
          result: {
            brief: {
              targetLabel: "Closed",
              workflow: {
                ownerLabel: "Growth lead",
                channel: "app",
                status: "needs_review",
                openCount: 0,
                expiresAt: "2026-06-24T02:00:00.000Z",
                followUps: [
                  {
                    title: "Closed follow-up",
                    status: "closed",
                    expiresAt: "2026-06-24T02:00:00.000Z",
                  },
                ],
              },
            },
          },
          errorCode: null,
          errorMessage: null,
          metadata: {},
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:01:00.000Z",
        },
        {
          id: "audit-expired-brief",
          userId: "user-1",
          apiKeyId: "api-key-1",
          actionName: "counter_move_brief.create",
          resourceType: "watchlist",
          resourceId: "watchlist-expired",
          idempotencyKey: "brief-expired",
          status: "succeeded",
          result: {
            brief: {
              targetLabel: "Expired",
              workflow: {
                ownerLabel: "Growth lead",
                channel: "app",
                status: "needs_review",
                openCount: 1,
                expiresAt: "2026-06-19T02:00:00.000Z",
                followUps: [
                  {
                    title: "Expired move",
                    status: "open",
                    expiresAt: "2026-06-19T02:00:00.000Z",
                  },
                ],
              },
            },
          },
          errorCode: null,
          errorMessage: null,
          metadata: {},
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:01:00.000Z",
        },
      ],
    });

    const { loader } = await import("~/routes/app.dashboard");
    const loaderData = await loader({
      context: createContext(),
      request: new Request("http://localhost/app"),
    } as never);

    expect(loaderData.counterMoveFollowUps).toHaveLength(1);
    expect(loaderData.counterMoveFollowUps[0]).toMatchObject({
      title: "Review pricing move",
      ownerLabel: "Growth lead",
      channelLabel: "Client room",
      status: "needs_review",
      openCount: 1,
    });

    vi.resetModules();
    await mockRouter(loaderData);
    const { default: AppDashboardRoute } =
      await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("Responses waiting on you");
    expect(markup).toContain("Review pricing move");
    expect(markup).toContain("Growth lead");
    expect(markup).toContain("Client room");
    expect(markup).not.toContain("Legacy payload");
    expect(markup).not.toContain("No proof-backed moves are ready");
    expect(markup).not.toContain("Closed follow-up");
    expect(markup).not.toContain("Expired move");
  });

  it("redacts secret-like counter-move follow-up audit text before rendering", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-20T00:00:00.000Z"));
    const liveKey = ["f9", "live", "countermove"].join("_");
    const slackHook = "https://hooks.slack.com/services/T/B/C";

    mockDashboardLoaderDependencies({
      counterMoveAudits: [
        {
          id: "audit-secret-brief",
          userId: "user-1",
          apiKeyId: "api-key-1",
          actionName: "counter_move_brief.create",
          resourceType: "watchlist",
          resourceId: "watchlist-1",
          idempotencyKey: "brief-secret",
          status: "succeeded",
          result: {
            brief: {
              targetLabel: liveKey,
              workflow: {
                ownerLabel: slackHook,
                channel: "client_room",
                status: "needs_review",
                openCount: 1,
                expiresAt: "2026-06-24T02:00:00.000Z",
                followUps: [
                  {
                    title: "bearer abcdefghijklmnop",
                    status: "open",
                    ownerLabel: slackHook,
                    channel: "client_room",
                    expiresAt: "2026-06-24T02:00:00.000Z",
                  },
                ],
              },
            },
          },
          errorCode: null,
          errorMessage: null,
          metadata: {},
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:01:00.000Z",
        },
      ],
    });

    const { loader } = await import("~/routes/app.dashboard");
    const loaderData = await loader({
      context: createContext(),
      request: new Request("http://localhost/app"),
    } as never);

    expect(JSON.stringify(loaderData)).not.toContain(liveKey);
    expect(JSON.stringify(loaderData)).not.toContain(slackHook);
    expect(JSON.stringify(loaderData)).not.toContain("bearer abcdefghijklmnop");
    expect(loaderData.counterMoveFollowUps[0]).toMatchObject({
      title: "Competitive response follow-up",
      ownerLabel: "Account owner",
      channelLabel: "Client room",
    });

    vi.resetModules();
    await mockRouter(loaderData);
    const { default: AppDashboardRoute } =
      await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("Account owner");
    expect(markup).toContain("Client room");
    expect(markup).not.toContain(liveKey);
    expect(markup).not.toContain(slackHook);
    expect(markup).not.toContain("bearer abcdefghijklmnop");
  });

  it("paginates past newer quiet briefs to keep open counter-move follow-ups visible", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-20T00:00:00.000Z"));

    mockDashboardLoaderDependencies({
      counterMoveAudits: [
        ...Array.from({ length: 30 }, (_, index) =>
          createCounterMoveAudit({
            id: `audit-quiet-${index}`,
            targetLabel: `Quiet ${index}`,
            workflowStatus: "quiet",
            openCount: 0,
            updatedAt: `2026-06-20T00:${String(index).padStart(2, "0")}:00.000Z`,
          }),
        ),
        createCounterMoveAudit({
          id: "audit-open-older",
          targetLabel: "Nykaa",
          workflowStatus: "needs_review",
          openCount: 1,
          title: "Older pricing proof needs review",
          updatedAt: "2026-06-20T00:01:00.000Z",
        }),
      ],
    });

    const { loader } = await import("~/routes/app.dashboard");
    const loaderData = await loader({
      context: createContext(),
      request: new Request("http://localhost/app"),
    } as never);
    const dataServer = await import("~/lib/data.server");

    expect(loaderData.counterMoveFollowUps).toHaveLength(1);
    expect(loaderData.counterMoveFollowUps[0]).toMatchObject({
      id: "audit-open-older",
      title: "Older pricing proof needs review",
      openCount: 1,
    });
    expect(dataServer.listRecentAgentActionAudits).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({ limit: 30, offset: 0 }),
    );
    expect(dataServer.listRecentAgentActionAudits).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({ limit: 30, offset: 30 }),
    );
  });

  it("keeps stale audit-backed counter-move follow-ups until their embedded expiry closes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-20T00:00:00.000Z"));

    mockDashboardLoaderDependencies({
      counterMoveAudits: [
        createCounterMoveAudit({
          id: "audit-open-stale",
          targetLabel: "Nykaa",
          workflowStatus: "needs_review",
          openCount: 1,
          title: "Old pricing proof needs review",
          updatedAt: "2026-06-12T23:59:00.000Z",
        }),
      ],
    });

    const { loader } = await import("~/routes/app.dashboard");
    const loaderData = await loader({
      context: createContext(),
      request: new Request("http://localhost/app"),
    } as never);

    expect(loaderData.counterMoveFollowUps).toHaveLength(1);
    expect(loaderData.counterMoveFollowUps[0]).toMatchObject({
      id: "audit-open-stale",
      title: "Old pricing proof needs review",
    });
  });

  it("hides stale audit-backed counter-move follow-ups when no valid expiry exists", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-20T00:00:00.000Z"));

    mockDashboardLoaderDependencies({
      counterMoveAudits: [
        createCounterMoveAudit({
          id: "audit-open-stale-without-expiry",
          targetLabel: "Nykaa",
          workflowStatus: "needs_review",
          openCount: 1,
          title: "Old pricing proof needs review",
          expiresAt: null,
          updatedAt: "2026-06-12T23:59:00.000Z",
        }),
      ],
    });

    const { loader } = await import("~/routes/app.dashboard");
    const loaderData = await loader({
      context: createContext(),
      request: new Request("http://localhost/app"),
    } as never);

    expect(loaderData.counterMoveFollowUps).toEqual([]);
  });
});
