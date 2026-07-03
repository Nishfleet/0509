import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/plan.server", () => ({
  getUserPlan: vi.fn().mockResolvedValue("agency"),
  getEffectiveWorkspacePlan: vi.fn().mockResolvedValue("agency"),
  checkPlanLimit: vi.fn().mockResolvedValue({ allowed: true, limit: 75, current: 1 }),
  PLAN_LIMITS: { agency: { digests: true } },
}));

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

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});


describe("developer access route action", () => {
  it("creates a customer API key and returns the one-time secret", async () => {
    const createCustomerApiKey = vi.fn().mockResolvedValue({
      secret: "example-full-secret",
      apiKey: {
        keyPrefix: "example-full-prefix",
      },
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
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ DB: {} })),
    }));
    vi.doMock("~/lib/customer-meta.server", () => ({
      disconnectCustomerMetaToken: vi.fn(),
      retestSavedCustomerMetaToken: vi.fn(),
      saveCustomerMetaToken: vi.fn(),
    }));
    vi.doMock("~/lib/api-keys.server", () => ({
      createCustomerApiKey,
    }));

    const { action } = await import("~/routes/app.developer-access");
    const formData = new FormData();
    formData.set("intent", "create-api-key");
    formData.set("apiKeyName", "Claude workflow");
    formData.set("actionsWriteEnabled", "1");

    const result = await action({
      context: createContext({ DB: {} }),
      request: new Request("http://localhost/app/developer-access", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(createCustomerApiKey).toHaveBeenCalledWith(expect.anything(), "user-1", "Claude workflow", {
      actionsWriteEnabled: true,
    });
    expect(result).toMatchObject({
      ok: true,
      apiKeySecret: "example-full-secret",
      apiKeyPrefix: "example-full-prefix",
    });
  });

  it("keeps legacy sources API-key posts action-compatible", async () => {
    const createCustomerApiKey = vi.fn().mockResolvedValue({
      secret: "example-legacy-secret",
      apiKey: {
        keyPrefix: "example-legacy-prefix",
      },
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
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ DB: {} })),
    }));
    vi.doMock("~/lib/api-keys.server", () => ({
      createCustomerApiKey,
    }));

    const { action } = await import("~/routes/app.sources");
    const formData = new FormData();
    formData.set("intent", "create-api-key");
    formData.set("apiKeyName", "Legacy workflow");
    formData.set("actionsWriteEnabled", "1");

    const result = await action({
      context: createContext({ DB: {} }),
      request: new Request("http://localhost/app/sources", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(createCustomerApiKey).toHaveBeenCalledWith(expect.anything(), "user-1", "Legacy workflow", {
      actionsWriteEnabled: true,
    });
    expect(result).toMatchObject({
      ok: true,
      apiKeySecret: "example-legacy-secret",
    });
  });

  it.each(["create-api-key", "revoke-api-key"])(
    "blocks workspace members from managing developer access intent %s",
    async (intent) => {
      const createCustomerApiKey = vi.fn();
      const revokeCustomerApiKey = vi.fn();

      vi.doMock("~/lib/auth.server", () => ({
        requireSession: vi.fn().mockResolvedValue(session),
        requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
          session,
          workspaceUserId: "owner-1",
          isMember: true,
          ownerName: "Owner",
        })),
      }));
      vi.doMock("~/lib/context.server", () => ({
        getEnv: vi.fn(() => ({ DB: {} })),
      }));
      vi.doMock("~/lib/customer-meta.server", () => ({
        disconnectCustomerMetaToken: vi.fn(),
        retestSavedCustomerMetaToken: vi.fn(),
        saveCustomerMetaToken: vi.fn(),
      }));
      vi.doMock("~/lib/api-keys.server", () => ({
        createCustomerApiKey,
      }));
      vi.doMock("~/lib/data.server", () => ({
        revokeCustomerApiKey,
      }));

      const { action } = await import("~/routes/app.developer-access");
      const formData = new FormData();
      formData.set("intent", intent);
      formData.set("apiKeyName", "Member-created key");
      formData.set("apiKeyId", "api-key-member");

      const result = await action({
        context: createContext({ DB: {} }),
        request: new Request("http://localhost/app/developer-access", {
          method: "POST",
          body: formData,
        }),
      } as never);

      expect(createCustomerApiKey).not.toHaveBeenCalled();
      expect(revokeCustomerApiKey).not.toHaveBeenCalled();
      expect(result).toEqual({
        ok: false,
        message: "Only the account owner can manage developer access and API keys.",
      });
    },
  );

  it("revokes a customer API key", async () => {
    const revokeCustomerApiKey = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
      session,
      workspaceUserId: session.user.id,
      isMember: false,
      ownerName: null,
    })),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ DB: {} })),
    }));
    vi.doMock("~/lib/customer-meta.server", () => ({
      disconnectCustomerMetaToken: vi.fn(),
      retestSavedCustomerMetaToken: vi.fn(),
      saveCustomerMetaToken: vi.fn(),
    }));
    vi.doMock("~/lib/data.server", () => ({
      revokeCustomerApiKey,
    }));

    const { action } = await import("~/routes/app.developer-access");
    const formData = new FormData();
    formData.set("intent", "revoke-api-key");
    formData.set("apiKeyId", "api-key-1");

    const result = await action({
      context: createContext({ DB: {} }),
      request: new Request("http://localhost/app/developer-access", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(revokeCustomerApiKey).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      apiKeyId: "api-key-1",
    });
    expect(result).toEqual({
      ok: true,
      message: "API key revoked.",
    });
  });
});
