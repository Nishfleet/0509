import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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

function fakeSlackWebhookUrl() {
  return new URL(["services", "TSTUB", "BSTUB", "short"].join("/"), "https://hooks.slack.com/").toString();
}

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

async function mockRouter(loaderData: unknown, actionData?: unknown) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) => React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useActionData: vi.fn().mockReturnValue(actionData),
      useLoaderData: vi.fn().mockReturnValue(loaderData),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
    };
  });
}

beforeEach(async () => {
  vi.resetModules();
  const { isSlackDeliveryCustomerFacing, isWhatsAppDeliveryCustomerFacing } = await import("~/lib/ga-customer-surface");
  vi.mocked(isSlackDeliveryCustomerFacing).mockReturnValue(false);
  vi.mocked(isWhatsAppDeliveryCustomerFacing).mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});


describe("notifications route", () => {
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
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue(null),
      legacyWorkspaceDeliveryDefaults: vi.fn(() => ({
        sensitivityMode: "balanced",
        instantEnabled: true,
        digestEnabled: true,
        digestCadencePreference: "plan_default",
        emailEnabled: true,
        whatsappEnabled: false,
        slackEnabled: false,
      })),
      upsertWorkspaceDeliveryConfig: vi.fn().mockResolvedValue(null),
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
      digestCadencePreference: "plan_default",
      showSlackDelivery: true,
      slackDelivery: {
        plan: "agency",
        entitled: true,
      },
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

  it.each(["free", "scout"] as const)(
    "returns effective non-entitled Slack access while retaining legacy target metadata for %s",
    async (plan) => {
      vi.resetModules();
      vi.doMock("~/lib/auth.server", () => ({
        requireWorkspaceSession: vi.fn().mockResolvedValue({
          session,
          workspaceUserId: session.user.id,
          isMember: false,
          ownerName: null,
        }),
      }));
      vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({ DB: {} })) }));
      vi.doMock("~/lib/plan.server", () => ({
        getUserPlan: vi.fn().mockResolvedValue("agency"),
        getEffectiveWorkspacePlan: vi.fn().mockResolvedValue(plan),
      }));
      vi.doMock("~/lib/ga-customer-surface", () => ({
        isSlackDeliveryCustomerFacing: vi.fn(() => true),
        isWhatsAppDeliveryCustomerFacing: vi.fn(() => false),
        slackDeliveryUnavailableMessage: vi.fn(
          () => "Slack delivery is not available at general availability yet. Use email delivery.",
        ),
        whatsappDeliveryUnavailableMessage: vi.fn(
          () => "WhatsApp delivery is not available at general availability yet. Use email delivery.",
        ),
      }));
      vi.doMock("~/lib/data.server", () => ({
        getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue(null),
        legacyWorkspaceDeliveryDefaults: vi.fn(() => ({
          sensitivityMode: "balanced",
          instantEnabled: true,
          digestEnabled: true,
          digestCadencePreference: "plan_default",
          emailEnabled: true,
          whatsappEnabled: false,
          slackEnabled: false,
        })),
        upsertWorkspaceDeliveryConfig: vi.fn().mockResolvedValue(null),
        listDeliveryTargets: vi.fn().mockResolvedValue([
          {
            id: "legacy-slack-1",
            channel: "slack",
            targetValue: "https://hooks.slack.com/services/SECRET",
            validationStatus: "validated",
            isValidated: true,
            isOptedIn: true,
            isPaused: true,
            optedOutAt: null,
            templateEligible: true,
            lastSuccessfulDeliveryAt: null,
            metadata: { displayName: "Legacy growth alerts" },
            createdAt: "2026-06-01T00:00:00.000Z",
          },
        ]),
      }));
      vi.doMock("~/lib/env.server", () => ({
        isCustomerWhatsAppReady: vi.fn(() => false),
        isWhatsAppProviderConfigured: vi.fn(() => false),
        isWhatsAppWebhookConfigured: vi.fn(() => false),
      }));
      vi.doMock("~/lib/slack.server", () => ({
        slackTargetDisplayName: vi.fn((target) => target.metadata.displayName),
      }));
      vi.doMock("~/lib/whatsapp.server", () => ({
        whatsappTargetDisplayName: vi.fn(() => "Legacy WhatsApp target"),
      }));

      const { loader } = await import("~/routes/app.notifications");
      const result = await loader({
        context: createContext({ DB: {} }),
        request: new Request("http://localhost/app/notifications"),
      } as never);

      expect(result.slackDelivery).toEqual({ plan, entitled: false });
      expect(result.slackTargets).toEqual([
        expect.objectContaining({ id: "legacy-slack-1", displayName: "Legacy growth alerts", isPaused: true }),
      ]);
      expect(JSON.stringify(result)).not.toContain("hooks.slack.com");
    },
  );

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

  it.each(["free", "scout"] as const)(
    "keeps %s Slack setup read-only while preserving legacy target metadata",
    async (plan) => {
      await mockRouter({
        emailDeliveryReady: true,
        showSlackDelivery: true,
        slackDelivery: { plan, entitled: false },
        canManageWhatsAppDelivery: false,
        slackTargets: [
          {
            id: "legacy-slack-1",
            displayName: "Legacy growth alerts",
            isPaused: true,
            lastSuccessfulDeliveryAt: "2026-06-07T00:00:00.000Z",
            createdAt: "2026-06-01T00:00:00.000Z",
          },
        ],
        whatsappTargets: [],
        whatsappDelivery: {
          providerConfigured: false,
          customerReady: false,
          webhookConfigured: false,
          configuredTargets: 0,
          usableTargets: 0,
          lastSuccessfulDeliveryAt: null,
        },
      });

      const { default: NotificationsRoute } = await import("~/routes/app.notifications");
      const markup = renderToStaticMarkup(createElement(NotificationsRoute));

      expect(markup).toContain("Slack delivery is included in Starter and Agency plans.");
      expect(markup).toContain("Slack controls are locked on this plan");
      expect(markup).toContain("View plans");
      expect(markup.match(/View plans/g)).toHaveLength(1);
      expect(markup).toContain("f9-nt-lock");
      expect(markup).not.toContain("f9-ed-specimen");
      expect(markup).toContain("Legacy growth alerts");
      expect(markup).toContain("Paused");
      expect(markup).not.toContain("slackWebhookUrl");
      expect(markup).not.toContain("Save Slack delivery");
      expect(markup).not.toContain("value=\"pause-slack-webhook\"");
      expect(markup).not.toContain("value=\"resume-slack-webhook\"");
    },
  );

  it("keeps the entitled Slack setup flow unchanged", async () => {
    await mockRouter({
      emailDeliveryReady: true,
      digestCadencePreference: "plan_default",
      showSlackDelivery: true,
      slackDelivery: { plan: "starter", entitled: true },
      canManageWhatsAppDelivery: false,
      slackTargets: [
        {
          id: "slack-target-1",
          displayName: "Growth alerts",
          isPaused: false,
          lastSuccessfulDeliveryAt: null,
          createdAt: "2026-06-01T00:00:00.000Z",
        },
        {
          id: "slack-target-2",
          displayName: "Founder alerts",
          isPaused: true,
          lastSuccessfulDeliveryAt: "2026-06-02T00:00:00.000Z",
          createdAt: "2026-06-01T00:00:00.000Z",
        },
      ],
      whatsappTargets: [],
      whatsappDelivery: {
        providerConfigured: false,
        customerReady: false,
        webhookConfigured: false,
        configuredTargets: 0,
        usableTargets: 0,
        lastSuccessfulDeliveryAt: null,
      },
    });

    const { default: NotificationsRoute } = await import("~/routes/app.notifications");
    const markup = renderToStaticMarkup(createElement(NotificationsRoute));

    expect(markup).toContain("name=\"slackWebhookUrl\"");
    expect(markup).toContain("Save Slack delivery");
    expect(markup).toContain("value=\"pause-slack-webhook\"");
    expect(markup).toContain("value=\"resume-slack-webhook\"");
    expect(markup).toContain("Founder alerts");
    expect(markup).toContain("Paused");
  });

  it("renders the GA surface as three quiet ruled channel definitions", async () => {
    await mockRouter({
      emailDeliveryReady: true,
      digestCadencePreference: "plan_default",
      showSlackDelivery: false,
      slackDelivery: { plan: "starter", entitled: true },
      canManageWhatsAppDelivery: false,
      slackTargets: [],
      whatsappTargets: [],
      whatsappDelivery: {
        providerConfigured: false,
        customerReady: false,
        webhookConfigured: false,
        configuredTargets: 0,
        usableTargets: 0,
        lastSuccessfulDeliveryAt: null,
      },
    });

    const { default: NotificationsRoute } = await import("~/routes/app.notifications");
    const markup = renderToStaticMarkup(createElement(NotificationsRoute));

    expect(markup).toContain("f9-wk-page f9-nt-page");
    expect(markup).toContain("Delivery channels");
    expect(markup.match(/f9-nt-definition-row/g)).toHaveLength(3);
    expect(markup).toContain("Digest delivery can use the account email.");
    expect(markup).toContain(
      "Slack delivery is not available at general availability yet. Use email delivery.",
    );
    expect(markup).toContain(
      "WhatsApp delivery is not available at general availability yet. Use email delivery.",
    );
    expect(markup).toContain("Quiet hours");
    expect(markup).toContain("Recipients");
    expect(markup).toContain("name=\"digestCadencePreference\"");
    expect(markup).not.toContain("f9-app-panel");
    expect(markup).not.toContain("f9-status-strip");
    expect(markup).not.toContain("Save Slack delivery");
    expect(markup).not.toContain("Save WhatsApp delivery");
  });

  it("keeps missing-email delivery honest and points to the account", async () => {
    await mockRouter({
      emailDeliveryReady: false,
      digestCadencePreference: "weekly_only",
      showSlackDelivery: false,
      slackDelivery: { plan: "free", entitled: false },
      canManageWhatsAppDelivery: false,
      slackTargets: [],
      whatsappTargets: [],
      whatsappDelivery: {
        providerConfigured: false,
        customerReady: false,
        webhookConfigured: false,
        configuredTargets: 0,
        usableTargets: 0,
        lastSuccessfulDeliveryAt: null,
      },
    });

    const { default: NotificationsRoute } = await import("~/routes/app.notifications");
    const markup = renderToStaticMarkup(createElement(NotificationsRoute));

    expect(markup).toContain("Needs email");
    expect(markup).toContain("Add an account email first.");
    expect(markup).toContain("No account email is ready, so email delivery cannot start yet.");
    expect(markup).toContain("href=\"/app/account\"");
    expect(markup).toContain("value=\"weekly_only\" selected");
  });

  it("renders action outcomes through the single workspace feedback strip", async () => {
    await mockRouter(
      {
        emailDeliveryReady: true,
        digestCadencePreference: "plan_default",
        showSlackDelivery: false,
        slackDelivery: { plan: "starter", entitled: true },
        canManageWhatsAppDelivery: false,
        slackTargets: [],
        whatsappTargets: [],
        whatsappDelivery: {
          providerConfigured: false,
          customerReady: false,
          webhookConfigured: false,
          configuredTargets: 0,
          usableTargets: 0,
          lastSuccessfulDeliveryAt: null,
        },
      },
      { ok: false, message: "Frequency could not be saved." },
    );

    const { default: NotificationsRoute } = await import("~/routes/app.notifications");
    const markup = renderToStaticMarkup(createElement(NotificationsRoute));

    expect(markup).toContain("f9-wk-strip is-bad");
    expect(markup).toContain("role=\"alert\"");
    expect(markup).toContain("Not saved");
    expect(markup).toContain("Frequency could not be saved.");
    expect(markup).not.toContain("f9-message");
  });

  it("renders customer-facing WhatsApp setup and recipient truth without changing its actions", async () => {
    const { isWhatsAppDeliveryCustomerFacing } = await import("~/lib/ga-customer-surface");
    vi.mocked(isWhatsAppDeliveryCustomerFacing).mockReturnValue(true);
    await mockRouter({
      emailDeliveryReady: true,
      digestCadencePreference: "plan_default",
      showSlackDelivery: false,
      slackDelivery: { plan: "agency", entitled: true },
      canManageWhatsAppDelivery: true,
      slackTargets: [],
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
        {
          id: "whatsapp-target-2",
          displayName: "Growth lead phone",
          isPaused: false,
          validationStatus: "pending",
          templateEligible: false,
          lastSuccessfulDeliveryAt: null,
          createdAt: "2026-06-03T00:00:00.000Z",
        },
      ],
      whatsappDelivery: {
        providerConfigured: true,
        customerReady: true,
        webhookConfigured: true,
        configuredTargets: 2,
        usableTargets: 1,
        lastSuccessfulDeliveryAt: "2026-06-07T00:00:00.000Z",
      },
    });

    const { default: NotificationsRoute } = await import("~/routes/app.notifications");
    const markup = renderToStaticMarkup(createElement(NotificationsRoute));

    expect(markup).toContain("WhatsApp delivery is enabled for this account.");
    expect(markup).toContain("name=\"whatsappDestinationName\"");
    expect(markup).toContain("name=\"whatsappTargetValue\"");
    expect(markup).toContain("name=\"whatsappExplicitOptIn\"");
    expect(markup).toContain("Save WhatsApp delivery");
    expect(markup).toContain("Founder phone");
    expect(markup).toContain("Template-ready");
    expect(markup).toContain("Growth lead phone");
    expect(markup).toContain("Needs validation");
    expect(markup).toContain("no successful send yet");
    expect(markup).toContain("1 of 2 configured recipients can receive updates.");
    expect(markup).not.toContain(
      "WhatsApp delivery is not available at general availability yet.",
    );
  });

  it("states the customer-facing WhatsApp setup barrier when account checks are incomplete", async () => {
    const { isWhatsAppDeliveryCustomerFacing } = await import("~/lib/ga-customer-surface");
    vi.mocked(isWhatsAppDeliveryCustomerFacing).mockReturnValue(true);
    await mockRouter({
      emailDeliveryReady: true,
      digestCadencePreference: "plan_default",
      showSlackDelivery: false,
      slackDelivery: { plan: "agency", entitled: true },
      canManageWhatsAppDelivery: false,
      slackTargets: [],
      whatsappTargets: [],
      whatsappDelivery: {
        providerConfigured: true,
        customerReady: false,
        webhookConfigured: false,
        configuredTargets: 0,
        usableTargets: 0,
        lastSuccessfulDeliveryAt: null,
      },
    });

    const { default: NotificationsRoute } = await import("~/routes/app.notifications");
    const markup = renderToStaticMarkup(createElement(NotificationsRoute));

    expect(markup).toContain("Setup not ready");
    expect(markup).toContain("WhatsApp setup is not ready for this account.");
    expect(markup).not.toContain("name=\"whatsappTargetValue\"");
  });

  it.each(["free", "scout"] as const)(
    "rejects every Slack mutation intent for %s before provider or persistence calls",
    async (plan) => {
      vi.resetModules();
      const saveSlackWebhookTarget = vi.fn();
      const pauseSlackWebhookTarget = vi.fn();
      const resumeSlackWebhookTarget = vi.fn();
      const getWorkspaceDeliveryConfig = vi.fn();
      const upsertWorkspaceDeliveryConfig = vi.fn();

      vi.doMock("~/lib/auth.server", () => ({
        requireSession: vi.fn().mockResolvedValue(session),
        requireWorkspaceSession: vi.fn().mockResolvedValue({
          session,
          workspaceUserId: session.user.id,
          isMember: false,
          ownerName: null,
        }),
      }));
      vi.doMock("~/lib/context.server", () => ({
        getEnv: vi.fn(() => ({ DB: {} })),
      }));
      vi.doMock("~/lib/ga-customer-surface", () => ({
        isSlackDeliveryCustomerFacing: vi.fn(() => true),
        isWhatsAppDeliveryCustomerFacing: vi.fn(() => false),
        slackDeliveryUnavailableMessage: vi.fn(() => "Slack unavailable."),
        whatsappDeliveryUnavailableMessage: vi.fn(() => "WhatsApp unavailable."),
      }));
      vi.doMock("~/lib/plan.server", () => ({
        getUserPlan: vi.fn().mockResolvedValue(plan),
        getEffectiveWorkspacePlan: vi.fn().mockResolvedValue(plan),
      }));
      vi.doMock("~/lib/slack.server", () => ({
        saveSlackWebhookTarget,
        pauseSlackWebhookTarget,
        resumeSlackWebhookTarget,
      }));
      vi.doMock("~/lib/data.server", () => ({
        getWorkspaceDeliveryConfig,
        legacyWorkspaceDeliveryDefaults: vi.fn(),
        upsertWorkspaceDeliveryConfig,
      }));

      const { action } = await import("~/routes/app.notifications");
      for (const intent of ["save-slack-webhook", "pause-slack-webhook", "resume-slack-webhook"]) {
        const formData = new FormData();
        formData.set("intent", intent);
        formData.set("slackWebhookUrl", fakeSlackWebhookUrl());
        formData.set("slackDestinationName", "Sales");
        formData.set("slackTargetId", "slack-target-1");

        const result = await action({
          context: createContext({ DB: {} }),
          request: new Request("http://localhost/app/notifications", {
            method: "POST",
            body: formData,
          }),
        } as never);

        expect(result).toEqual({
          ok: false,
          message: "Slack delivery is included in Starter and Agency plans.",
        });
      }

      expect(saveSlackWebhookTarget).not.toHaveBeenCalled();
      expect(pauseSlackWebhookTarget).not.toHaveBeenCalled();
      expect(resumeSlackWebhookTarget).not.toHaveBeenCalled();
      expect(getWorkspaceDeliveryConfig).not.toHaveBeenCalled();
      expect(upsertWorkspaceDeliveryConfig).not.toHaveBeenCalled();
    },
  );
});
