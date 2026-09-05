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

function createContext(env: Record<string, string> = {}) {
  return {
    cloudflare: {
      env: {
        BETTER_AUTH_URL: "https://0509.io",
        LINKEDIN_CLIENT_ID: "linkedin-client",
        LINKEDIN_CLIENT_SECRET: "linkedin-secret",
        PRESENCE_OAUTH_STATE_SECRET: "state-secret-with-enough-length",
        ...env,
      },
    },
  };
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

describe("LinkedIn Presence OAuth routes", () => {
  it("does not create an OAuth transaction for an entity outside the workspace", async () => {
    const createPresenceOAuthTransaction = vi.fn();
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
    vi.doMock("~/lib/presence-oauth-transaction.server", () => ({
      createPresenceOAuthTransaction,
      presenceOAuthConfigured: vi.fn().mockReturnValue(true),
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
    expect(createPresenceOAuthTransaction).not.toHaveBeenCalled();
  });

  it("releases token fetch timeout timers when LinkedIn rejects the callback token exchange", async () => {
    vi.useFakeTimers();
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
    vi.doMock("~/lib/presence-oauth-transaction.server", () => ({
      verifyPresenceOAuthState: vi.fn().mockResolvedValue({
        ok: true,
        transactionId: "transaction-1",
      }),
      consumePresenceOAuthTransaction: vi.fn().mockResolvedValue({
        ok: true,
        transaction: {
          pkceVerifier: "pkce-verifier",
          returnPath: "/app/presence",
        },
      }),
    }));
    vi.doMock("~/lib/credential-crypto.server", () => ({
      credentialFingerprint: vi.fn(),
      encryptCredential: vi.fn(),
    }));
    vi.doMock("~/lib/presence-data.server", () => ({
      upsertSourceConnection: vi.fn(),
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("invalid", { status: 400 })),
    );

    const { loader } = await import("~/routes/api.presence.oauth.linkedin.callback");
    const response = await loader({
      context: createContext(),
      request: new Request(
        "https://0509.io/api/presence/oauth/linkedin/callback?code=code-1&state=state-1",
      ),
    } as never);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/app/presence?oauth=linkedin_token_failed");
    expect(vi.getTimerCount()).toBe(0);
  });
});
