import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockUseLoaderData = () => unknown;

function createContext(env = {}) {
  return {
    cloudflare: {
      env,
    },
  };
}

async function mockRouter(useLoaderData: MockUseLoaderData) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useLoaderData: vi.fn(useLoaderData),
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

describe("status route", () => {
  it("does not query tenant-backed launch signals on the public page", async () => {
    const getLaunchReadinessSignals = vi.fn().mockResolvedValue({
      monitoring: { recentSuccessfulRuns: 2 },
      proof: { recentSuccessfulCaptures: 1 },
      digestDelivery: { recentSent: 1 },
      slackDelivery: { usableTargets: 1, recentSent: 1 },
      whatsappDelivery: {
        providerConfigured: true,
        customerReady: true,
        webhookConfigured: true,
        usableTargets: 1,
        recentAttempts: 1,
        recentSent: 1,
      },
    });
    vi.doMock("~/lib/data.server", () => ({
      getLaunchReadinessSignals,
    }));

    const { loader } = await import("~/routes/status");
    const result = await loader({
      context: createContext({
        DB: {},
        CANARY_BYPASS_TOKEN: "secret-token",
      }),
      request: new Request("https://0509.io/status"),
    } as never);

    expect(result).toMatchObject({
      appServed: true,
      evidence: null,
      evidenceUnavailableReason: "private_canary_only",
    });
    expect(getLaunchReadinessSignals).not.toHaveBeenCalled();
  });

  it("renders private evidence copy and static broad-launch blockers", async () => {
    await mockRouter(() => ({
      generatedAt: "2026-06-20T09:00:00.000Z",
      appServed: true,
      evidence: [
        {
          id: "slack",
          label: "Slack delivery",
          statusLabel: "Recent proof",
          detail: "Recent Slack delivery proof is visible in private launch checks.",
          timestampAt: "2026-06-20T09:00:00.000Z",
          timestampLabel: "Last proof",
        },
      ],
      evidenceUnavailableReason: null,
    }));

    const { default: StatusRoute } = await import("~/routes/status");
    const markup = renderToStaticMarkup(createElement(StatusRoute));

    expect(markup).toContain("Detailed production evidence is intentionally private.");
    expect(markup).toContain("authenticated launch-readiness canary");
    expect(markup).toContain("Slack broad-launch proof still requires");
    expect(markup).toContain("WhatsApp is not launch-scoped until");
    expect(markup).toContain("Dodo portal subscription updates need the dashboard setting confirmed by Nish.");
    expect(markup).toContain("External uptime monitoring still needs a third-party monitor");
    expect(markup).not.toContain("Recent Slack delivery proof is visible");
    expect(markup).not.toContain("Last proof");
    expect(markup).not.toContain("secret-token");
    expect(markup).not.toContain("hooks.slack.com");
  });
});
