import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

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
  label: "Beta: needs proof",
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

async function mockRouter(loaderData: unknown) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useActionData: vi.fn().mockReturnValue(undefined),
      useLoaderData: vi.fn().mockReturnValue(loaderData),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
    };
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("sources route API-key readiness", () => {
  it("renders missing write-key state and blocked credential lifecycle", async () => {
    await mockRouter({
      connection: null,
      discoveryStatus,
      betaReadiness,
      apiKeys: [],
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

    const { default: AppSourcesRoute } = await import("~/routes/app.sources");
    const markup = renderToStaticMarkup(createElement(AppSourcesRoute));

    expect(markup).toMatch(/Active keys[\s\S]*?<strong>0<\/strong>/);
    expect(markup).toContain("Needs write key");
    expect(markup).toContain("Allow account actions");
    expect(markup).toContain("customer API key creation, rotation, and revocation");
  });

  it("counts active keys and write-enabled keys separately", async () => {
    await mockRouter({
      connection: null,
      discoveryStatus,
      betaReadiness,
      apiKeys: [
        {
          id: "api-key-read",
          name: "Read only",
          keyPrefix: "f9_live_read",
          actionsWriteEnabled: false,
          lastUsedAt: null,
          revokedAt: null,
          createdAt: "2026-06-01T00:00:00.000Z",
        },
        {
          id: "api-key-write",
          name: "Agent actions",
          keyPrefix: "f9_live_write",
          actionsWriteEnabled: true,
          lastUsedAt: null,
          revokedAt: null,
          createdAt: "2026-06-02T00:00:00.000Z",
        },
        {
          id: "api-key-revoked",
          name: "Old write key",
          keyPrefix: "f9_live_old",
          actionsWriteEnabled: true,
          lastUsedAt: null,
          revokedAt: "2026-06-03T00:00:00.000Z",
          createdAt: "2026-06-03T00:00:00.000Z",
        },
      ],
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

    const { default: AppSourcesRoute } = await import("~/routes/app.sources");
    const markup = renderToStaticMarkup(createElement(AppSourcesRoute));

    expect(markup).toMatch(/Active keys[\s\S]*?<strong>2<\/strong>/);
    expect(markup).toContain("1 enabled");
    expect(markup).not.toContain("Needs write key");
  });
});
