import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  user: {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
  },
  session: {
    id: "session-1",
    userId: "user-1",
    expiresAt: "2026-06-01T00:00:00.000Z",
  },
};

function createContext(env: Record<string, unknown> = {}) {
  return {
    cloudflare: {
      env: {
        BETTER_AUTH_URL: "https://0509.io",
        LINKEDIN_CLIENT_ID: "linkedin-client",
        LINKEDIN_CLIENT_SECRET: "linkedin-secret",
        ...env,
      },
    },
  };
}

function mockBase() {
  vi.doMock("~/lib/auth.server", () => ({
    requireWorkspaceSession: vi.fn().mockResolvedValue({
      session,
      workspaceUserId: "workspace-1",
    }),
  }));
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn((context) => context.cloudflare.env),
  }));
  vi.doMock("~/lib/presence-access-gates.server", () => ({
    evaluateConnectorAccessGate: vi.fn().mockResolvedValue({ allowed: true }),
  }));
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.useRealTimers();
});

describe("LinkedIn Presence OAuth start route", () => {
  it("does not start a link for an entity outside the workspace", async () => {
    const startBetterAuthAccountLink = vi.fn();
    mockBase();
    vi.doMock("~/lib/better-auth.server", () => ({
      betterAuthBaseURL: vi.fn().mockReturnValue("https://0509.io"),
      isBetterAuthConfigured: vi.fn().mockReturnValue(true),
      startBetterAuthAccountLink,
    }));
    vi.doMock("~/lib/presence-data.server", () => ({
      getTrackedEntity: vi.fn().mockResolvedValue(null),
    }));

    const { loader } = await import("~/routes/api.presence.oauth.linkedin");
    const response = await loader({
      context: createContext(),
      request: new Request("https://0509.io/api/presence/oauth/linkedin?entity=other-entity"),
    } as never);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/app/presence?oauth=linkedin_failed");
    expect(startBetterAuthAccountLink).not.toHaveBeenCalled();
  });

  it("redirects to the Better Auth link URL with the entity carried in callbackURL", async () => {
    const startBetterAuthAccountLink = vi.fn().mockResolvedValue({
      url: "https://www.linkedin.com/oauth/v2/authorization?client_id=linkedin-client&state=signed",
    });
    mockBase();
    vi.doMock("~/lib/better-auth.server", () => ({
      betterAuthBaseURL: vi.fn().mockReturnValue("https://0509.io"),
      isBetterAuthConfigured: vi.fn().mockReturnValue(true),
      startBetterAuthAccountLink,
    }));
    vi.doMock("~/lib/presence-data.server", () => ({
      getTrackedEntity: vi.fn().mockResolvedValue({ id: "entity-1" }),
    }));

    const { loader } = await import("~/routes/api.presence.oauth.linkedin");
    const response = await loader({
      context: createContext(),
      request: new Request("https://0509.io/api/presence/oauth/linkedin?entity=entity-1"),
    } as never);

    expect(startBetterAuthAccountLink).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        provider: "linkedin",
        callbackURL: "https://0509.io/api/presence/oauth/linkedin/callback?entity=entity-1",
        errorCallbackURL: "https://0509.io/app/presence?oauth=linkedin_failed",
      }),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://www.linkedin.com/oauth/v2/authorization?client_id=linkedin-client&state=signed",
    );
  });

  it("fails closed when LinkedIn OAuth is not configured", async () => {
    const startBetterAuthAccountLink = vi.fn();
    mockBase();
    vi.doMock("~/lib/better-auth.server", () => ({
      betterAuthBaseURL: vi.fn().mockReturnValue("https://0509.io"),
      isBetterAuthConfigured: vi.fn().mockReturnValue(true),
      startBetterAuthAccountLink,
    }));

    const { loader } = await import("~/routes/api.presence.oauth.linkedin");
    const response = await loader({
      context: createContext({ LINKEDIN_CLIENT_SECRET: "" }),
      request: new Request("https://0509.io/api/presence/oauth/linkedin"),
    } as never);

    expect(response.status).toBe(503);
    expect(startBetterAuthAccountLink).not.toHaveBeenCalled();
  });
});

describe("LinkedIn Presence OAuth finalize route", () => {
  function mockFinishDeps() {
    const upsertSourceConnection = vi.fn().mockResolvedValue(undefined);
    const getBetterAuthLinkedAccountToken = vi
      .fn()
      .mockResolvedValue("linkedin-access-token");
    mockBase();
    vi.doMock("~/lib/better-auth.server", () => ({
      getBetterAuthLinkedAccountToken,
      isBetterAuthConfigured: vi.fn().mockReturnValue(true),
    }));
    vi.doMock("~/lib/credential-crypto.server", () => ({
      credentialFingerprint: vi.fn().mockResolvedValue("fingerprint-1"),
      encryptCredential: vi.fn().mockResolvedValue("encrypted-1"),
    }));
    vi.doMock("~/lib/presence-data.server", () => ({
      getTrackedEntity: vi.fn().mockResolvedValue({ id: "entity-1" }),
      upsertSourceConnection,
    }));
    return { getBetterAuthLinkedAccountToken, upsertSourceConnection };
  }

  function dbReturning(row: Record<string, unknown> | null) {
    return {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(row),
        }),
      }),
    };
  }

  it("copies the fresh linked grant into source_connection", async () => {
    const { getBetterAuthLinkedAccountToken, upsertSourceConnection } = mockFinishDeps();

    const { loader } = await import("~/routes/api.presence.oauth.linkedin.callback");
    const response = await loader({
      context: createContext({ DB: dbReturning({
        id: "account-row-1",
        accountId: "li-member-9",
        updatedAt: new Date().toISOString(),
      }) }),
      request: new Request(
        "https://0509.io/api/presence/oauth/linkedin/callback?entity=entity-1",
      ),
    } as never);

    expect(getBetterAuthLinkedAccountToken).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { accountId: "account-row-1" },
    );
    expect(upsertSourceConnection).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        connectorId: "linkedin",
        externalAccountId: "li-member-9",
        status: "healthy",
        trackedEntityId: "entity-1",
        userId: "user-1",
      }),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "/app/presence/entity-1?oauth=linkedin_connected",
    );
  });
});
