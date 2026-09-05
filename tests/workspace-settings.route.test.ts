import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    () =>
      "Slack delivery isn’t available. Nothing was saved — use email delivery instead.",
  ),
  whatsappDeliveryUnavailableMessage: vi.fn(
    () =>
      "WhatsApp delivery isn’t available. Nothing was saved — use email delivery instead.",
  ),
}));

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

describe("workspace settings route components", () => {
  it("redirects the legacy sources URL into Notifications", async () => {
    const { loader } = await import("~/routes/app.sources");
    const response = loader() as Response;
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/app/notifications");
  });

  it("renders nothing on the legacy sources route — no API key can appear there", async () => {
    const { default: SourcesRoute } = await import("~/routes/app.sources");
    expect(SourcesRoute()).toBeNull();
  });

  it("renders source access without developer or notification setup", async () => {
    await mockRouter({
      connection: null,
      discoveryStatus,
    });

    const { default: SourceAccessRoute } =
      await import("~/routes/app.source-access");
    const markup = renderToStaticMarkup(createElement(SourceAccessRoute));

    expect(markup).toContain("Source access");
    expect(markup).toContain("Backup Meta ad checks");
    expect(markup).toContain("Tracking status");
    expect(markup).not.toContain("Meta coverage is beta");
    expect(markup).not.toContain("f9-beta-pill");
    expect(markup).toContain("Test and save access");
    expect(markup).toContain("Ad Library API page");
    expect(markup).not.toContain("Recent tracking health");
    expect(markup).not.toContain("Create API key");
    expect(markup).not.toContain("Slack delivery");
    expect(markup).toContain("showing your most recent results");
    expect(markup).not.toContain("Cached live results");
    expect(markup).not.toContain("degraded");
  });

  it("locks source access controls and hides token metadata for workspace members", async () => {
    await mockRouter({
      connection: {
        status: "healthy",
        tokenLastFour: "9876",
        summary: "Backup source access is connected.",
        lastCheckedAt: "2026-07-15T00:00:00.000Z",
        updatedAt: "2026-07-15T00:00:00.000Z",
      },
      canManageSourceAccess: false,
      discoveryStatus: {
        status: "healthy",
        summary: "Live ad checks are ready.",
        lastCheckedAt: null,
      },
    });

    const { default: SourceAccessRoute } =
      await import("~/routes/app.source-access");
    const markup = renderToStaticMarkup(createElement(SourceAccessRoute));

    expect(markup).toContain("The account owner manages source access");
    expect(markup).toContain(
      "Only the account owner can add, retest, or disconnect the backup token.",
    );
    expect(markup).not.toContain("9876");
    expect(markup).not.toContain("Paste the full Meta access token");
    expect(markup).not.toContain("Test and save access");
  });

  it("keeps the needs-setup source state as a red word, not a badge", async () => {
    await mockRouter({
      connection: null,
      canManageSourceAccess: true,
      discoveryStatus: {
        status: "disabled",
        summary: "Tracking status will appear after the first check.",
      },
    });

    const { default: SourceAccessRoute } =
      await import("~/routes/app.source-access");
    const markup = renderToStaticMarkup(createElement(SourceAccessRoute));

    expect(markup).toContain(
      '<span class="f9-access-status is-bad">Needs setup</span>',
    );
    expect(markup).not.toContain("f9-evidence-stamp");
    expect(markup).not.toContain("f9-beta-pill");
  });

  it("renders developer access without source-token or delivery setup", async () => {
    await mockRouter({
      apiKeys: [],
    });

    const { default: DeveloperAccessRoute } =
      await import("~/routes/app.developer-access");
    const markup = renderToStaticMarkup(createElement(DeveloperAccessRoute));

    expect(markup).toContain("Developer access");
    expect(markup).toContain("Connect exports and approved actions");
    expect(markup).toContain("Read keys reach saved workspace material");
    expect(markup).toContain("Full secrets disappear after creation");
    expect(markup).toContain("Create API key");
    expect(markup).toContain("Allow approved account actions");
    expect(markup).toContain("/api/v1/watchlists/");
    expect(markup).not.toContain("Ad Library API page");
    expect(markup).not.toContain("Slack delivery");
    expect(markup).not.toContain("Sensitive changes");
    expect(markup).not.toContain("POST /api/mcp");
  });

  it("renders notifications without source-token or API-key setup", async () => {
    // Exactly the loader's real shape — extra fields here would hide
    // loader/UI shape drift because React ignores unknown props.
    await mockRouter({
      emailDeliveryReady: true,
      digestCadencePreference: "plan_default",
    });

    const { default: NotificationsRoute } =
      await import("~/routes/app.notifications");
    const markup = renderToStaticMarkup(createElement(NotificationsRoute));

    expect(markup).toContain("Notifications");
    expect(markup).toContain(
      "Briefs and confirmed competitor changes reach your team by email.",
    );
    expect(markup).toContain("Delivery channel");
    expect(markup).toContain("Tune on competitors");
    expect(markup).not.toContain("Ad Library API page");
    expect(markup).not.toContain("Test and save access");
    expect(markup).not.toContain("Create API key");
    expect(markup).not.toContain("Save Slack delivery");
    expect(markup).not.toContain("WhatsApp delivery");
    expect(markup).not.toContain(
      "WhatsApp delivery is enabled for this account",
    );
    expect(markup).not.toContain(
      "WhatsApp is not available for this account yet",
    );
    expect(markup).not.toContain("Save WhatsApp delivery");
    expect(markup).not.toContain("Delivery webhook");
    expect(markup).not.toContain("0/3 usable");
    expect(markup).not.toContain("No successful send yet");
  });
});
