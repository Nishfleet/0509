import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/plan.server", () => ({
  getUserPlan: vi.fn().mockResolvedValue("agency"),
  getEffectiveWorkspacePlan: vi.fn().mockResolvedValue("agency"),
  checkPlanLimit: vi.fn().mockResolvedValue({ allowed: true, limit: 75, current: 1 }),
  PLAN_LIMITS: { agency: { digests: true } },
}));

vi.mock("~/lib/ga-customer-surface", () => ({
  isSlackDeliveryCustomerFacing: vi.fn(() => false),
  isWhatsAppDeliveryCustomerFacing: vi.fn(() => false),
  slackDeliveryUnavailableMessage: vi.fn(
    () => "Slack delivery is not available at general availability yet. Use email delivery.",
  ),
  whatsappDeliveryUnavailableMessage: vi.fn(
    () => "WhatsApp delivery is not available at general availability yet. Use email delivery.",
  ),
}));

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

const discoveryStatus = {
  status: "cache_only",
  provider: "meta_library_browser",
  mode: "cache",
  summary: "Cached live results are available, but fresh discovery is degraded.",
  lastCheckedAt: "2026-05-15T00:00:00.000Z",
  lastErrorCode: "login_wall",
  lastErrorMessage: "Meta returned a login wall.",
} as const;

const betaReadiness = {
  ok: false,
  label: "Beta: needs validation",
  windowDays: 7,
  sampleTarget: 20,
  samples: 6,
  successes: 0,
  failures: 6,
  recentFailures: 6,
  successRate: 0,
  latestSuccessAt: null,
  latestFailureAt: "2026-05-15T00:00:00.000Z",
  blockers: ["not_enough_live_samples", "no_recent_live_success"],
  providerBreakdown: [],
};

function createContext(env = {}) {
  return {
    cloudflare: {
      env,
    },
  };
}

function fakeSlackWebhookUrl() {
  return new URL(["services", "TSTUB", "BSTUB", "short"].join("/"), "https://hooks.slack.com/").toString();
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

beforeEach(async () => {
  const { isSlackDeliveryCustomerFacing, isWhatsAppDeliveryCustomerFacing } = await import("~/lib/ga-customer-surface");
  vi.mocked(isSlackDeliveryCustomerFacing).mockReturnValue(false);
  vi.mocked(isWhatsAppDeliveryCustomerFacing).mockReturnValue(false);
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("source access route loader", () => {
  it("returns only safe customer Meta connection fields", async () => {
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
      getEnv: vi.fn(() => ({})),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      resolveCommercialAdSourceStatus: vi.fn().mockResolvedValue(discoveryStatus),
    }));
    const listDeliveryTargets = vi.fn(async (_env: unknown, _userId: string, options: { channel: string }) => {
      if (options.channel === "slack") {
        return [
          {
            id: "slack-target-1",
            userId: "user-1",
            watchlistId: null,
            channel: "slack",
            targetValue: "slack:abc123",
            validationStatus: "validated",
            isValidated: true,
            isOptedIn: true,
            optInSource: "manual_slack_webhook",
            optedInAt: "2026-06-06T00:00:00.000Z",
            isPaused: false,
            pausedAt: null,
            optedOutAt: null,
            templateEligible: true,
            lastSuccessfulDeliveryAt: null,
            lastSuccessfulAttemptId: null,
            providerIdentifier: "abc123",
            metadata: {
              displayName: "Growth alerts",
            },
            createdAt: "2026-06-06T00:00:00.000Z",
            updatedAt: "2026-06-06T00:00:00.000Z",
          },
        ];
      }

      return [
        {
          id: "whatsapp-target-1",
          userId: "user-1",
          watchlistId: "watchlist-1",
          channel: "whatsapp",
          targetValue: "+919999999999",
          validationStatus: "pending",
          isValidated: false,
          isOptedIn: true,
          optInSource: "manual",
          optedInAt: "2026-06-06T00:00:00.000Z",
          isPaused: false,
          pausedAt: null,
          optedOutAt: null,
          templateEligible: false,
          lastSuccessfulDeliveryAt: null,
          lastSuccessfulAttemptId: null,
          providerIdentifier: null,
          metadata: {},
          createdAt: "2026-06-06T00:00:00.000Z",
          updatedAt: "2026-06-06T00:00:00.000Z",
        },
      ];
    });

    vi.doMock("~/lib/data.server", () => ({
      getCustomerMetaConnection: vi.fn().mockResolvedValue({
        userId: "user-1",
        encryptedAccessToken: "v1:secret",
        tokenLastFour: "1234",
        tokenFingerprint: "fingerprint",
        status: "healthy",
        summary: "Connected.",
        lastCheckedAt: "2026-05-15T00:00:00.000Z",
        lastErrorCode: null,
        lastErrorMessage: null,
        createdAt: "2026-05-15T00:00:00.000Z",
        updatedAt: "2026-05-15T00:00:00.000Z",
      }),
      listCustomerApiKeys: vi.fn().mockResolvedValue([
        {
          id: "api-key-1",
          userId: "user-1",
          name: "Claude workflow",
          keyPrefix: ["f9", "live", "abcd1234"].join("_"),
          actionsWriteEnabled: true,
          lastUsedAt: null,
          revokedAt: null,
          createdAt: "2026-06-06T00:00:00.000Z",
          updatedAt: "2026-06-06T00:00:00.000Z",
        },
      ]),
      listDeliveryTargets,
    }));
    vi.doMock("~/lib/env.server", () => ({
      isCustomerWhatsAppReady: vi.fn().mockReturnValue(false),
      isWhatsAppProviderConfigured: vi.fn().mockReturnValue(false),
      isWhatsAppWebhookConfigured: vi.fn().mockReturnValue(false),
    }));
    vi.doMock("~/lib/slack.server", () => ({
      slackTargetDisplayName: vi.fn((target) => target.metadata.displayName),
    }));
    vi.doMock("~/lib/whatsapp.server", () => ({
      whatsappTargetDisplayName: vi.fn(() => "Founder phone"),
    }));
    vi.doMock("~/lib/meta-ads-readiness.server", () => ({
      getMetaAdsBetaReadiness: vi.fn().mockResolvedValue(betaReadiness),
    }));

    const { loader } = await import("~/routes/app.source-access");
    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app/source-access"),
    } as never);

    expect(JSON.stringify(result)).not.toContain("v1:secret");
    expect(result).toMatchObject({
      connection: {
        status: "healthy",
        tokenLastFour: "1234",
      },
      discoveryStatus,
    });
    expect(JSON.stringify(result)).not.toContain("+919999999999");
    expect(JSON.stringify(result)).not.toContain("f9_live_abcd1234");
    expect(listDeliveryTargets).not.toHaveBeenCalled();
  });
});

describe("source access route action", () => {
  it("tests and saves a customer Meta token", async () => {
    const saveCustomerMetaToken = vi.fn().mockResolvedValue({
      ok: true,
      testResult: {
        summary: "Connected.",
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
      getEnv: vi.fn(() => ({ BETTER_AUTH_SECRET: "secret" })),
    }));
    vi.doMock("~/lib/customer-meta.server", () => ({
      disconnectCustomerMetaToken: vi.fn(),
      retestSavedCustomerMetaToken: vi.fn(),
      saveCustomerMetaToken,
    }));

    const { action } = await import("~/routes/app.source-access");
    const formData = new FormData();
    formData.set("intent", "connect-meta-token");
    formData.set("metaToken", "EAABabcdefghijklmnopqrstuvwxyz");

    const result = await action({
      context: createContext({ BETTER_AUTH_SECRET: "secret" }),
      request: new Request("http://localhost/app/source-access", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(saveCustomerMetaToken).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "EAABabcdefghijklmnopqrstuvwxyz",
    );
    expect(result).toEqual({
      ok: true,
      message: "Connected.",
    });
  });

  it("keeps legacy sources Meta-token posts action-compatible", async () => {
    const saveCustomerMetaToken = vi.fn().mockResolvedValue({
      ok: true,
      testResult: {
        summary: "Connected from old route.",
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
      getEnv: vi.fn(() => ({ BETTER_AUTH_SECRET: "secret" })),
    }));
    vi.doMock("~/lib/customer-meta.server", () => ({
      disconnectCustomerMetaToken: vi.fn(),
      retestSavedCustomerMetaToken: vi.fn(),
      saveCustomerMetaToken,
    }));

    const { action } = await import("~/routes/app.sources");
    const formData = new FormData();
    formData.set("intent", "connect-meta-token");
    formData.set("metaToken", "EAABlegacytoken");

    const result = await action({
      context: createContext({ BETTER_AUTH_SECRET: "secret" }),
      request: new Request("http://localhost/app/sources", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(saveCustomerMetaToken).toHaveBeenCalledWith(expect.anything(), "user-1", "EAABlegacytoken");
    expect(result).toEqual({
      ok: true,
      message: "Connected from old route.",
    });
  });

  it.each(["connect-meta-token", "retest-meta-token", "disconnect-meta-token"])(
    "blocks workspace members from managing source access intent %s",
    async (intent) => {
      const disconnectCustomerMetaToken = vi.fn();
      const retestSavedCustomerMetaToken = vi.fn();
      const saveCustomerMetaToken = vi.fn();

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
        getEnv: vi.fn(() => ({ BETTER_AUTH_SECRET: "secret" })),
      }));
      vi.doMock("~/lib/customer-meta.server", () => ({
        disconnectCustomerMetaToken,
        retestSavedCustomerMetaToken,
        saveCustomerMetaToken,
      }));

      const { action } = await import("~/routes/app.source-access");
      const formData = new FormData();
      formData.set("intent", intent);
      formData.set("metaToken", "EAABmembertoken");

      const result = await action({
        context: createContext({ BETTER_AUTH_SECRET: "secret" }),
        request: new Request("http://localhost/app/source-access", {
          method: "POST",
          body: formData,
        }),
      } as never);

      expect(disconnectCustomerMetaToken).not.toHaveBeenCalled();
      expect(retestSavedCustomerMetaToken).not.toHaveBeenCalled();
      expect(saveCustomerMetaToken).not.toHaveBeenCalled();
      expect(result).toEqual({
        ok: false,
        message: "Only the account owner can manage source access.",
      });
    },
  );

  it("creates a customer API key and returns the one-time secret", async () => {
    const createCustomerApiKey = vi.fn().mockResolvedValue({
      secret: ["f9", "live", "full_secret"].join("_"),
      apiKey: {
        keyPrefix: ["f9", "live", "full"].join("_"),
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
      apiKeySecret: ["f9", "live", "full_secret"].join("_"),
      apiKeyPrefix: ["f9", "live", "full"].join("_"),
    });
  });

  it("keeps legacy sources API-key posts action-compatible", async () => {
    const createCustomerApiKey = vi.fn().mockResolvedValue({
      secret: ["f9", "live", "legacy_secret"].join("_"),
      apiKey: {
        keyPrefix: ["f9", "live", "legacy"].join("_"),
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
      apiKeySecret: ["f9", "live", "legacy_secret"].join("_"),
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

  it("rejects Slack webhook save when GA surface is off", async () => {
    vi.resetModules();
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

    const formData = new FormData();
    formData.set("intent", "save-slack-webhook");
    formData.set("slackWebhookUrl", fakeSlackWebhookUrl());
    formData.set("slackDestinationName", "Sales");

    const { action } = await import("~/routes/app.notifications");
    const result = await action({
      context: {},
      request: new Request("https://0509.io/app/notifications", { method: "POST", body: formData }),
    } as never);

    expect(result).toEqual({
      ok: false,
      message: "Slack delivery is not available at general availability yet. Use email delivery.",
    });
  });

  it("returns only safe delivery target fields from the notifications loader", async () => {
    const { isSlackDeliveryCustomerFacing, isWhatsAppDeliveryCustomerFacing } = await import("~/lib/ga-customer-surface");
    vi.mocked(isSlackDeliveryCustomerFacing).mockReturnValue(true);
    vi.mocked(isWhatsAppDeliveryCustomerFacing).mockReturnValue(true);

    const listDeliveryTargets = vi.fn(async (_env: unknown, _userId: string, options: { channel: string }) => {
      if (options.channel === "slack") {
        return [
          {
            id: "slack-target-1",
            channel: "slack",
            targetValue: "https://hooks.slack.com/services/T/B/SECRET",
            validationStatus: "validated",
            isValidated: true,
            isOptedIn: true,
            isPaused: false,
            optedOutAt: null,
            templateEligible: true,
            lastSuccessfulDeliveryAt: "2026-06-06T00:00:00.000Z",
            providerIdentifier: "SECRET",
            metadata: { displayName: "Growth alerts" },
            createdAt: "2026-06-01T00:00:00.000Z",
          },
        ];
      }

      return [
        {
          id: "whatsapp-target-1",
          channel: "whatsapp",
          targetValue: "+919999999999",
          validationStatus: "validated",
          isValidated: true,
          isOptedIn: true,
          isPaused: false,
          optedOutAt: null,
          templateEligible: true,
          lastSuccessfulDeliveryAt: "2026-06-07T00:00:00.000Z",
          providerIdentifier: "whatsapp-secret",
          metadata: { displayName: "Founder phone" },
          createdAt: "2026-06-02T00:00:00.000Z",
        },
      ];
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
    vi.doMock("~/lib/data.server", () => ({
      listDeliveryTargets,
    }));
    vi.doMock("~/lib/env.server", () => ({
      isCustomerWhatsAppReady: vi.fn().mockReturnValue(true),
      isWhatsAppProviderConfigured: vi.fn().mockReturnValue(true),
      isWhatsAppWebhookConfigured: vi.fn().mockReturnValue(true),
    }));
    vi.doMock("~/lib/slack.server", () => ({
      slackTargetDisplayName: vi.fn((target) => target.metadata.displayName),
    }));
    vi.doMock("~/lib/whatsapp.server", () => ({
      whatsappTargetDisplayName: vi.fn((target) => target.metadata.displayName),
    }));

    const { loader } = await import("~/routes/app.notifications");
    const result = await loader({
      context: createContext({ DB: {} }),
      request: new Request("http://localhost/app/notifications"),
    } as never);

    expect(result).toEqual({
      emailDeliveryReady: true,
      showSlackDelivery: true,
      canManageWhatsAppDelivery: true,
      slackTargets: [
        {
          id: "slack-target-1",
          displayName: "Growth alerts",
          isPaused: false,
          lastSuccessfulDeliveryAt: "2026-06-06T00:00:00.000Z",
          createdAt: "2026-06-01T00:00:00.000Z",
        },
      ],
      whatsappTargets: [
        {
          id: "whatsapp-target-1",
          displayName: "Founder phone",
          isPaused: false,
          validationStatus: "validated",
          templateEligible: true,
          lastSuccessfulDeliveryAt: "2026-06-07T00:00:00.000Z",
          createdAt: "2026-06-02T00:00:00.000Z",
        },
      ],
      whatsappDelivery: {
        providerConfigured: true,
        customerReady: true,
        webhookConfigured: true,
        configuredTargets: 1,
        usableTargets: 1,
        lastSuccessfulDeliveryAt: "2026-06-07T00:00:00.000Z",
      },
    });
    expect(JSON.stringify(result)).not.toContain("hooks.slack.com");
    expect(JSON.stringify(result)).not.toContain("+919999999999");
    expect(JSON.stringify(result)).not.toContain("whatsapp-secret");
  });

  it.each([
    "save-slack-webhook",
    "save-whatsapp-target",
    "pause-slack-webhook",
    "resume-slack-webhook",
  ])("blocks workspace members from managing notification intent %s", async (intent) => {
    const pauseSlackWebhookTarget = vi.fn();
    const resumeSlackWebhookTarget = vi.fn();
    const saveSlackWebhookTarget = vi.fn();
    const saveWhatsAppDeliveryTarget = vi.fn();

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
    vi.doMock("~/lib/slack.server", () => ({
      pauseSlackWebhookTarget,
      resumeSlackWebhookTarget,
      saveSlackWebhookTarget,
    }));
    vi.doMock("~/lib/whatsapp.server", () => ({
      saveWhatsAppDeliveryTarget,
    }));

    const { action } = await import("~/routes/app.notifications");
    const formData = new FormData();
    formData.set("intent", intent);
    formData.set("slackWebhookUrl", fakeSlackWebhookUrl());
    formData.set("slackDestinationName", "Sales");
    formData.set("whatsappTargetValue", "+919999999999");
    formData.set("whatsappDestinationName", "Sales");
    formData.set("slackTargetId", "slack-target-1");

    const result = await action({
      context: createContext({ DB: {} }),
      request: new Request("http://localhost/app/notifications", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(pauseSlackWebhookTarget).not.toHaveBeenCalled();
    expect(resumeSlackWebhookTarget).not.toHaveBeenCalled();
    expect(saveSlackWebhookTarget).not.toHaveBeenCalled();
    expect(saveWhatsAppDeliveryTarget).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      message: "Only the account owner can manage notification delivery targets.",
    });
  });

  it("keeps legacy sources notification posts action-compatible", async () => {
    const { isSlackDeliveryCustomerFacing } = await import("~/lib/ga-customer-surface");
    vi.mocked(isSlackDeliveryCustomerFacing).mockReturnValue(true);

    const saveSlackWebhookTarget = vi.fn().mockResolvedValue({
      id: "slack-target-1",
    });
    const upsertWorkspaceDeliveryConfig = vi.fn();

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
    vi.doMock("~/lib/slack.server", () => ({
      saveSlackWebhookTarget,
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue(null),
      legacyWorkspaceDeliveryDefaults: vi.fn().mockReturnValue({
        sensitivityMode: "balanced",
        instantEnabled: false,
        digestEnabled: true,
        emailEnabled: true,
        whatsappEnabled: false,
        slackEnabled: false,
      }),
      upsertWorkspaceDeliveryConfig,
    }));

    const { action } = await import("~/routes/app.sources");
    const webhookUrl = fakeSlackWebhookUrl();
    const formData = new FormData();
    formData.set("intent", "save-slack-webhook");
    formData.set("slackWebhookUrl", webhookUrl);
    formData.set("slackDestinationName", "Legacy alerts");

    const result = await action({
      context: createContext({ DB: {} }),
      request: new Request("http://localhost/app/sources", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(saveSlackWebhookTarget).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      webhookUrl,
      name: "Legacy alerts",
    });
    expect(upsertWorkspaceDeliveryConfig).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      userId: "user-1",
      slackEnabled: true,
    }));
    expect(result).toMatchObject({ ok: true });
  });

  it("saves a Slack webhook target", async () => {
    const { isSlackDeliveryCustomerFacing } = await import("~/lib/ga-customer-surface");
    vi.mocked(isSlackDeliveryCustomerFacing).mockReturnValue(true);

    const saveSlackWebhookTarget = vi.fn().mockResolvedValue({
      id: "slack-target-1",
    });
    const upsertWorkspaceDeliveryConfig = vi.fn();

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
    vi.doMock("~/lib/slack.server", () => ({
      saveSlackWebhookTarget,
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
        id: "workspace-1",
        userId: "user-1",
        sensitivityMode: "balanced",
        instantEnabled: false,
        digestEnabled: true,
        emailEnabled: true,
        whatsappEnabled: false,
        slackEnabled: false,
        quietHours: null,
        timezone: "Asia/Kolkata",
        createdAt: "2026-06-06T00:00:00.000Z",
        updatedAt: "2026-06-06T00:00:00.000Z",
      }),
      legacyWorkspaceDeliveryDefaults: vi.fn().mockReturnValue({
        sensitivityMode: "balanced",
        instantEnabled: false,
        digestEnabled: true,
        emailEnabled: true,
        whatsappEnabled: false,
        slackEnabled: false,
      }),
      upsertWorkspaceDeliveryConfig,
    }));

    const { action } = await import("~/routes/app.notifications");
    const webhookUrl = fakeSlackWebhookUrl();
    const formData = new FormData();
    formData.set("intent", "save-slack-webhook");
    formData.set("slackWebhookUrl", webhookUrl);
    formData.set("slackDestinationName", "Growth alerts");

    const result = await action({
      context: createContext({ DB: {} }),
      request: new Request("http://localhost/app/notifications", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(saveSlackWebhookTarget).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      webhookUrl,
      name: "Growth alerts",
    });
    expect(upsertWorkspaceDeliveryConfig).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      sensitivityMode: "balanced",
      instantEnabled: false,
      digestEnabled: true,
      emailEnabled: true,
      whatsappEnabled: false,
      slackEnabled: true,
      quietHours: null,
      timezone: "Asia/Kolkata",
    });
    expect(result).toEqual({
      ok: true,
      message:
        "Slack delivery connected. Slack accepted the setup test, and future eligible digests can post to that channel.",
    });
  });

  it("returns a form error when Slack rejects setup validation", async () => {
    const { isSlackDeliveryCustomerFacing } = await import("~/lib/ga-customer-surface");
    vi.mocked(isSlackDeliveryCustomerFacing).mockReturnValue(true);

    const saveSlackWebhookTarget = vi.fn().mockRejectedValue(
      new Response("Slack did not accept the test message.", { status: 400 }),
    );

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
    vi.doMock("~/lib/slack.server", () => ({
      saveSlackWebhookTarget,
    }));

    const { action } = await import("~/routes/app.notifications");
    const formData = new FormData();
    formData.set("intent", "save-slack-webhook");
    formData.set("slackWebhookUrl", "https://hooks.slack.com/services/T/B/C");
    formData.set("slackDestinationName", "Growth alerts");

    const result = await action({
      context: createContext({ DB: {} }),
      request: new Request("http://localhost/app/notifications", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      message: "Slack did not accept the test message.",
    });
  });

  it("blocks WhatsApp delivery setup while WhatsApp is not customer-facing", async () => {
    const saveWhatsAppDeliveryTarget = vi.fn().mockResolvedValue({
      id: "whatsapp-target-1",
    });
    const upsertWorkspaceDeliveryConfig = vi.fn();

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
    vi.doMock("~/lib/whatsapp.server", () => ({
      saveWhatsAppDeliveryTarget,
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
        id: "workspace-1",
        userId: "user-1",
        sensitivityMode: "balanced",
        instantEnabled: false,
        digestEnabled: true,
        emailEnabled: true,
        whatsappEnabled: false,
        slackEnabled: true,
        quietHours: null,
        timezone: "Asia/Kolkata",
        createdAt: "2026-06-06T00:00:00.000Z",
        updatedAt: "2026-06-06T00:00:00.000Z",
      }),
      legacyWorkspaceDeliveryDefaults: vi.fn().mockReturnValue({
        sensitivityMode: "balanced",
        instantEnabled: false,
        digestEnabled: true,
        emailEnabled: true,
        whatsappEnabled: false,
        slackEnabled: false,
      }),
      upsertWorkspaceDeliveryConfig,
    }));

    const { action } = await import("~/routes/app.notifications");
    const formData = new FormData();
    formData.set("intent", "save-whatsapp-target");
    formData.set("whatsappTargetValue", "+919876543210");
    formData.set("whatsappDestinationName", "Founder phone");
    formData.set("whatsappExplicitOptIn", "yes");

    const result = await action({
      context: createContext({ DB: {} }),
      request: new Request("http://localhost/app/notifications", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(saveWhatsAppDeliveryTarget).not.toHaveBeenCalled();
    expect(upsertWorkspaceDeliveryConfig).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      message: "WhatsApp delivery is not available at general availability yet. Use email delivery.",
    });
  });

  it("does not reach WhatsApp validation while WhatsApp is not customer-facing", async () => {
    const saveWhatsAppDeliveryTarget = vi.fn().mockRejectedValue(
      new Response("WhatsApp provider is not configured for this environment.", { status: 400 }),
    );

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
    vi.doMock("~/lib/whatsapp.server", () => ({
      saveWhatsAppDeliveryTarget,
    }));

    const { action } = await import("~/routes/app.notifications");
    const formData = new FormData();
    formData.set("intent", "save-whatsapp-target");
    formData.set("whatsappTargetValue", "+919876543210");
    formData.set("whatsappDestinationName", "Founder phone");

    const result = await action({
      context: createContext({ DB: {} }),
      request: new Request("http://localhost/app/notifications", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      message: "WhatsApp delivery is not available at general availability yet. Use email delivery.",
    });
    expect(saveWhatsAppDeliveryTarget).not.toHaveBeenCalled();
  });

  it("pauses a Slack webhook target", async () => {
    const { isSlackDeliveryCustomerFacing } = await import("~/lib/ga-customer-surface");
    vi.mocked(isSlackDeliveryCustomerFacing).mockReturnValue(true);

    const pauseSlackWebhookTarget = vi.fn().mockResolvedValue(true);

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
    vi.doMock("~/lib/slack.server", () => ({
      pauseSlackWebhookTarget,
    }));

    const { action } = await import("~/routes/app.notifications");
    const formData = new FormData();
    formData.set("intent", "pause-slack-webhook");
    formData.set("slackTargetId", "slack-target-1");

    const result = await action({
      context: createContext({ DB: {} }),
      request: new Request("http://localhost/app/notifications", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(pauseSlackWebhookTarget).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      targetId: "slack-target-1",
    });
    expect(result).toEqual({
      ok: true,
      message: "Slack delivery paused.",
    });
  });

  it("resumes a Slack webhook target", async () => {
    const { isSlackDeliveryCustomerFacing } = await import("~/lib/ga-customer-surface");
    vi.mocked(isSlackDeliveryCustomerFacing).mockReturnValue(true);

    const resumeSlackWebhookTarget = vi.fn().mockResolvedValue(true);

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
    vi.doMock("~/lib/slack.server", () => ({
      resumeSlackWebhookTarget,
    }));

    const { action } = await import("~/routes/app.notifications");
    const formData = new FormData();
    formData.set("intent", "resume-slack-webhook");
    formData.set("slackTargetId", "slack-target-1");

    const result = await action({
      context: createContext({ DB: {} }),
      request: new Request("http://localhost/app/notifications", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(resumeSlackWebhookTarget).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      targetId: "slack-target-1",
    });
    expect(result).toEqual({
      ok: true,
      message: "Slack delivery resumed.",
    });
  });
});

describe("workspace settings route components", () => {
  it("renders the legacy sources compatibility hub", async () => {
    await mockRouter(null);

    const { default: SourcesCompatibilityRoute } = await import("~/routes/app.sources");
    const markup = renderToStaticMarkup(createElement(SourcesCompatibilityRoute));

    expect(markup).toContain("Workspace settings");
    expect(markup).toContain("Open notifications");
    expect(markup).toContain("Open source access");
    expect(markup).toContain("Open developer access");
  });

  it("renders source access without developer or notification setup", async () => {
    await mockRouter({
      connection: null,
      discoveryStatus,
    });

    const { default: SourceAccessRoute } = await import("~/routes/app.source-access");
    const markup = renderToStaticMarkup(createElement(SourceAccessRoute));

    expect(markup).toContain("Source access");
    expect(markup).toContain("Backup Meta access and tracking reliability");
    expect(markup).toContain("Tracking status");
    expect(markup).not.toContain("Meta coverage is beta");
    expect(markup).not.toContain("f9-beta-pill");
    expect(markup).toContain("Test and save access");
    expect(markup).toContain("Ad Library API page");
    expect(markup).not.toContain("Recent tracking health");
    expect(markup).not.toContain("Create API key");
    expect(markup).not.toContain("Slack delivery");
    expect(markup).toContain("recent results are available");
    expect(markup).not.toContain("Cached live results");
  });

  it("renders developer access without source-token or delivery setup", async () => {
    await mockRouter({
      apiKeys: [],
    });

    const { default: DeveloperAccessRoute } = await import("~/routes/app.developer-access");
    const markup = renderToStaticMarkup(createElement(DeveloperAccessRoute));

    expect(markup).toContain("Developer access");
    expect(markup).toContain("Connect exports and approved actions");
    expect(markup).toContain("Tool setup");
    expect(markup).toContain("Create a read key");
    expect(markup).toContain("Enable write access only when needed");
    expect(markup).toContain("Review and revoke keys");
    expect(markup).toContain("Create API key");
    expect(markup).toContain("Allow approved account actions");
    expect(markup).toContain("/api/v1/watchlists/");
    expect(markup).not.toContain("Ad Library API page");
    expect(markup).not.toContain("Slack delivery");
    expect(markup).not.toContain("Sensitive changes");
    expect(markup).not.toContain("POST /api/mcp");
  });

  it("renders notifications without source-token or API-key setup", async () => {
    await mockRouter({
      emailDeliveryReady: true,
      showSlackDelivery: false,
      canManageWhatsAppDelivery: false,
      slackTargets: [],
      whatsappTargets: [],
      whatsappDelivery: {
        providerConfigured: false,
        customerReady: false,
        webhookConfigured: false,
        configuredTargets: 3,
        usableTargets: 0,
        lastSuccessfulDeliveryAt: null,
      },
    });

    const { default: NotificationsRoute } = await import("~/routes/app.notifications");
    const markup = renderToStaticMarkup(createElement(NotificationsRoute));

    expect(markup).toContain("Notifications");
    expect(markup).toContain("Email digest delivery and alert channels");
    expect(markup).toContain("Digest and alert delivery");
    expect(markup).toContain("Open watchlists");
    expect(markup).not.toContain("Ad Library API page");
    expect(markup).not.toContain("Test and save access");
    expect(markup).not.toContain("Create API key");
    expect(markup).not.toContain("Save Slack delivery");
    expect(markup).not.toContain("WhatsApp delivery");
    expect(markup).not.toContain("WhatsApp delivery is enabled for this account");
    expect(markup).not.toContain("WhatsApp is not available for this account yet");
    expect(markup).not.toContain("Save WhatsApp delivery");
    expect(markup).not.toContain("Delivery confirmation");
    expect(markup).not.toContain("0/3 usable");
    expect(markup).not.toContain("No successful send yet");
  });
});
