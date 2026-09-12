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
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(JSON.stringify(result)).not.toContain("canary");
    expect(JSON.stringify(result)).not.toContain("Slack");
    expect(getLaunchReadinessSignals).not.toHaveBeenCalled();
  });

  it("renders measured surface states without private launch details", async () => {
    await mockRouter(() => ({
      generatedAt: "2026-06-20T09:00:00.000Z",
      asOf: "2026-06-20T09:00:00.000Z",
      appServed: true,
      commercialLaunch: { scoutSaleOpen: true, starterSaleOpen: true, agencySaleOpen: false },
      monitoring: null,
      surfaces: {
        asOf: "2026-06-20T09:00:00.000Z",
        monitoring: null,
        surfaces: [
          {
            id: "public-search",
            label: "Public search",
            state: "operational",
            reason: null,
            facts: ["12 cached public result sets"],
            checkedAt: "2026-06-20T09:00:00.000Z",
            source: "discovery_cache_entry",
          },
        ],
      },
    }));

    const { default: StatusRoute } = await import("~/routes/status");
    const markup = renderToStaticMarkup(createElement(StatusRoute));

    expect(markup).toContain("Five to Nine service status.");
    expect(markup).toContain("Core surfaces");
    expect(markup).toContain("Public search");
    expect(markup).toContain("Operational");
    expect(markup).toContain("Checkout held: Agency monthly products are not configured with the billing provider.");
    expect(markup).not.toContain("larger-account monitoring capacity");
    expect(markup).not.toContain("GA launch gate");
    expect(markup).not.toContain("GA launch proof");
    expect(markup).not.toContain("Recent Slack delivery proof is visible");
    expect(markup).not.toContain("Last proof");
    expect(markup).not.toContain("secret-token");
    expect(markup).not.toContain("hooks.slack.com");
    // The confession vocabulary is banned from the rendered page.
    expect(markup).not.toContain("does not measure");
    expect(markup).not.toContain("not live-checked");
    expect(markup).not.toContain("Limited today");
    expect(markup).not.toContain("unavailable");
    expect(markup).toMatch(/Checked \d+ min ago/);
  });

  it("renders the intro as one sentence about what is measured", async () => {
    await mockRouter(() => ({
      generatedAt: "2026-09-12T04:00:00.000Z",
      asOf: "2026-09-12T04:00:00.000Z",
      appServed: true,
      commercialLaunch: null,
      monitoring: null,
      surfaces: { asOf: "2026-09-12T04:00:00.000Z", monitoring: null, surfaces: [] },
    }));

    const { default: StatusRoute } = await import("~/routes/status");
    const markup = renderToStaticMarkup(createElement(StatusRoute));

    expect(markup).toContain(
      "Five to Nine measures public search, sign-in, billing, email delivery, scheduled monitoring, and uptime on this page",
    );
    expect(markup).not.toContain("does not measure");
  });

  it("renders measured monitoring counters with an as-of timestamp when present", async () => {
    const counters = {
      lastWatchlistRunAt: "2026-09-01T03:00:00.000Z",
      runsInLast24h: 31,
      failedRunsInLast24h: 0,
      lastDigestSentAt: "2026-09-04T00:00:00.000Z",
      digestHealth: "recent" as const,
      scheduledMonitoringSince: "2026-09-01T00:00:00.000Z",
    };

    await mockRouter(() => ({
      generatedAt: "2026-09-04T09:00:00.000Z",
      asOf: "2026-09-04T09:30:00.000Z",
      appServed: true,
      commercialLaunch: null,
      monitoring: counters,
      surfaces: { asOf: "2026-09-04T09:30:00.000Z", monitoring: counters, surfaces: [] },
    }));

    const { default: StatusRoute } = await import("~/routes/status");
    const markup = renderToStaticMarkup(createElement(StatusRoute));

    expect(markup).toContain("Monitoring health");
    expect(markup).toContain("31");
    expect(markup).toContain("0");
    expect(markup).toContain("2026-09-01T03:00:00.000Z");
    expect(markup).toContain("as of 2026-09-04T09:30:00.000Z");
  });

  it("never publishes cold bootstrap zeros — prose replaces '0 runs / no digests sent yet' (issue #2963)", async () => {
    await mockRouter(() => ({
      generatedAt: "2026-09-11T19:00:00.000Z",
      asOf: "2026-09-11T19:48:09.655Z",
      appServed: true,
      commercialLaunch: null,
      monitoring: {
        lastWatchlistRunAt: null,
        runsInLast24h: 0,
        failedRunsInLast24h: 0,
        lastDigestSentAt: null,
        digestHealth: "unknown" as const,
        scheduledMonitoringSince: "2026-09-01T00:00:00.000Z",
      },
      surfaces: { asOf: "2026-09-11T19:48:09.655Z", monitoring: null, surfaces: [] },
    }));

    const { default: StatusRoute } = await import("~/routes/status");
    const markup = renderToStaticMarkup(createElement(StatusRoute));

    expect(markup).toContain("Monitoring pipeline");
    expect(markup).toContain("Run and digest counts appear here from the first scheduled run onward.");
    expect(markup).not.toContain("no runs recorded yet");
    expect(markup).not.toContain("no digests sent yet");
    // The uptime-style coverage figure is derived from the real schedule
    // baseline and rendered beside it.
    expect(markup).toContain("Scheduled monitoring active since");
    expect(markup).toContain("2026-09-01T00:00:00.000Z");
    expect(markup).toMatch(/continuous scheduled monitoring coverage \(\d+ days\)/);
  });

  it("honestly surfaces a stalled digest instead of re-rendering a stale date when monitoring is healthy", async () => {
    const counters = {
      lastWatchlistRunAt: "2026-09-06T09:00:04.000Z",
      runsInLast24h: 24,
      failedRunsInLast24h: 0,
      lastDigestSentAt: "2026-06-29T04:00:59.009Z",
      digestHealth: "stalled" as const,
      scheduledMonitoringSince: "2026-09-01T00:00:00.000Z",
    };

    await mockRouter(() => ({
      generatedAt: "2026-09-06T09:00:00.000Z",
      asOf: "2026-09-06T09:30:00.000Z",
      appServed: true,
      commercialLaunch: null,
      monitoring: counters,
      surfaces: { asOf: "2026-09-06T09:30:00.000Z", monitoring: counters, surfaces: [] },
    }));

    const { default: StatusRoute } = await import("~/routes/status");
    const markup = renderToStaticMarkup(createElement(StatusRoute));

    // The stale date must not be presented as a live fact beside healthy
    // monitoring counts (the old "... — as of ..." render).
    expect(markup).toContain("Digest sends appear stalled.");
    expect(markup).toContain("2026-06-29T04:00:59.009Z");
    expect(markup).not.toContain("2026-06-29T04:00:59.009Z — as of");
  });

  it("renders degraded and down states with reasons when probes cannot run", async () => {
    await mockRouter(() => ({
      generatedAt: "2026-09-12T04:00:00.000Z",
      asOf: "2026-09-12T04:00:00.000Z",
      appServed: true,
      commercialLaunch: null,
      monitoring: null,
      surfaces: {
        asOf: "2026-09-12T04:00:00.000Z",
        monitoring: null,
        surfaces: [
          {
            id: "public-search",
            label: "Public search",
            state: "down",
            reason: "the database probe failed",
            facts: [],
            checkedAt: "2026-09-12T04:00:00.000Z",
            source: "edge and D1 probes",
          },
          {
            id: "uptime",
            label: "Uptime",
            state: "degraded",
            reason: "samples record on each scheduled run; the first one is pending",
            facts: [],
            checkedAt: "2026-09-12T04:00:00.000Z",
            source: "status_health_sample",
          },
        ],
      },
    }));

    const { default: StatusRoute } = await import("~/routes/status");
    const markup = renderToStaticMarkup(createElement(StatusRoute));

    expect(markup).toContain("<strong>Down</strong>: the database probe failed.");
    expect(markup).toContain("<strong>Degraded</strong>: samples record on each scheduled run; the first one is pending.");
    expect(markup).not.toContain("Measurements unavailable");
    // A degraded state names its source in the title attribute.
    expect(markup).toContain("Source: edge and D1 probes");
  });

  it("loader measures every surface and keeps the page at 200 when a probe fails", async () => {
    const surfaces = {
      asOf: "2026-09-12T04:00:00.000Z",
      monitoring: null,
      surfaces: [
        {
          id: "billing",
          label: "Billing",
          state: "degraded",
          reason: "the billing ledger probe failed",
          facts: [],
          checkedAt: "2026-09-12T04:00:00.000Z",
          source: "dodo_webhook_event ledger",
        },
      ],
    };
    vi.doMock("~/lib/public-status-counters.server", () => ({
      getPublicStatusSurfaces: vi.fn().mockResolvedValue(surfaces),
    }));

    const { loader } = await import("~/routes/status");
    const result = await loader({
      context: createContext({ DB: {} }),
      request: new Request("https://0509.io/status"),
    } as never);

    expect(result.surfaces).toEqual(surfaces);
    expect(result.monitoring).toBeNull();
    expect(typeof result.asOf).toBe("string");
    expect(result.appServed).toBe(true);
  });

  it("degrades every surface instead of throwing when the app runtime is missing", async () => {
    vi.doUnmock("~/lib/public-status-counters.server");
    const { loader } = await import("~/routes/status");
    const result = await loader({
      context: {},
      request: new Request("https://0509.io/status"),
    } as never);

    expect(result.appServed).toBe(false);
    expect(result.surfaces.surfaces.length).toBeGreaterThanOrEqual(6);
    for (const surface of result.surfaces.surfaces) {
      expect(surface.state).toBe("degraded");
      expect(surface.reason).toBeTruthy();
    }
    expect(result.monitoring).toBeNull();
  });

  it("never renders account-scoped field names on the public page", async () => {
    vi.doMock("~/lib/public-status-counters.server", () => ({
      getPublicStatusSurfaces: vi.fn().mockResolvedValue({
        asOf: "2026-09-12T04:00:00.000Z",
        monitoring: null,
        surfaces: [],
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
