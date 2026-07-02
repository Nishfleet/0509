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

function mockAuth() {
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
      resourceRefs: [
        {
          label: "Watchlist",
        },
      ],
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
    });

    const { default: ClientsRoute } = await import("~/routes/app.clients");
    const markup = renderToStaticMarkup(createElement(ClientsRoute));

    expect(markup).toContain("Needs setup before client review");
    expect(markup).toContain("No linked evidence yet");
    expect(markup).toContain("No client context saved");
    expect(markup).toContain("Link a watchlist or collection to this room.");
  });
});
