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

const launchSignals = {
  since: "2026-06-18T12:00:00.000Z",
  monitoring: {
    recentSuccessfulRuns: 2,
    latestSucceededAt: "2026-06-20T09:00:00.000Z",
  },
  proof: {
    recentSuccessfulCaptures: 1,
    latestSucceededAt: "2026-06-20T09:05:00.000Z",
  },
  digestDelivery: {
    recentAttempts: 1,
    recentSent: 1,
    latestAttemptAt: "2026-06-20T09:10:00.000Z",
  },
  slackDelivery: {
    configuredTargets: 1,
    usableTargets: 0,
    latestTargetSuccessAt: null,
    recentAttempts: 0,
    recentSent: 0,
    latestAttemptAt: null,
  },
  whatsappDelivery: {
    providerConfigured: false,
    customerReady: false,
    webhookConfigured: false,
    configuredTargets: 3,
    usableTargets: 0,
    latestTargetSuccessAt: null,
    recentAttempts: 0,
    recentSent: 0,
    latestAttemptAt: null,
  },
};

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
  it("returns an honest unavailable evidence state without D1", async () => {
    const getLaunchReadinessSignals = vi.fn();
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({})),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getLaunchReadinessSignals,
    }));

    const { loader } = await import("~/routes/status");
    const result = await loader({
      context: createContext({}),
      request: new Request("https://0509.io/status"),
    } as never);

    expect(result).toMatchObject({
      appServed: true,
      evidence: null,
      evidenceUnavailableReason: "unavailable",
    });
    expect(getLaunchReadinessSignals).not.toHaveBeenCalled();
  });

  it("returns an honest unavailable evidence state when aggregate signals cannot be queried", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        DB: {},
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getLaunchReadinessSignals: vi.fn().mockRejectedValue(new Error("no such table: proof_capture")),
    }));

    const { loader } = await import("~/routes/status");
    const result = await loader({
      context: createContext({ DB: {} }),
      request: new Request("https://0509.io/status"),
    } as never);

    expect(result).toMatchObject({
      appServed: true,
      evidence: null,
      evidenceUnavailableReason: "unavailable",
    });
  });

  it("caches aggregate evidence so public status refreshes do not repeatedly query D1", async () => {
    const getLaunchReadinessSignals = vi.fn().mockResolvedValue(launchSignals);
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        DB: {},
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getLaunchReadinessSignals,
    }));

    const { loader } = await import("~/routes/status");
    const request = new Request("https://0509.io/status");
    const first = await loader({ context: createContext({ DB: {} }), request } as never);
    const second = await loader({ context: createContext({ DB: {} }), request } as never);

    expect(getLaunchReadinessSignals).toHaveBeenCalledTimes(1);
    expect(first.evidence).toEqual(second.evidence);
    expect(first.evidenceUnavailableReason).toBeNull();
    expect(second.evidenceUnavailableReason).toBeNull();
  });

  it("briefly caches aggregate query failures instead of retrying on every public GET", async () => {
    const getLaunchReadinessSignals = vi
      .fn()
      .mockRejectedValueOnce(new Error("no such table: proof_capture"))
      .mockResolvedValueOnce(launchSignals);
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        DB: {},
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getLaunchReadinessSignals,
    }));

    const { loader } = await import("~/routes/status");
    const request = new Request("https://0509.io/status");
    const first = await loader({ context: createContext({ DB: {} }), request } as never);
    const second = await loader({ context: createContext({ DB: {} }), request } as never);

    expect(getLaunchReadinessSignals).toHaveBeenCalledTimes(1);
    expect(first.evidence).toBeNull();
    expect(second.evidence).toBeNull();
    expect(first.evidenceUnavailableReason).toBe("unavailable");
    expect(second.evidenceUnavailableReason).toBe("unavailable");
  });

  it("renders coarse aggregate production evidence and keeps broad launch gated", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        DB: {},
        CANARY_BYPASS_TOKEN: "secret-token",
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getLaunchReadinessSignals: vi.fn().mockResolvedValue(launchSignals),
    }));

    const { loader } = await import("~/routes/status");
    const loaderData = await loader({
      context: createContext({ DB: {} }),
      request: new Request("https://0509.io/status"),
    } as never);

    vi.resetModules();
    await mockRouter(() => loaderData);
    const { default: StatusRoute } = await import("~/routes/status");
    const markup = renderToStaticMarkup(createElement(StatusRoute));

    expect(markup).toContain("Recent production evidence");
    expect(markup).toContain("coarse aggregate production signals");
    expect(markup).toContain("Recent successful monitoring proof is visible in private launch checks.");
    expect(markup).toContain("Recent proof capture is visible in private launch checks.");
    expect(markup).toContain("Recent digest delivery proof is visible in private launch checks.");
    expect(markup).toContain("Slack delivery");
    expect(markup).toContain("Launch blocker");
    expect(markup).toContain("Slack broad launch still needs a configured target and recent successful delivery proof.");
    expect(markup).toContain("WhatsApp delivery");
    expect(markup).toContain("Not launch-scoped");
    expect(markup).toContain("Dodo portal subscription updates need the dashboard setting confirmed by Nish.");
    expect(markup).toContain("External uptime monitoring still needs a third-party monitor");
    expect(markup).not.toContain("secret-token");
    expect(markup).not.toContain("hooks.slack.com");
    expect(markup).not.toContain("x-0509-canary-token");
    expect(markup).not.toContain("2 successful monitoring runs");
    expect(markup).not.toContain("Last proof");
    expect(markup).not.toContain("Last delivery attempt");
  });

  it("does not label failed delivery attempts or target checks as proof", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        DB: {},
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getLaunchReadinessSignals: vi.fn().mockResolvedValue({
        ...launchSignals,
        monitoring: {
          recentSuccessfulRuns: 0,
          latestSucceededAt: null,
        },
        proof: {
          recentSuccessfulCaptures: 0,
          latestSucceededAt: null,
        },
        digestDelivery: {
          recentAttempts: 2,
          recentSent: 0,
          latestAttemptAt: "2026-06-20T09:10:00.000Z",
        },
        slackDelivery: {
          configuredTargets: 1,
          usableTargets: 1,
          latestTargetSuccessAt: "2026-06-20T09:00:00.000Z",
          recentAttempts: 1,
          recentSent: 0,
          latestAttemptAt: "2026-06-20T09:20:00.000Z",
        },
        whatsappDelivery: {
          providerConfigured: true,
          customerReady: true,
          webhookConfigured: true,
          configuredTargets: 1,
          usableTargets: 1,
          latestTargetSuccessAt: "2026-06-20T09:30:00.000Z",
          recentAttempts: 0,
          recentSent: 0,
          latestAttemptAt: null,
        },
      }),
    }));

    const { loader } = await import("~/routes/status");
    const loaderData = await loader({
      context: createContext({ DB: {} }),
      request: new Request("https://0509.io/status"),
    } as never);

    vi.resetModules();
    await mockRouter(() => loaderData);
    const { default: StatusRoute } = await import("~/routes/status");
    const markup = renderToStaticMarkup(createElement(StatusRoute));

    expect(markup).toContain("No recent digest delivery proof is visible yet.");
    expect(markup).toContain("Slack broad launch still needs a configured target and recent successful delivery proof.");
    expect(markup).toContain("WhatsApp has partial readiness or delivery history");
    expect(markup).not.toContain("2 digest delivery attempts");
    expect(markup).not.toContain("Last delivery attempt");
    expect(markup).not.toContain("Last target check");
    expect(markup).not.toContain("Last proof");
  });

  it("does not claim WhatsApp proof until every launch gate is ready", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        DB: {},
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getLaunchReadinessSignals: vi.fn().mockResolvedValue({
        ...launchSignals,
        whatsappDelivery: {
          providerConfigured: false,
          customerReady: true,
          webhookConfigured: true,
          configuredTargets: 1,
          usableTargets: 1,
          latestTargetSuccessAt: "2026-06-20T09:30:00.000Z",
          recentAttempts: 1,
          recentSent: 1,
          latestAttemptAt: "2026-06-20T09:40:00.000Z",
        },
      }),
    }));

    const { loader } = await import("~/routes/status");
    const loaderData = await loader({
      context: createContext({ DB: {} }),
      request: new Request("https://0509.io/status"),
    } as never);

    vi.resetModules();
    await mockRouter(() => loaderData);
    const { default: StatusRoute } = await import("~/routes/status");
    const markup = renderToStaticMarkup(createElement(StatusRoute));

    expect(markup).toContain("WhatsApp has partial readiness or delivery history");
    expect(markup).toContain("Launch blocker");
    expect(markup).not.toContain("1 usable WhatsApp target and 1 delivered customer send");
  });

  it("renders Slack and WhatsApp delivery proof as coarse public states", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        DB: {},
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getLaunchReadinessSignals: vi.fn().mockResolvedValue({
        ...launchSignals,
        slackDelivery: {
          configuredTargets: 2,
          usableTargets: 2,
          latestTargetSuccessAt: "2026-06-20T09:00:00.000Z",
          recentAttempts: 2,
          recentSent: 2,
          latestAttemptAt: "2026-06-20T09:20:00.000Z",
        },
        whatsappDelivery: {
          providerConfigured: true,
          customerReady: true,
          webhookConfigured: true,
          configuredTargets: 1,
          usableTargets: 1,
          latestTargetSuccessAt: "2026-06-20T09:30:00.000Z",
          recentAttempts: 1,
          recentSent: 1,
          latestAttemptAt: "2026-06-20T09:40:00.000Z",
        },
      }),
    }));

    const { loader } = await import("~/routes/status");
    const loaderData = await loader({
      context: createContext({ DB: {} }),
      request: new Request("https://0509.io/status"),
    } as never);

    vi.resetModules();
    await mockRouter(() => loaderData);
    const { default: StatusRoute } = await import("~/routes/status");
    const markup = renderToStaticMarkup(createElement(StatusRoute));

    expect(markup).toContain("Slack delivery");
    expect(markup).toContain("Recent Slack delivery proof is visible in private launch checks.");
    expect(markup).toContain("WhatsApp delivery");
    expect(markup).toContain("Recent WhatsApp customer delivery proof is visible in private launch checks.");
    expect(markup).toContain("Dodo portal subscription updates need the dashboard setting confirmed by Nish.");
    expect(markup).toContain("External uptime monitoring still needs a third-party monitor");
    expect(markup).not.toContain("Slack broad-launch proof still requires");
    expect(markup).not.toContain("WhatsApp is not launch-scoped until");
    expect(markup).not.toContain("2 usable Slack");
    expect(markup).not.toContain("1 usable WhatsApp");
    expect(markup).not.toContain("2026-06-20T09:40:00.000Z");
  });

  it("renders unavailable evidence copy when loader evidence is missing", async () => {
    await mockRouter(() => ({
      generatedAt: "2026-06-20T09:00:00.000Z",
      appServed: true,
      evidence: null,
    }));

    const { default: StatusRoute } = await import("~/routes/status");
    const markup = renderToStaticMarkup(createElement(StatusRoute));

    expect(markup).toContain("Production evidence is unavailable from this environment");
    expect(markup).toContain("The private canaries remain the launch gate.");
    expect(markup).not.toContain("proof_capture");
  });
});
