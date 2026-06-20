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

    expect(result).toEqual({ ok: true, message: "Operating memory saved for future agent runs." });
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

  it("renders the operating memory form and saved memory previews", async () => {
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

    expect(markup).toContain("Operating context for agents");
    expect(markup).toContain("Save memory");
    expect(markup).toContain("review_cadence");
    expect(markup).toContain("Weekly client-ready review with direct tone.");
    expect(markup).toContain("Nykaa weekly desk");
  });
});
