import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("~/lib/plan.server", () => ({
  getUserPlan: vi.fn().mockResolvedValue("agency"),
  getEffectiveWorkspacePlan: vi.fn().mockResolvedValue("agency"),
  checkPlanLimit: vi
    .fn()
    .mockResolvedValue({ allowed: true, limit: 75, current: 1 }),
  PLAN_LIMITS: { agency: { digests: true } },
}));

vi.mock("~/lib/ga-customer-surface", () => ({
  isSlackDeliveryCustomerFacing: vi.fn(() => false),
  isSlackWebhookDeliveryCustomerFacing: vi.fn(() => true),
  isTeamsWebhookDeliveryCustomerFacing: vi.fn(() => true),
  isWhatsAppDeliveryCustomerFacing: vi.fn(() => false),
  slackDeliveryUnavailableMessage: vi.fn(
    () => "Slack delivery isn’t available. Nothing was saved — use email delivery instead.",
  ),
  whatsappDeliveryUnavailableMessage: vi.fn(
    () => "WhatsApp delivery isn’t available. Nothing was saved — use email delivery instead.",
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
  return new URL(
    ["services", "TSTUB", "BSTUB", "short"].join("/"),
    "https://hooks.slack.com/",
  ).toString();
}

function fakeTeamsWebhookUrl() {
  return new URL(
    ["webhookb2", "uuid@tenant", "IncomingWebhook", "uuid", "secret"].join("/"),
    "https://acme.webhook.office.com/",
  ).toString();
}

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<
  string,
  unknown
>;

async function mockRouter(loaderData: unknown, actionData?: unknown) {
  vi.doMock("react-router", async () => {
    const actual =
      await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement(
          "a",
          { ...props, href: typeof to === "string" ? to : "" },
          children,
        ),
      useActionData: vi.fn().mockReturnValue(actionData),
      useLoaderData: vi.fn().mockReturnValue(loaderData),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
    };
  });
}

function ownerAuthMock() {
  vi.doMock("~/lib/auth.server", () => ({
    requireWorkspaceSession: vi.fn().mockResolvedValue({
      session,
      workspaceUserId: session.user.id,
      isMember: false,
      ownerName: null,
    }),
  }));
  vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({ DB: {} })) }));
}

function digestConfigDefaults() {
  return {
    sensitivityMode: "balanced",
    instantEnabled: false,
    digestEnabled: true,
    emailEnabled: true,
    whatsappEnabled: false,
    slackEnabled: false,
    teamsEnabled: false,
  };
}

beforeEach(async () => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("notifications route (live Slack/Teams webhook surface)", () => {
  it("the loader returns the live Slack/Teams webhook delivery surface", async () => {
    ownerAuthMock();
    vi.doMock("~/lib/data.server", () => ({
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
        digestCadencePreference: "weekly_only",
      }),
      listDeliveryTargets: vi
        .fn()
        .mockResolvedValue([]),
    }));

    const { loader } = await import("~/routes/app.notifications");
    const data = await loader({
      context: createContext({ DB: {} }),
      params: {},
      request: new Request("http://localhost/app/notifications"),
    } as never);

    expect(data).toEqual({
      emailDeliveryReady: true,
      digestCadencePreference: "weekly_only",
      showSlackDelivery: true,
      showTeamsDelivery: true,
      slackDelivery: { plan: "agency", entitled: true },
      teamsDelivery: { plan: "agency", entitled: true },
      slackTargets: [],
      teamsTargets: [],
    });
  });

  it("connects a Slack webhook on Starter+ and enables Slack delivery", async () => {
    ownerAuthMock();
    const upsertWorkspaceDeliveryConfig = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue(null),
      legacyWorkspaceDeliveryDefaults: vi.fn().mockReturnValue(digestConfigDefaults()),
      upsertWorkspaceDeliveryConfig,
    }));
    vi.doMock("~/lib/slack.server", () => ({
      saveSlackWebhookTarget: vi.fn().mockResolvedValue({ id: "slack-target-1" }),
    }));

    const { action } = await import("~/routes/app.notifications");
    const formData = new FormData();
    formData.set("intent", "save-slack-webhook");
    formData.set("slackWebhookUrl", fakeSlackWebhookUrl());
    formData.set("slackDestinationName", "Growth alerts");
    const result = (await action({
      context: createContext({ DB: {} }),
      params: {},
      request: new Request("http://localhost/app/notifications", {
        method: "POST",
        body: formData,
      }),
    } as never)) as { ok: boolean; message: string };

    expect(result.ok).toBe(true);
    expect(result.message).toContain("Slack delivery connected");
    expect(upsertWorkspaceDeliveryConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: session.user.id,
        slackEnabled: true,
        teamsEnabled: false,
      }),
    );
  });

  it("connects a Teams webhook on Starter+ and enables Teams delivery", async () => {
    ownerAuthMock();
    const upsertWorkspaceDeliveryConfig = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue(null),
      legacyWorkspaceDeliveryDefaults: vi.fn().mockReturnValue(digestConfigDefaults()),
      upsertWorkspaceDeliveryConfig,
    }));
    vi.doMock("~/lib/teams.server", () => ({
      saveTeamsWebhookTarget: vi.fn().mockResolvedValue({ id: "teams-target-1" }),
    }));

    const { action } = await import("~/routes/app.notifications");
    const formData = new FormData();
    formData.set("intent", "save-teams-webhook");
    formData.set("teamsWebhookUrl", fakeTeamsWebhookUrl());
    const result = (await action({
      context: createContext({ DB: {} }),
      params: {},
      request: new Request("http://localhost/app/notifications", {
        method: "POST",
        body: formData,
      }),
    } as never)) as { ok: boolean; message: string };

    expect(result.ok).toBe(true);
    expect(result.message).toContain("Teams delivery connected");
    expect(upsertWorkspaceDeliveryConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: session.user.id,
        teamsEnabled: true,
        slackEnabled: false,
      }),
    );
  });

  it("pauses and resumes a connected Slack webhook", async () => {
    ownerAuthMock();
    vi.doMock("~/lib/slack.server", () => ({
      pauseSlackWebhookTarget: vi.fn().mockResolvedValue(true),
      resumeSlackWebhookTarget: vi.fn().mockResolvedValue(true),
    }));

    const { action } = await import("~/routes/app.notifications");
    const pauseForm = new FormData();
    pauseForm.set("intent", "pause-slack-webhook");
    pauseForm.set("targetId", "slack-target-1");
    const paused = (await action({
      context: createContext({ DB: {} }),
      params: {},
      request: new Request("http://localhost/app/notifications", {
        method: "POST",
        body: pauseForm,
      }),
    } as never)) as { ok: boolean; message: string };
    expect(paused.ok).toBe(true);
    expect(paused.message).toContain("paused");

    const resumeForm = new FormData();
    resumeForm.set("intent", "resume-slack-webhook");
    resumeForm.set("targetId", "slack-target-1");
    const resumed = (await action({
      context: createContext({ DB: {} }),
      params: {},
      request: new Request("http://localhost/app/notifications", {
        method: "POST",
        body: resumeForm,
      }),
    } as never)) as { ok: boolean; message: string };
    expect(resumed.ok).toBe(true);
    expect(resumed.message).toContain("resumed");
  });

  it("tells pre-Starter plans that webhook delivery is included in Starter and Agency", async () => {
    ownerAuthMock();
    const { getUserPlan } = await import("~/lib/plan.server");
    vi.mocked(getUserPlan).mockResolvedValue("scout");

    const { action } = await import("~/routes/app.notifications");
    for (const [intent, expected] of [
      ["save-slack-webhook", /Slack delivery is included in Starter and Agency plans/],
      ["save-teams-webhook", /Teams delivery is included in Starter and Agency plans/],
    ] as const) {
      const formData = new FormData();
      formData.set("intent", intent);
      const result = (await action({
        context: createContext({ DB: {} }),
        params: {},
        request: new Request("http://localhost/app/notifications", {
          method: "POST",
          body: formData,
        }),
      } as never)) as { ok: boolean; message: string };
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(expected);
    }
  });

  it("answers the dormant WhatsApp intent honestly instead of running a dead handler", async () => {
    ownerAuthMock();

    const { action } = await import("~/routes/app.notifications");
    const formData = new FormData();
    formData.set("intent", "save-whatsapp-target");
    const result = (await action({
      context: createContext({ DB: {} }),
      params: {},
      request: new Request("http://localhost/app/notifications", {
        method: "POST",
        body: formData,
      }),
    } as never)) as { ok: boolean; message: string };
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/WhatsApp delivery isn\u2019t available/);
  });

  it("saves the digest cadence for the owner", async () => {
    ownerAuthMock();
    const upsertWorkspaceDeliveryConfig = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue(null),
      legacyWorkspaceDeliveryDefaults: vi.fn().mockReturnValue(digestConfigDefaults()),
      upsertWorkspaceDeliveryConfig,
    }));

    const { action } = await import("~/routes/app.notifications");
    const formData = new FormData();
    formData.set("intent", "save-digest-cadence");
    formData.set("digestCadencePreference", "weekly_only");
    const result = (await action({
      context: createContext({ DB: {} }),
      params: {},
      request: new Request("http://localhost/app/notifications", {
        method: "POST",
        body: formData,
      }),
    } as never)) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(upsertWorkspaceDeliveryConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: session.user.id,
        digestCadencePreference: "weekly_only",
      }),
    );
  });

  it("keeps member sessions read-only for delivery intents", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session,
        workspaceUserId: "owner-1",
        isMember: true,
        ownerName: "Owner",
      }),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({ DB: {} })) }));

    const { action } = await import("~/routes/app.notifications");
    const formData = new FormData();
    formData.set("intent", "save-digest-cadence");
    const result = (await action({
      context: createContext({ DB: {} }),
      params: {},
      request: new Request("http://localhost/app/notifications", {
        method: "POST",
        body: formData,
      }),
    } as never)) as { ok: boolean; message: string };

    expect(result.ok).toBe(false);
    expect(result.message).toContain("account owner");
  });

  it("renders Slack and Teams rows for entitled workspaces, never WhatsApp", async () => {
    await mockRouter({
      emailDeliveryReady: true,
      digestCadencePreference: "plan_default",
      showSlackDelivery: true,
      showTeamsDelivery: true,
      slackDelivery: { plan: "agency", entitled: true },
      teamsDelivery: { plan: "agency", entitled: true },
      slackTargets: [
        {
          id: "slack-target-1",
          displayName: "Growth alerts",
          isPaused: false,
          lastSuccessfulDeliveryAt: null,
          createdAt: "2026-08-12T00:00:00.000Z",
        },
      ],
      teamsTargets: [],
    });

    const { NotificationsRoute } = await import("~/routes/app.notifications.ui");
    const markup = renderToStaticMarkup(createElement(NotificationsRoute));

    expect(markup).toContain("Delivery channel");
    expect(markup).toContain("Email");
    expect(markup).toContain("Slack");
    expect(markup).toContain("Teams");
    expect(markup).toContain("Growth alerts");
    expect(markup).toContain("Pause");
    expect(markup).not.toContain("WhatsApp");
    expect(markup).toContain("Webhook delivery");
  });

  it("renders honest Starter+ gating copy for non-entitled workspaces", async () => {
    await mockRouter({
      emailDeliveryReady: true,
      digestCadencePreference: "plan_default",
      showSlackDelivery: true,
      showTeamsDelivery: true,
      slackDelivery: { plan: "scout", entitled: false },
      teamsDelivery: { plan: "scout", entitled: false },
      slackTargets: [],
      teamsTargets: [],
    });

    const { NotificationsRoute } = await import("~/routes/app.notifications.ui");
    const markup = renderToStaticMarkup(createElement(NotificationsRoute));

    expect(markup).toContain("Included in Starter and Agency plans.");
    expect(markup).not.toContain('name="slackWebhookUrl"');
    expect(markup).not.toContain('name="teamsWebhookUrl"');
    expect(markup).not.toContain("WhatsApp");
  });

  it("keeps missing-email delivery honest and points to the account", async () => {
    await mockRouter({
      emailDeliveryReady: false,
      digestCadencePreference: "plan_default",
      showSlackDelivery: true,
      showTeamsDelivery: true,
      slackDelivery: { plan: "agency", entitled: true },
      teamsDelivery: { plan: "agency", entitled: true },
      slackTargets: [],
      teamsTargets: [],
    });

    const { NotificationsRoute } = await import("~/routes/app.notifications.ui");
    const markup = renderToStaticMarkup(createElement(NotificationsRoute));

    expect(markup).toContain("Needs email");
    expect(markup).toContain("Add an account email first.");
  });

  it("renders action outcomes through the shared workspace feedback strip", async () => {
    await mockRouter(
      {
        emailDeliveryReady: true,
        digestCadencePreference: "plan_default",
        showSlackDelivery: true,
        showTeamsDelivery: true,
        slackDelivery: { plan: "agency", entitled: true },
        teamsDelivery: { plan: "agency", entitled: true },
        slackTargets: [],
        teamsTargets: [],
      },
      { ok: true, message: "Slack delivery connected." },
    );

    const { NotificationsRoute } = await import("~/routes/app.notifications.ui");
    const markup = renderToStaticMarkup(createElement(NotificationsRoute));

    expect(markup).toContain("f9-wk-strip");
    expect(markup).toContain("Slack delivery connected.");
  });
});
