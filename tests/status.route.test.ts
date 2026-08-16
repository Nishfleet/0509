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
      useRouteLoaderData: () => undefined,
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
    });
    expect(JSON.stringify(result)).not.toContain("canary");
    expect(JSON.stringify(result)).not.toContain("Slack");
    expect(getLaunchReadinessSignals).not.toHaveBeenCalled();
  });

  it("renders customer-facing status without private launch details", async () => {
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

    expect(markup).toContain("Five to Nine service status.");
    expect(markup).toContain("Core surfaces");
    expect(markup).toContain("Public search");
    expect(markup).toContain("Change alerts and digests are sent by email through Cloudflare Email Service.");
    expect(markup).toContain("Recurring uptime checks are configured and reviewed by the operator");
    expect(markup).toContain("Held — account configuration");
    expect(markup).not.toContain("larger-account monitoring capacity");
    expect(markup).not.toContain("GA launch gate");
    expect(markup).not.toContain("GA launch proof");
    expect(markup).not.toContain("broad launch still needs fresh Slack proof");
    expect(markup).toContain("Dodo-backed plan switching is configured");
    expect(markup).not.toContain("WhatsApp delivery is not launch-scoped yet");
    expect(markup).toContain("Cancellation, deletion, and sensitive account changes");
    expect(markup).not.toContain("Recent Slack delivery proof is visible");
    expect(markup).not.toContain("Last proof");
    expect(markup).not.toContain("launch-readiness canary");
    expect(markup).not.toContain("private canary");
    expect(markup).not.toContain("secret-token");
    expect(markup).not.toContain("hooks.slack.com");
    expect(markup).toContain("configuration and scope information");
    expect(markup).toContain("not a live provider-health monitor");
    expect(markup).not.toMatch(/(?:search|checkout|billing|email delivery) (?:is|are) available/i);
    expect(markup).not.toContain("Available for checking competitor ads");
    expect(markup).not.toContain("Digest and alert emails are available");
  });
});
