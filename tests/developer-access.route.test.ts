import { readFileSync } from "node:fs";
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
  it("renders a clear owner-managed empty state for members", () => {
    const source = readFileSync("app/routes/app.developer-access.ui.tsx", "utf8");

    expect(source).toContain("API keys are managed by the account owner");
    expect(source).toContain("ownerManagedApiKeys");
  });

  it("loads a clear Agency-plan lock reason before API-key submit", async () => {
    const { getUserPlan } = await import("~/lib/plan.server");
    vi.mocked(getUserPlan).mockResolvedValue("starter");

    vi.doMock("~/lib/auth.server", () => ({
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
    vi.doMock("~/lib/data.server", () => ({
      listCustomerApiKeys: vi.fn().mockResolvedValue([]),
    }));

    const { loader } = await import("~/routes/app.developer-access");
    const result = await loader({
      context: createContext({ DB: {} }),
      request: new Request("http://localhost/app/developer-access"),
    } as never);

    expect(result).toMatchObject({
      canCreateApiKeys: false,
      createDisabledReason: "Developer access is included in the Agency plan. Upgrade to Agency to create API keys.",
      apiKeys: [],
    });
  });

  it("loads a clear owner-only lock reason for workspace members", async () => {
    const { getUserPlan } = await import("~/lib/plan.server");
    vi.mocked(getUserPlan).mockResolvedValue("agency");

    vi.doMock("~/lib/auth.server", () => ({
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
    const listCustomerApiKeys = vi.fn().mockResolvedValue([
      {
        id: "owner-secret",
        name: "Owner key",
        keyPrefix: "f9_live_owner",
        actionsWriteEnabled: true,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: "2026-05-15T00:00:00.000Z",
      },
    ]);
    vi.doMock("~/lib/data.server", () => ({
      listCustomerApiKeys,
    }));

    const { loader } = await import("~/routes/app.developer-access");
    const result = await loader({
      context: createContext({ DB: {} }),
      request: new Request("http://localhost/app/developer-access"),
    } as never);

    expect(result).toMatchObject({
      canCreateApiKeys: false,
      createDisabledReason: "Only Owner can create or revoke API keys for this workspace.",
      apiKeys: [],
    });
    expect(listCustomerApiKeys).not.toHaveBeenCalled();
  });

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
				intent,
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
			intent: "revoke-api-key",
			apiKeyId: "api-key-1",
      message: "API key revoked.",
    });
  });
});
