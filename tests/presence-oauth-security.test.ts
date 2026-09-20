import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Security invariants of the Better Auth-backed presence OAuth flow
 * (issue #3788). The hand-rolled transaction record is gone: PKCE, signed
 * state, expiry and single-use consumption are owned by the plugin's
 * /api/auth/callback/linkedin handler. What remains ours — and is pinned here:
 * the finalize route never trusts client-supplied `code`/`state` params, only
 * finalizes a freshly linked `account` row bound to the session user, and
 * re-validates that the entity belongs to the caller's workspace.
 */

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

function dbReturning(row: Record<string, unknown> | null) {
  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(row),
      }),
    }),
  };
}

function mockFinishDeps(overrides: {
  entity?: unknown;
  token?: string | null;
  configured?: boolean;
} = {}) {
  const upsertSourceConnection = vi.fn().mockResolvedValue(undefined);
  const getBetterAuthLinkedAccountToken = vi
    .fn()
    .mockResolvedValue(overrides.token === undefined ? "linkedin-access-token" : overrides.token);
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
  vi.doMock("~/lib/better-auth.server", () => ({
    getBetterAuthLinkedAccountToken,
    isBetterAuthConfigured: vi.fn().mockReturnValue(overrides.configured ?? true),
  }));
  vi.doMock("~/lib/credential-crypto.server", () => ({
    credentialFingerprint: vi.fn().mockResolvedValue("fingerprint-1"),
    encryptCredential: vi.fn().mockResolvedValue("encrypted-1"),
  }));
  vi.doMock("~/lib/presence-data.server", () => ({
    getTrackedEntity: vi
      .fn()
      .mockResolvedValue(overrides.entity === undefined ? { id: "entity-1" } : overrides.entity),
    upsertSourceConnection,
  }));
  return { getBetterAuthLinkedAccountToken, upsertSourceConnection };
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

describe("presence oauth finalize security", () => {
  it("ignores client-supplied code/state params — no fresh linked account, no write", async () => {
    const { upsertSourceConnection } = mockFinishDeps();

    const { loader } = await import("~/routes/api.presence.oauth.linkedin.callback");
    const response = await loader({
      context: createContext({ DB: dbReturning(null) }),
      request: new Request(
        "https://0509.io/api/presence/oauth/linkedin/callback?code=forged&state=forged.state",
      ),
    } as never);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/app/presence?oauth=linkedin_failed");
    expect(upsertSourceConnection).not.toHaveBeenCalled();
  });

  it("rejects a stale linked account — the grant must be fresh", async () => {
    const { upsertSourceConnection, getBetterAuthLinkedAccountToken } = mockFinishDeps();

    const { loader } = await import("~/routes/api.presence.oauth.linkedin.callback");
    const response = await loader({
      context: createContext({
        DB: dbReturning({
          id: "account-row-1",
          accountId: "li-member-9",
          updatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        }),
      }),
      request: new Request(
        "https://0509.io/api/presence/oauth/linkedin/callback?code=c&state=s",
      ),
    } as never);

    expect(response.headers.get("location")).toBe("/app/presence?oauth=linkedin_failed");
    expect(getBetterAuthLinkedAccountToken).not.toHaveBeenCalled();
    expect(upsertSourceConnection).not.toHaveBeenCalled();
  });

  it("rejects an entity outside the caller's workspace", async () => {
    const { upsertSourceConnection } = mockFinishDeps({ entity: null });

    const { loader } = await import("~/routes/api.presence.oauth.linkedin.callback");
    const response = await loader({
      context: createContext({
        DB: dbReturning({
          id: "account-row-1",
          accountId: "li-member-9",
          updatedAt: new Date().toISOString(),
        }),
      }),
      request: new Request(
        "https://0509.io/api/presence/oauth/linkedin/callback?entity=other-workspace-entity",
      ),
    } as never);

    expect(response.headers.get("location")).toBe("/app/presence?oauth=linkedin_failed");
    expect(upsertSourceConnection).not.toHaveBeenCalled();
  });

  it("fails closed when Better Auth is not configured", async () => {
    const { upsertSourceConnection } = mockFinishDeps({ configured: false });

    const { loader } = await import("~/routes/api.presence.oauth.linkedin.callback");
    const response = await loader({
      context: createContext({
        DB: dbReturning({
          id: "account-row-1",
          accountId: "li-member-9",
          updatedAt: new Date().toISOString(),
        }),
      }),
      request: new Request("https://0509.io/api/presence/oauth/linkedin/callback"),
    } as never);

    expect(response.headers.get("location")).toBe("/app/presence?oauth=linkedin_failed");
    expect(upsertSourceConnection).not.toHaveBeenCalled();
  });

  it("fails closed when the linked grant cannot be read back", async () => {
    const { upsertSourceConnection } = mockFinishDeps({ token: null });

    const { loader } = await import("~/routes/api.presence.oauth.linkedin.callback");
    const response = await loader({
      context: createContext({
        DB: dbReturning({
          id: "account-row-1",
          accountId: "li-member-9",
          updatedAt: new Date().toISOString(),
        }),
      }),
      request: new Request("https://0509.io/api/presence/oauth/linkedin/callback"),
    } as never);

    expect(response.headers.get("location")).toBe(
      "/app/presence?oauth=linkedin_token_missing",
    );
    expect(upsertSourceConnection).not.toHaveBeenCalled();
  });
});
