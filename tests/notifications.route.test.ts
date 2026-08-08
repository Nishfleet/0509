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

beforeEach(async () => {
  vi.resetModules();
  const { isSlackDeliveryCustomerFacing, isWhatsAppDeliveryCustomerFacing } =
    await import("~/lib/ga-customer-surface");
  vi.mocked(isSlackDeliveryCustomerFacing).mockReturnValue(false);
  vi.mocked(isWhatsAppDeliveryCustomerFacing).mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});


describe("notifications route (post-subtraction surface)", () => {
  it("the loader returns only the live delivery surface — no dormant channel data", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      }),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({ DB: {} })) }));
    vi.doMock("~/lib/data.server", () => ({
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue({
        digestCadencePreference: "weekly_only",
      }),
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
    });
  });

  it("answers dormant-channel intents honestly instead of running dead handlers", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      }),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({ DB: {} })) }));

    const { action } = await import("~/routes/app.notifications");
    for (const [intent, expected] of [
      ["save-slack-webhook", /Slack delivery isn\u2019t available/],
      ["pause-slack-webhook", /Slack delivery isn\u2019t available/],
      ["resume-slack-webhook", /Slack delivery isn\u2019t available/],
      ["save-whatsapp-target", /WhatsApp delivery isn\u2019t available/],
    ] as const) {
      const formData = new FormData();
      formData.set("intent", intent);
      formData.set("slackWebhookUrl", fakeSlackWebhookUrl());
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

  it("saves the digest cadence for the owner", async () => {
    const upsertWorkspaceDeliveryConfig = vi.fn();
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      }),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({ DB: {} })) }));
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

  it("renders the GA surface with no dormant channel rows and no roadmap-speak", async () => {
    await mockRouter({
      emailDeliveryReady: true,
      digestCadencePreference: "plan_default",
    });

    const { NotificationsRoute } = await import("~/routes/app.notifications.ui");
    const markup = renderToStaticMarkup(createElement(NotificationsRoute));

    expect(markup).toContain("Delivery channel");
    expect(markup).toContain("Email");
    expect(markup).not.toContain("Slack");
    expect(markup).not.toContain("WhatsApp");
    expect(markup).not.toContain("stay dormant");
    expect(markup).toContain("Delivery channel: email");
  });

  it("keeps missing-email delivery honest and points to the account", async () => {
    await mockRouter({
      emailDeliveryReady: false,
      digestCadencePreference: "plan_default",
    });

    const { NotificationsRoute } = await import("~/routes/app.notifications.ui");
    const markup = renderToStaticMarkup(createElement(NotificationsRoute));

    expect(markup).toContain("Needs email");
    expect(markup).toContain("Add an account email first.");
  });

  it("renders action outcomes through the shared workspace feedback strip", async () => {
    await mockRouter(
      { emailDeliveryReady: true, digestCadencePreference: "plan_default" },
      { ok: true, message: "Digest cadence saved." },
    );

    const { NotificationsRoute } = await import("~/routes/app.notifications.ui");
    const markup = renderToStaticMarkup(createElement(NotificationsRoute));

    expect(markup).toContain("f9-wk-strip");
    expect(markup).toContain("Digest cadence saved.");
  });
});
