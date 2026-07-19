import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/plan.server", () => ({
  getUserPlan: vi.fn().mockResolvedValue("agency"),
  getEffectiveWorkspacePlan: vi.fn().mockResolvedValue("agency"),
  checkPlanLimit: vi
    .fn()
    .mockResolvedValue({ allowed: true, limit: 75, current: 1 }),
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

const discoveryStatus = {
  status: "cache_only",
  provider: "meta_library_browser",
  mode: "cache",
  summary:
    "Cached live results are available, but fresh discovery is degraded.",
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

beforeEach(() => {
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
      resolveCommercialAdSourceStatus: vi
        .fn()
        .mockResolvedValue(discoveryStatus),
    }));
    const listDeliveryTargets = vi.fn(
      async (_env: unknown, _userId: string, options: { channel: string }) => {
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
      },
    );

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
          keyPrefix: "example-key-prefix",
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
      discoveryStatus: {
        status: "cache_only",
        summary: expect.stringContaining("showing your most recent results"),
        recovery: "Check source access, then retry once it's ready.",
      },
      canManageSourceAccess: true,
    });
    expect(JSON.stringify(result)).not.toContain("+919999999999");
    expect(JSON.stringify(result)).not.toContain("example-key-prefix");
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
      message: "Backup source access is connected and ready.",
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

    expect(saveCustomerMetaToken).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "EAABlegacytoken",
    );
    expect(result).toEqual({
      ok: true,
      message: "Backup source access is connected and ready.",
    });
  });

  it("returns closed customer-safe action copy for raw provider failures", async () => {
    const saveCustomerMetaToken = vi.fn().mockResolvedValue({
      ok: false,
      testResult: {
        ok: false,
        status: "degraded",
        errorCode: "RAW_ACTION_ERROR_CODE_SENTINEL",
        summary: "RAW_ACTION_SUMMARY_SENTINEL",
      },
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        workspaceUserId: "user-1",
        isMember: false,
      }),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
    vi.doMock("~/lib/customer-meta.server", () => ({
      disconnectCustomerMetaToken: vi.fn(),
      retestSavedCustomerMetaToken: vi.fn(),
      saveCustomerMetaToken,
    }));

    const { action } = await import("~/routes/app.source-access");
    const formData = new FormData();
    formData.set("intent", "connect-meta-token");
    formData.set("metaToken", "EAABraw-action-token");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/source-access", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      message:
        "Source access could not be verified. Check the token and try again.",
    });
    expect(JSON.stringify(result)).not.toContain("RAW_ACTION");
  });

  it("does not load or return owner token metadata for workspace members", async () => {
    const getCustomerMetaConnection = vi.fn().mockResolvedValue({
      status: "healthy",
      tokenLastFour: "9876",
      summary: "RAW_MEMBER_CONNECTION_SENTINEL",
      lastCheckedAt: null,
      updatedAt: "2026-07-15T00:00:00.000Z",
    });
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        workspaceUserId: "owner-1",
        isMember: true,
      }),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
    vi.doMock("~/lib/ad-source.server", () => ({
      resolveCommercialAdSourceStatus: vi
        .fn()
        .mockResolvedValue(discoveryStatus),
    }));
    vi.doMock("~/lib/data.server", () => ({ getCustomerMetaConnection }));

    const { loader } = await import("~/routes/app.source-access");
    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app/source-access"),
    } as never);

    expect(getCustomerMetaConnection).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      connection: null,
      canManageSourceAccess: false,
    });
    expect(JSON.stringify(result)).not.toContain("9876");
    expect(JSON.stringify(result)).not.toContain("RAW_MEMBER_CONNECTION");
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
});
