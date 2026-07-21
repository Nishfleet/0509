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

async function mockRouter(loaderData: unknown, actionData?: unknown) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useActionData: vi.fn().mockReturnValue(actionData),
      useLoaderData: vi.fn().mockReturnValue(loaderData),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
    };
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

function mockAuth(plan: "free" | "scout" | "starter" | "agency" = "agency") {
  vi.doMock("~/lib/auth.server", () => ({
    requireWorkspaceSession: vi.fn(async () => ({
      session,
      workspaceUserId: session.user.id,
      isMember: false,
      ownerName: null,
    })),
  }));
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn((context) => context.cloudflare.env),
  }));
  vi.doMock("~/lib/plan.server", () => ({
    getUserPlan: vi.fn(async () => plan),
  }));
}

describe("clients route agent memory", () => {
  it("saves owner-created operating memory through existing account storage", async () => {
    mockAuth();
    const upsertAgentMemory = vi.fn().mockResolvedValue({
      id: "memory-1",
    });
    vi.doMock("~/lib/data.server", () => ({
      getClientRoom: vi.fn().mockResolvedValue({ id: "room-1", name: "Nykaa weekly desk" }),
      getCollection: vi.fn(),
      getWatchlist: vi.fn(),
      upsertAgentMemory,
      upsertClientRoom: vi.fn(),
    }));

    const { action } = await import("~/routes/app.clients");
    const formData = new FormData();
    formData.set("intent", "upsert-agent-memory");
    formData.set("key", "review_cadence");
    formData.set("scope", "customer");
    formData.set("clientRoomId", "room-1");
    formData.set("value", "Weekly client-ready review with direct tone.");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/clients", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({ ok: true, message: "Context saved." });
    expect(upsertAgentMemory).toHaveBeenCalledWith({}, "user-1", {
      scope: "customer",
      key: "review_cadence",
      clientRoomId: "room-1",
      value: { value: "Weekly client-ready review with direct tone." },
      source: "owner_ui",
    });
  });

  it("rejects secret-like operating memory before persistence", async () => {
    mockAuth();
    const upsertAgentMemory = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      getClientRoom: vi.fn(),
      getCollection: vi.fn(),
      getWatchlist: vi.fn(),
      upsertAgentMemory,
      upsertClientRoom: vi.fn(),
    }));

    const { action } = await import("~/routes/app.clients");
    const formData = new FormData();
    formData.set("intent", "upsert-agent-memory");
    formData.set("key", "review_cadence");
    formData.set("scope", "workspace");
    formData.set("value", "https://hooks.slack.com/services/T/B/C");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/clients", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({ ok: false, message: "Memory values cannot contain secrets or credentials." });
    expect(upsertAgentMemory).not.toHaveBeenCalled();
  });

  it("rejects secret-like client-room text before persistence", async () => {
    mockAuth();
    const upsertClientRoom = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      getClientRoom: vi.fn(),
      getCollection: vi.fn(),
      getWatchlist: vi.fn(),
      upsertAgentMemory: vi.fn(),
      upsertClientRoom,
    }));

    const { action } = await import("~/routes/app.clients");
    const formData = new FormData();
    formData.set("intent", "upsert-client-room");
    formData.set("name", "Beauty client");
    formData.set("clientLabel", "https://hooks.slack.com/services/T/B/C");
    formData.set("goal", "Weekly client-ready review.");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/clients", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({ ok: false, message: "Client label cannot contain secrets or credentials." });
    expect(upsertClientRoom).not.toHaveBeenCalled();
  });

  it("allows ordinary client-room display text that contains security-adjacent words", async () => {
    mockAuth();
    const upsertClientRoom = vi.fn().mockResolvedValue({
      id: "room-1",
      userId: "user-1",
      name: "Token Metrics",
      clientLabel: "Secret Sales",
      status: "active",
      notes: {
        goal: "Webhook QA review.",
      },
      resourceRefs: [],
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
    });
    vi.doMock("~/lib/data.server", () => ({
      getClientRoom: vi.fn(),
      getCollection: vi.fn(),
      getWatchlist: vi.fn(),
      upsertAgentMemory: vi.fn(),
      upsertClientRoom,
    }));

    const { action } = await import("~/routes/app.clients");
    const formData = new FormData();
    formData.set("intent", "upsert-client-room");
    formData.set("name", "Token Metrics");
    formData.set("clientLabel", "Secret Sales");
    formData.set("goal", "Webhook QA review.");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/clients", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toMatchObject({ ok: true });
    expect(upsertClientRoom).toHaveBeenCalledWith(expect.anything(), "user-1", expect.objectContaining({
      name: "Token Metrics",
      clientLabel: "Secret Sales",
      notes: expect.objectContaining({
        goal: "Webhook QA review.",
      }),
    }));
  });

  it("does not save client-room memory when the room is not owned by the workspace", async () => {
    mockAuth();
    const upsertAgentMemory = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      getClientRoom: vi.fn().mockResolvedValue(null),
      getCollection: vi.fn(),
      getWatchlist: vi.fn(),
      upsertAgentMemory,
      upsertClientRoom: vi.fn(),
    }));

    const { action } = await import("~/routes/app.clients");
    const formData = new FormData();
    formData.set("intent", "upsert-agent-memory");
    formData.set("key", "review_cadence");
    formData.set("scope", "customer");
    formData.set("clientRoomId", "room-from-another-workspace");
    formData.set("value", "Weekly client-ready review with direct tone.");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/clients", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({ ok: false, message: "Client room not found." });
    expect(upsertAgentMemory).not.toHaveBeenCalled();
  });

  it("returns summarized memory instead of raw values from the loader", async () => {
    mockAuth();
    vi.doMock("~/lib/data.server", () => ({
      listAgentMemory: vi.fn().mockResolvedValue([
        {
          id: "memory-1",
          userId: "user-1",
          scope: "workspace",
          key: "slack-note",
          watchlistId: null,
          clientRoomId: null,
          value: { value: "https://hooks.slack.com/services/T/B/C" },
          source: "owner_ui",
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      ]),
      listAgentMemoryForClientRooms: vi.fn().mockResolvedValue([]),
      listClientRooms: vi.fn().mockResolvedValue([]),
      listCollections: vi.fn().mockResolvedValue([]),
      listWatchlists: vi.fn().mockResolvedValue([]),
    }));

    const { loader } = await import("~/routes/app.clients");
    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app/clients"),
    } as never);

    expect(JSON.stringify(result)).not.toContain("hooks.slack.com");
    expect(result).toMatchObject({ plan: "agency", canManageClientRooms: true });
    expect(result.memories[0]).toMatchObject({
      key: "slack-note",
      preview: "[redacted]",
    });
  });

  it("loads room-scoped memory for displayed client rooms beyond the recent workspace list", async () => {
    mockAuth();
    const listAgentMemory = vi.fn().mockResolvedValue([]);
    const listAgentMemoryForClientRooms = vi.fn().mockResolvedValue([
      {
        id: "memory-room-1",
        userId: "user-1",
        scope: "customer",
        key: "client_review_tone",
        watchlistId: null,
        clientRoomId: "room-1",
        value: { value: "Direct weekly review with evidence links." },
        source: "owner_ui",
        createdAt: "2026-06-20T00:00:00.000Z",
        updatedAt: "2026-06-20T00:00:00.000Z",
      },
    ]);
    vi.doMock("~/lib/data.server", () => ({
      listAgentMemory,
      listAgentMemoryForClientRooms,
      listClientRooms: vi.fn().mockResolvedValue([
        {
          id: "room-1",
          userId: "user-1",
          name: "Nykaa weekly desk",
          clientLabel: "Nykaa",
          status: "active",
          notes: {},
          resourceRefs: [],
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      ]),
      listCollections: vi.fn().mockResolvedValue([]),
      listWatchlists: vi.fn().mockResolvedValue([]),
    }));

    const { loader } = await import("~/routes/app.clients");
    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app/clients"),
    } as never);

    expect(listAgentMemory).toHaveBeenCalledWith({}, "user-1", { limit: 20 });
    expect(listAgentMemoryForClientRooms).toHaveBeenCalledWith({}, "user-1", ["room-1"], { limitPerRoom: 20 });
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]).toMatchObject({
      id: "memory-room-1",
      key: "client_review_tone",
      clientRoomId: "room-1",
      preview: "Direct weekly review with evidence links.",
    });
  });

  it("keeps client rooms available when optional room memory lookup fails", async () => {
    mockAuth();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.doMock("~/lib/data.server", () => ({
      listAgentMemory: vi.fn().mockResolvedValue([
        {
          id: "memory-recent-1",
          userId: "user-1",
          scope: "workspace",
          key: "review_cadence",
          watchlistId: null,
          clientRoomId: null,
          value: { value: "Weekly review." },
          source: "owner_ui",
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      ]),
      listAgentMemoryForClientRooms: vi.fn().mockRejectedValue(new Error("D1 unavailable")),
      listClientRooms: vi.fn().mockResolvedValue([
        {
          id: "room-1",
          userId: "user-1",
          name: "Nykaa weekly desk",
          clientLabel: "Nykaa",
          status: "active",
          notes: {},
          resourceRefs: [],
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      ]),
      listCollections: vi.fn().mockResolvedValue([]),
      listWatchlists: vi.fn().mockResolvedValue([]),
    }));

    const { loader } = await import("~/routes/app.clients");
    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app/clients"),
    } as never);

    expect(result.rooms).toHaveLength(1);
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]).toMatchObject({
      id: "memory-recent-1",
      key: "review_cadence",
      preview: "Weekly review.",
    });
    expect(consoleError).toHaveBeenCalledWith("[clients] room memory lookup failed", expect.any(Error));
  });

  it("redacts legacy secret-like client-room fields from loader data", async () => {
    mockAuth();
    vi.doMock("~/lib/data.server", () => ({
      listAgentMemory: vi.fn().mockResolvedValue([]),
      listAgentMemoryForClientRooms: vi.fn().mockResolvedValue([]),
      listClientRooms: vi.fn().mockResolvedValue([
        {
          id: "room-1",
          userId: "user-1",
          name: "https://hooks.slack.com/services/T/B/C",
          clientLabel: "apiKey=f9_live_secret",
          status: "active",
          notes: {
            goal: "bearer abcdefghijklmnop",
            cadence: "Weekly",
            handoff: {
              webhook: "https://hooks.slack.com/services/T/B/C",
              owner: "Growth",
            },
            channels: ["Email", "bearer nestedabcdefghijklmnop"],
          },
          resourceRefs: [
            {
              resourceType: "watchlist",
              resourceId: "watchlist-1",
              label: "https://hooks.slack.com/services/T/B/C",
            },
          ],
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      ]),
      listCollections: vi.fn().mockResolvedValue([]),
      listWatchlists: vi.fn().mockResolvedValue([]),
    }));

    const { loader } = await import("~/routes/app.clients");
    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app/clients"),
    } as never);

    expect(JSON.stringify(result)).not.toContain("hooks.slack.com");
    expect(JSON.stringify(result)).not.toContain("f9_live_secret");
    expect(JSON.stringify(result)).not.toContain("nestedabcdefghijklmnop");
    expect(result.rooms[0]).toMatchObject({
      name: "Client room",
      clientLabel: "Client",
      notes: {
        goal: "[redacted]",
        cadence: "Weekly",
        handoff: {
          "[redacted]": "[redacted]",
          owner: "Growth",
        },
        channels: ["Email", "[redacted]"],
      },
      resourceRefs: [],
    });
  });

  it("renders the operating memory form and saved memory previews", async () => {
    await mockRouter({
      rooms: [
        {
          id: "room-1",
          name: "Nykaa weekly desk",
          clientLabel: "Nykaa",
          status: "active",
          notes: {
            goal: "Weekly proof review for growth team.",
            cadence: "Weekly",
            reportApprovals: {
              "watchlist-watchlist-1": {
                evidenceFingerprint: "fixture-approved-evidence",
                reviewedAt: new Date(Date.now() - 60_000).toISOString(),
                approvalExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
              },
            },
          },
          resourceRefs: [
            {
              resourceType: "watchlist",
              resourceId: "watchlist-1",
              label: "Nykaa watchlist",
            },
            {
              resourceType: "report",
              resourceId: "watchlist-watchlist-1",
              label: "Nykaa watchlist report",
            },
          ],
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      ],
      watchlists: [],
      collections: [],
      memories: [
        {
          id: "memory-1",
          key: "review_cadence",
          scope: "customer",
          watchlistId: null,
          clientRoomId: "room-1",
          source: "owner_ui",
          updatedAt: "2026-06-20T00:00:00.000Z",
          preview: "Weekly client-ready review with direct tone.",
        },
      ],
      plan: "agency",
      canManageClientRooms: true,
    });

    const { default: ClientsRoute } = await import("~/routes/app.clients");
    const markup = renderToStaticMarkup(createElement(ClientsRoute));

    expect(markup).toContain("Report preferences and notes");
    expect(markup).toContain("Save context");
    expect(markup).toContain("review_cadence");
    expect(markup).toContain("Weekly client-ready review with direct tone.");
    expect(markup).toContain("Nykaa weekly desk");
    expect(markup).toContain("Ready for client review");
    expect(markup).toContain("1 evidence source");
    expect(markup).toContain("1 report");
    expect(markup).toContain("1 saved memory");
    expect(markup).toContain("room notes saved");
    expect(markup).toContain("Open the report and share the snapshot when ready.");
    expect(markup).toContain('name="intent" value="approve-client-room"');
  });

  it("fails closed when report revalidation helpers are unavailable", async () => {
    mockAuth();
    vi.doMock("~/lib/data.server", () => ({
      listAgentMemory: vi.fn().mockResolvedValue([]),
      listAgentMemoryForClientRooms: vi.fn().mockResolvedValue([]),
      listClientRooms: vi.fn().mockResolvedValue([{
        id: "room-1",
        name: "Nykaa weekly desk",
        clientLabel: "Nykaa",
        status: "active",
        notes: {
          reportApprovals: {
            "watchlist-watchlist-1": {
              evidenceFingerprint: "approved",
              reviewedAt: new Date(Date.now() - 60_000).toISOString(),
              approvalExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            },
          },
        },
        resourceRefs: [{ resourceType: "report", resourceId: "watchlist-watchlist-1" }],
        createdAt: "2026-06-20T00:00:00.000Z",
        updatedAt: "2026-06-20T00:00:00.000Z",
      }]),
      listCollections: vi.fn().mockResolvedValue([]),
      listWatchlists: vi.fn().mockResolvedValue([]),
      getLatestDigestRunSummaryForWatchlist: undefined,
      listAdsByIds: undefined,
      listCollectionItems: undefined,
      listWatchEvents: undefined,
      getCollection: undefined,
      getWatchlist: undefined,
    }));

    const { loader } = await import("~/routes/app.clients");
    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app/clients"),
    } as never);

    expect(result.rooms[0].notes.reportApprovals).toEqual({});
  });

  it("strips expired and malformed room approvals", async () => {
    mockAuth();
    const now = Date.now();
    const validReviewedAt = new Date(now - 60_000).toISOString();
    const validApprovalExpiresAt = new Date(now + 60 * 60 * 1000).toISOString();
    vi.doMock("~/lib/data.server", () => ({
      listAgentMemory: vi.fn().mockResolvedValue([]),
      listAgentMemoryForClientRooms: vi.fn().mockResolvedValue([]),
      listClientRooms: vi.fn().mockResolvedValue([{
        id: "room-1",
        name: "Nykaa weekly desk",
        clientLabel: "Nykaa",
        status: "active",
        notes: {
          reportApprovals: {
            valid: {
              evidenceFingerprint: "current",
              reviewedAt: validReviewedAt,
              approvalExpiresAt: validApprovalExpiresAt,
            },
            expired: {
              evidenceFingerprint: "old",
              reviewedAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
              approvalExpiresAt: new Date(now - 60_000).toISOString(),
            },
            malformed: {
              evidenceFingerprint: "missing-expiry",
              reviewedAt: "not-a-date",
              approvalExpiresAt: validApprovalExpiresAt,
            },
          },
        },
        resourceRefs: [],
        createdAt: "2026-06-20T00:00:00.000Z",
        updatedAt: "2026-06-20T00:00:00.000Z",
      }]),
      listCollections: vi.fn().mockResolvedValue([]),
      listWatchlists: vi.fn().mockResolvedValue([]),
    }));

    const { loader } = await import("~/routes/app.clients");
    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app/clients"),
    } as never);

    expect(result.rooms[0].notes.reportApprovals).toEqual({
      valid: {
        evidenceFingerprint: "current",
        reviewedAt: validReviewedAt,
        approvalExpiresAt: validApprovalExpiresAt,
      },
    });
  });

  it("drops synthetic report references and inactive watchlists from the client-room view", async () => {
    mockAuth();
    vi.doMock("~/lib/data.server", () => ({
      listAgentMemory: vi.fn().mockResolvedValue([]),
      listAgentMemoryForClientRooms: vi.fn().mockResolvedValue([]),
      listClientRooms: vi.fn().mockResolvedValue([{
        id: "room-1",
        name: "Nykaa weekly desk",
        clientLabel: "Nykaa",
        status: "active",
        notes: {},
        resourceRefs: [
          { resourceType: "watchlist", resourceId: "watchlist-inactive", label: "Inactive" },
          { resourceType: "report", resourceId: "synthetic-report", label: "Synthetic" },
        ],
        createdAt: "2026-06-20T00:00:00.000Z",
        updatedAt: "2026-06-20T00:00:00.000Z",
      }]),
      listCollections: vi.fn().mockResolvedValue([]),
      listWatchlists: vi.fn().mockResolvedValue([
        { id: "watchlist-inactive", isActive: false },
      ]),
      getLatestDigestRunSummaryForWatchlist: undefined,
      listAdsByIds: undefined,
      listCollectionItems: undefined,
      listWatchEvents: undefined,
      getCollection: undefined,
      getWatchlist: undefined,
    }));

    const { loader } = await import("~/routes/app.clients");
    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app/clients"),
    } as never);

    expect(result.rooms[0].resourceRefs).toEqual([]);
    expect(JSON.stringify(result.rooms[0])).not.toContain("Synthetic");
  });

  it("fails closed instead of approving evidence from an inactive watchlist", async () => {
    mockAuth();
    const upsertClientRoom = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      getClientRoom: vi.fn().mockResolvedValue({
        id: "room-1",
        name: "Nykaa weekly desk",
        clientLabel: "Nykaa",
        status: "active",
        notes: {},
        resourceRefs: [{ resourceType: "report", resourceId: "watchlist:watchlist-1" }],
      }),
      getCollection: vi.fn(),
      getWatchlist: vi.fn().mockResolvedValue({ id: "watchlist-1", isActive: false }),
      getLatestDigestRunSummaryForWatchlist: vi.fn(),
      listAdsByIds: vi.fn(),
      listCollectionItems: vi.fn(),
      listWatchEvents: vi.fn(),
      upsertAgentMemory: vi.fn(),
      upsertClientRoom,
    }));

    const { action } = await import("~/routes/app.clients");
    const formData = new FormData();
    formData.set("intent", "approve-client-room");
    formData.set("roomId", "room-1");
    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/clients", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toMatchObject({
      ok: false,
      intent: "approve-client-room",
      error: "evidence_not_ready",
    });
    expect(upsertClientRoom).not.toHaveBeenCalled();
  });

  it("shows a concrete next step for client rooms that are not ready to hand off", async () => {
    await mockRouter({
      rooms: [
        {
          id: "room-1",
          name: "Nykaa weekly desk",
          clientLabel: "Nykaa",
          status: "active",
          notes: {},
          resourceRefs: [],
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      ],
      watchlists: [],
      collections: [],
      memories: [],
      plan: "agency",
      canManageClientRooms: true,
    });

    const { default: ClientsRoute } = await import("~/routes/app.clients");
    const markup = renderToStaticMarkup(createElement(ClientsRoute));

    expect(markup).toContain("Needs setup before client review");
    expect(markup).toContain("No linked evidence yet");
    expect(markup).toContain("No client context saved");
    expect(markup).toContain("Link a watchlist or collection to this room.");
  });

  it.each(["free", "scout", "starter"] as const)(
    "rejects every client-room mutation before data access on the %s plan",
    async (plan) => {
      mockAuth(plan);
      const getClientRoom = vi.fn();
      const getCollection = vi.fn();
      const getWatchlist = vi.fn();
      const upsertAgentMemory = vi.fn();
      const upsertClientRoom = vi.fn();
      vi.doMock("~/lib/data.server", () => ({
        getClientRoom,
        getCollection,
        getWatchlist,
        upsertAgentMemory,
        upsertClientRoom,
      }));

      const { action } = await import("~/routes/app.clients");
      for (const [intent, fields] of [
        ["upsert-client-room", { name: "Nykaa weekly desk", watchlistIds: "watchlist-1" }],
        ["upsert-agent-memory", { key: "tone", value: "Direct weekly review." }],
        ["set-client-room-status", { roomId: "room-1", status: "archived" }],
        ["approve-client-room", { roomId: "room-1" }],
      ] as const) {
        const formData = new FormData();
        formData.set("intent", intent);
        for (const [key, value] of Object.entries(fields)) formData.set(key, value);
        const result = await action({
          context: createContext(),
          request: new Request("http://localhost/app/clients", { method: "POST", body: formData }),
        } as never);

        expect(result).toMatchObject({
          ok: false,
          error: "plan_gated",
          feature: "client_reports",
          plan,
          message: "This capability is not included in your current plan.",
        });
      }

      expect(getClientRoom).not.toHaveBeenCalled();
      expect(getCollection).not.toHaveBeenCalled();
      expect(getWatchlist).not.toHaveBeenCalled();
      expect(upsertAgentMemory).not.toHaveBeenCalled();
      expect(upsertClientRoom).not.toHaveBeenCalled();
    },
  );

  it("keeps Agency status actions unchanged", async () => {
    mockAuth("agency");
    const getClientRoom = vi.fn().mockResolvedValue({
      id: "room-1",
      name: "Nykaa weekly desk",
      clientLabel: "Nykaa",
    });
    const upsertClientRoom = vi.fn().mockResolvedValue({ id: "room-1" });
    vi.doMock("~/lib/data.server", () => ({
      getClientRoom,
      getCollection: vi.fn(),
      getWatchlist: vi.fn(),
      upsertAgentMemory: vi.fn(),
      upsertClientRoom,
    }));

    const { action } = await import("~/routes/app.clients");
    const formData = new FormData();
    formData.set("intent", "set-client-room-status");
    formData.set("roomId", "room-1");
    formData.set("status", "archived");
    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/clients", { method: "POST", body: formData }),
    } as never);

    expect(result).toEqual({ ok: true, message: "Client room archived." });
    expect(getClientRoom).toHaveBeenCalledWith({}, "user-1", "room-1");
    expect(upsertClientRoom).toHaveBeenCalledWith({}, "user-1", {
      roomId: "room-1",
      name: "Nykaa weekly desk",
      clientLabel: "Nykaa",
      status: "archived",
    });
  });

  it("renders downgraded rooms and context as read-only with a billing recovery path", async () => {
    await mockRouter({
      plan: "starter",
      canManageClientRooms: false,
      rooms: [
        {
          id: "room-1",
          name: "Nykaa weekly desk",
          clientLabel: "Nykaa",
          status: "active",
          notes: { goal: "Weekly proof review." },
          resourceRefs: [{ resourceType: "watchlist", resourceId: "watchlist-1", label: "Nykaa watchlist" }],
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
        {
          id: "room-2",
          name: "Archived desk",
          clientLabel: "Acme",
          status: "archived",
          notes: {},
          resourceRefs: [],
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      ],
      watchlists: [],
      collections: [],
      memories: [{
        id: "memory-1",
        key: "review_tone",
        scope: "workspace",
        watchlistId: null,
        clientRoomId: "room-1",
        source: "owner_ui",
        updatedAt: "2026-06-20T00:00:00.000Z",
        preview: "Direct and evidence-led.",
      }],
    });

    const { default: ClientsRoute } = await import("~/routes/app.clients");
    const markup = renderToStaticMarkup(createElement(ClientsRoute));

    expect(markup).toContain("Nykaa weekly desk");
    expect(markup).toContain("Nykaa watchlist");
    expect(markup).toContain("Direct and evidence-led.");
    expect(markup).toContain("Archived desk");
    expect(markup).toContain("Upgrade to Agency");
    expect(markup).toContain("/app/billing?source=clients#plans");
    expect(markup.match(/Upgrade to Agency/g)).toHaveLength(1);
    expect(markup).not.toContain("is-error");
    expect(markup).not.toContain("Save client room");
    expect(markup).not.toContain("Save context");
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain(">Archive<");
    expect(markup).not.toContain(">Restore<");
  });

  it("renders a locked empty state instead of a dead-end create prompt", async () => {
    await mockRouter({
      plan: "free",
      canManageClientRooms: false,
      rooms: [],
      watchlists: [],
      collections: [],
      memories: [],
    });

    const { default: ClientsRoute } = await import("~/routes/app.clients");
    const markup = renderToStaticMarkup(createElement(ClientsRoute));

    expect(markup).toContain("f9-locked-feature");
    expect(markup).toContain("included in the Agency plan.");
    expect(markup).toContain("Upgrade to Agency");
    expect(markup).toContain("/app/billing?source=clients#plans");
    expect(markup.match(/Upgrade to Agency/g)).toHaveLength(1);
    expect(markup).not.toContain("is-error");
    expect(markup).not.toContain("Create the first client room");
    expect(markup).not.toContain("Save client room");
    expect(markup).not.toContain("Save context");
    expect(markup).not.toContain("<form");
  });
});
