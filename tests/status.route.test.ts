import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { presenceSourceCoverageForDocs } from "~/lib/presence-source-coverage.server";

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

    // Issue #3205 — the loader publishes the tracked-source catalog, and the
    // Threads row stays honest: wired in, still gated.
    const mentionSources = result.mentionSources as Array<{
      sourceId: string;
      productionStatus: string;
      notes: string;
    }>;
    expect(Array.isArray(mentionSources)).toBe(true);
    const threadsRow = mentionSources.find((source) => source.sourceId === "threads");
    expect(threadsRow).toBeDefined();
    expect(threadsRow?.productionStatus).toBe("gated");

<<<<<<< HEAD
    // Issue #3199 — the Substack public surface rides the rss connector, so
    // its /status per-source row IS the rss row: wired in, gated, and the
    // note names what the surface covers (Substack) and what it does not
    // (no free global keyword search).
    const rssRow = mentionSources.find((source) => source.sourceId === "rss");
    expect(rssRow).toBeDefined();
    expect(rssRow?.productionStatus).toBe("gated");
    expect(rssRow?.notes).toContain("Substack");
=======
    // Issue #3203 — the YouTube row reads wired-but-gated the same way: the
    // connector ships in, but stays dark until its rollout flag and the
    // Google API key land. The note names what the surface covers.
    const youtubeRow = mentionSources.find((source) => source.sourceId === "youtube");
    expect(youtubeRow).toBeDefined();
    expect(youtubeRow?.productionStatus).toBe("gated");
    expect(youtubeRow?.notes).toContain("YouTube Data API v3 search.list");
    expect(youtubeRow?.notes).toContain("PRESENCE_YOUTUBE_ROLLOUT");
>>>>>>> 8909a1591 (wip(salvage): pi-issue-0509-3203 success/0)
  });

  it("renders the tracked-source rows — the Threads mention source reads gated (issue #3205)", async () => {
    await mockRouter(() => ({
      generatedAt: "2026-09-13T16:00:00.000Z",
      asOf: "2026-09-13T16:00:00.000Z",
      appServed: true,
      commercialLaunch: null,
      monitoring: null,
      surfaces: { asOf: "2026-09-13T16:00:00.000Z", monitoring: null, surfaces: [] },
      mentionSources: presenceSourceCoverageForDocs(),
    }));

    const { default: StatusRoute } = await import("~/routes/status");
    const markup = renderToStaticMarkup(createElement(StatusRoute));

    expect(markup).toContain("Tracked sources");
    // The Threads per-source row (issue #3205's acceptance) renders its
    // posture verbatim from the catalog — wired in, waiting on its rollout.
    expect(markup).toContain("Threads");
    expect(markup).toContain("gated");
    expect(markup).toContain("Meta app review");
    expect(markup).toContain("wired in, waiting on its rollout decision");
<<<<<<< HEAD
    // The whole catalog passes through untouched. #3204 wired the LinkedIn
    // connector, flipping its row from "unavailable" to "gated" — the
    // tracked-source catalog no longer carries an "unavailable" posture.
=======
    // The YouTube per-source row (issue #3203's acceptance) renders its
    // posture verbatim from the catalog — wired in, waiting on its rollout
    // flag and key, with its 100-calls/day documented rate budget named.
    expect(markup).toContain("YouTube");
    expect(markup).toContain("PRESENCE_YOUTUBE_ROLLOUT");
    expect(markup).toContain("100 search.list calls/day");
    // The whole catalog passes through untouched, including the source whose
    // posture only exists at runtime.
>>>>>>> 8909a1591 (wip(salvage): pi-issue-0509-3203 success/0)
    expect(markup).toContain("GDELT");
    expect(markup).toContain("own-organization posts of a CONNECTED account");
    expect(markup).not.toContain("unavailable");
    // The Substack row (issue #3199's acceptance) rides the rss row, and the
    // note renders what the public surface covers — the named publication
    // feeds themselves, Substack included — and its limits, verbatim.
    expect(markup).toContain("Substack");
    expect(markup).toContain("no free global keyword search");
  });

  it("renders the rss tracked-source row — the publication-feed surface the Medium mentions ride (issue #3200)", async () => {
    await mockRouter(() => ({
      generatedAt: "2026-09-13T16:00:00.000Z",
      asOf: "2026-09-13T16:00:00.000Z",
      appServed: true,
      commercialLaunch: null,
      monitoring: null,
      surfaces: { asOf: "2026-09-13T16:00:00.000Z", monitoring: null, surfaces: [] },
      mentionSources: presenceSourceCoverageForDocs(),
    }));

    const { default: StatusRoute } = await import("~/routes/status");
    const markup = renderToStaticMarkup(createElement(StatusRoute));

    expect(markup).toContain("Tracked sources");
    // The rss per-source row (the #3200 acceptance) renders its posture
    // verbatim from the catalog: the publication-feed mention backbone, what
    // the Medium public surface covers, the rate budget, still gated.
    expect(markup).toContain("RSS / Atom / JSON Feed");
    expect(markup).toContain("publication-feed mention backbone");
    expect(markup).toContain("Medium /feed/");
    expect(markup).toContain("one bounded fetch per feed per poll");
    expect(markup).toContain("gated");
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

  it("reads the Agency checkout state the same measured way as Scout and Starter", async () => {
    await mockRouter(() => ({
      generatedAt: "2026-06-20T09:00:00.000Z",
      asOf: "2026-06-20T09:00:00.000Z",
      appServed: true,
      commercialLaunch: { scoutSaleOpen: true, starterSaleOpen: true, agencySaleOpen: true },
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

    expect(markup).toContain(
      "Checkout enabled: Agency monthly products are configured with the billing provider.",
    );
    expect(markup).toContain(
      "Checkout enabled: Scout monthly products are configured with the billing provider.",
    );
    expect(markup).toContain(
      "Checkout enabled: Starter monthly products are configured with the billing provider.",
    );
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
            reason: "the live uptime probe has not recorded a sample yet",
            facts: [],
            checkedAt: "2026-09-12T04:00:00.000Z",
            source: "status_probe_samples uptime probe",
          },
        ],
      },
    }));

    const { default: StatusRoute } = await import("~/routes/status");
    const markup = renderToStaticMarkup(createElement(StatusRoute));

    expect(markup).toContain("<strong>Down</strong>: the database probe failed.");
    expect(markup).toContain("<strong>Degraded</strong>: the live uptime probe has not recorded a sample yet.");
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
