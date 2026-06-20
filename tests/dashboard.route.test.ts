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

function mockDashboardLoaderDependencies() {
  const liveKey = ["f9", "live", "dashboard"].join("_");

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
    expect(markup).toContain("/app/clients");
    expect(markup).not.toContain("hunter2");
    expect(markup).not.toContain(["f9", "live", "dashboard"].join("_"));
    expect(markup).not.toContain("password=");
  });
});
