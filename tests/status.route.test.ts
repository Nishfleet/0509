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
    expect(markup).toContain("does not measure live search, email, billing, or provider availability");
    expect(markup).not.toMatch(/(?:search|checkout|billing|email delivery) (?:is|are) available/i);
    expect(markup).not.toContain("Available for checking competitor ads");
    expect(markup).not.toContain("Digest and alert emails are available");
  });

  it("renders measured monitoring counters with an as-of timestamp when present", async () => {
    const counters = {
      lastWatchlistRunAt: "2026-09-01T03:00:00.000Z",
      runsInLast24h: 31,
      failedRunsInLast24h: 0,
      lastDigestSentAt: "2026-09-04T00:00:00.000Z",
    };

    await mockRouter(() => ({
      generatedAt: "2026-09-04T09:00:00.000Z",
      asOf: "2026-09-04T09:30:00.000Z",
      appServed: true,
      monitoring: counters,
      measurementsUnavailable: false,
    }));

    const { default: StatusRoute } = await import("~/routes/status");
    const markup = renderToStaticMarkup(createElement(StatusRoute));

    expect(markup).toContain("Monitoring health");
    expect(markup).toContain("31");
    expect(markup).toContain("0");
    expect(markup).toContain("2026-09-01T03:00:00.000Z");
    expect(markup).toContain("as of 2026-09-04T09:30:00.000Z");
    expect(markup).not.toContain("Measurements unavailable right now.");
    expect(markup).toContain("Configuration and scope information and live monitoring facts");
  });

  it("loader propagates measured monitoring counters and renders no stale number", async () => {
    const counters = {
      lastWatchlistRunAt: "2026-09-01T03:00:00.000Z",
      runsInLast24h: 31,
      failedRunsInLast24h: 0,
      lastDigestSentAt: null,
    };
    vi.doMock("~/lib/public-status-counters.server", () => ({
      getPublicStatusCounters: vi.fn().mockResolvedValue(counters),
    }));

    const { loader } = await import("~/routes/status");
    const result = await loader({
      context: createContext({ DB: {} }),
      request: new Request("https://0509.io/status"),
    } as never);

    expect(result.monitoring).toEqual(counters);
    expect(result.measurementsUnavailable).toBe(false);
    expect(typeof result.asOf).toBe("string");
  });

  it("degrades to honest static prose and a 200 when monitoring counters cannot be read", async () => {
    vi.doMock("~/lib/public-status-counters.server", () => ({
      getPublicStatusCounters: vi
        .fn()
        .mockRejectedValue(new Error("d1 read failed")),
    }));

    const { loader } = await import("~/routes/status");
    const result = await loader({
      context: createContext({ DB: {} }),
      request: new Request("https://0509.io/status"),
    } as never);

    // A D1 read error must not throw: the route still returns 200.
    expect(result.monitoring).toBeNull();
    expect(result.measurementsUnavailable).toBe(true);

    await mockRouter(() => ({
      generatedAt: "2026-09-04T09:00:00.000Z",
      asOf: "2026-09-04T09:30:00.000Z",
      appServed: true,
      monitoring: null,
      measurementsUnavailable: true,
    }));
    const { default: StatusRoute } = await import("~/routes/status");
    const markup = renderToStaticMarkup(createElement(StatusRoute));

    expect(markup).toContain("Measurements unavailable right now.");
    expect(markup).toContain("Core surfaces");
    expect(markup).toContain("does not measure live search, email, billing, or provider availability");
  });

  it("never renders account-scoped field names on the public page", async () => {
    vi.doMock("~/lib/public-status-counters.server", () => ({
      getPublicStatusCounters: vi.fn().mockResolvedValue({
        lastWatchlistRunAt: "2026-09-01T03:00:00.000Z",
        runsInLast24h: 31,
        failedRunsInLast24h: 0,
        lastDigestSentAt: null,
      }),
    }));

    const { loader } = await import("~/routes/status");
    const result = await loader({
      context: createContext({ DB: {} }),
      request: new Request("https://0509.io/status"),
    } as never);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("recipient_email");
    expect(serialized).not.toContain("@");
    expect(serialized).not.toContain("watchlist_id");
    expect(serialized).not.toContain("competitor");
  });
});
