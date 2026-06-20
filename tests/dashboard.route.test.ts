import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

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
  updatedAt: string;
}) {
  const expiresAt = "2026-06-24T02:00:00.000Z";
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
          followUps: options.openCount > 0
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
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useActionData: vi.fn().mockReturnValue(undefined),
      useLoaderData: vi.fn().mockReturnValue(loaderData),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
      useRevalidator: vi.fn().mockReturnValue({ revalidate: vi.fn() }),
    };
  });
}

function mockDashboardLoaderDependencies(options: { counterMoveAudits?: unknown[] } = {}) {
  const liveKey = ["f9", "live", "dashboard"].join("_");
  const counterMoveAudits = options.counterMoveAudits ?? [];

  vi.doMock("~/lib/auth.server", () => ({
    requireWorkspaceSession: vi.fn(async () => ({
      session,
      workspaceUserId: session.user.id,
      isMember: false,
      ownerName: null,
    })),
  }));
  vi.doMock("~/lib/ad-source.server", () => ({
    resolveCommercialAdSourceStatus: vi.fn().mockResolvedValue({
      status: "healthy",
      summary: "Healthy",
      lastCheckedAt: null,
    }),
  }));
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn((context) => context.cloudflare.env),
  }));
  vi.doMock("~/lib/data.server", () => ({
    getCustomerMetaConnection: vi.fn().mockResolvedValue(null),
    getSuccessfulProofCaptureStatsForUser: vi.fn().mockResolvedValue({ count: 0, latestAt: null }),
    getSuccessfulRunStatsForUserBetween: vi.fn().mockResolvedValue({ runs: 0, watchlistsChecked: 0, adsSeen: 0 }),
    getUserPlanBillingInfo: vi.fn().mockResolvedValue({ plan: "free", dodoStatus: null }),
    listRecentAgentActionAudits: vi.fn(async (_env, _userId, query: { limit?: number } = {}) =>
      counterMoveAudits.slice(0, query.limit ?? counterMoveAudits.length),
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
    listCollections: vi.fn().mockResolvedValue([]),
    listDeliveryTargets: vi.fn().mockResolvedValue([]),
    listDigests: vi.fn().mockResolvedValue([]),
    listRecentWorkspaceProofCaptures: vi.fn().mockResolvedValue([]),
    listSavedQueries: vi.fn().mockResolvedValue([]),
    listWatchEvents: vi.fn().mockResolvedValue([]),
    listWatchlists: vi.fn().mockResolvedValue([]),
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
    getWorkspaceReadiness: vi.fn().mockResolvedValue({
      generatedAt: "2026-06-20T00:00:00.000Z",
      readyCount: 1,
      totalCount: 1,
      items: [],
      nextActions: [],
      nudges: [],
      counts: {
        agentMemoryEntries: 1,
      },
    }),
  }));
  vi.doMock("~/lib/workspace.server", () => ({
    listWorkspaceMembers: vi.fn().mockResolvedValue([]),
  }));
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
  it("redacts legacy secret-looking memory in loader data and rendered previews", async () => {
    mockDashboardLoaderDependencies();

    const { loader } = await import("~/routes/app.dashboard");
    const loaderData = await loader({
      context: createContext(),
      request: new Request("http://localhost/app"),
    } as never);

    expect(JSON.stringify(loaderData)).not.toContain("hunter2");
    expect(JSON.stringify(loaderData)).not.toContain(["f9", "live", "dashboard"].join("_"));
    expect(loaderData.agentMemories[0]).toMatchObject({
      key: "[redacted]",
      preview: "[redacted]",
    });

    vi.resetModules();
    await mockRouter(loaderData);
    const { default: AppDashboardRoute } = await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("Agent memory ready");
    expect(markup).toContain("[redacted]: [redacted]");
    expect(markup).toContain("Counter-move follow-ups");
    expect(markup).toContain("/app/clients");
    expect(markup).not.toContain("hunter2");
    expect(markup).not.toContain(["f9", "live", "dashboard"].join("_"));
    expect(markup).not.toContain("password=");
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
    const { default: AppDashboardRoute } = await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("Counter-move follow-ups");
    expect(markup).toContain("Review pricing move");
    expect(markup).toContain("Growth lead");
    expect(markup).toContain("Client room");
    expect(markup).not.toContain("Legacy payload");
    expect(markup).not.toContain("No proof-backed moves are ready");
    expect(markup).not.toContain("Closed follow-up");
    expect(markup).not.toContain("Expired move");
  });

  it("keeps open counter-move follow-ups visible behind newer quiet briefs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-20T00:00:00.000Z"));

    mockDashboardLoaderDependencies({
      counterMoveAudits: [
        createCounterMoveAudit({
          id: "audit-quiet-1",
          targetLabel: "Quiet 1",
          workflowStatus: "quiet",
          openCount: 0,
          updatedAt: "2026-06-20T00:04:00.000Z",
        }),
        createCounterMoveAudit({
          id: "audit-quiet-2",
          targetLabel: "Quiet 2",
          workflowStatus: "quiet",
          openCount: 0,
          updatedAt: "2026-06-20T00:03:00.000Z",
        }),
        createCounterMoveAudit({
          id: "audit-quiet-3",
          targetLabel: "Quiet 3",
          workflowStatus: "quiet",
          openCount: 0,
          updatedAt: "2026-06-20T00:02:00.000Z",
        }),
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

    expect(loaderData.counterMoveFollowUps).toHaveLength(1);
    expect(loaderData.counterMoveFollowUps[0]).toMatchObject({
      id: "audit-open-older",
      title: "Older pricing proof needs review",
      openCount: 1,
    });
  });
});
