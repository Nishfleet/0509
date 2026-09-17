import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function mockRouter(useLoaderData: () => unknown) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    return {
      ...actual,
      Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
        createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
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

describe("status non-Meta ad coverage (#2992)", () => {
  it("reports the measured share with its denominator", async () => {
    await mockRouter(() => ({
      generatedAt: "2026-09-13T09:00:00.000Z",
      asOf: "2026-09-13T09:30:00.000Z",
      appServed: true,
      commercialLaunch: null,
      monitoring: {
        lastWatchlistRunAt: "2026-09-13T03:00:00.000Z",
        runsInLast24h: 12,
        failedRunsInLast24h: 0,
        lastDigestSentAt: "2026-09-12T00:00:00.000Z",
        digestHealth: "recent" as const,
        scheduledMonitoringSince: "2026-09-01T00:00:00.000Z",
        nonMetaAdCoverage: { tracked: 4, covered: 2 },
      },
      surfaces: { asOf: "2026-09-13T09:30:00.000Z", monitoring: null, surfaces: [] },
    }));

    const { default: StatusRoute } = await import("~/routes/status");
    const markup = renderToStaticMarkup(createElement(StatusRoute));

    expect(markup).toContain("Non-Meta ad coverage");
    expect(markup).toContain(
      "2 of 4 active watchlists (50%) have at least one captured ad from the Google, LinkedIn, or TikTok sources",
    );
    expect(markup).toContain("as of 2026-09-13T09:30:00.000Z");
  });

  it("renders 0% while no watchlist is tracked", async () => {
    await mockRouter(() => ({
      generatedAt: "2026-09-13T09:00:00.000Z",
      asOf: "2026-09-13T09:30:00.000Z",
      appServed: true,
      commercialLaunch: null,
      monitoring: {
        lastWatchlistRunAt: "2026-09-13T03:00:00.000Z",
        runsInLast24h: 3,
        failedRunsInLast24h: 0,
        lastDigestSentAt: "2026-09-12T00:00:00.000Z",
        digestHealth: "recent" as const,
        scheduledMonitoringSince: "2026-09-01T00:00:00.000Z",
        nonMetaAdCoverage: { tracked: 0, covered: 0 },
      },
      surfaces: { asOf: "2026-09-13T09:30:00.000Z", monitoring: null, surfaces: [] },
    }));

    const { default: StatusRoute } = await import("~/routes/status");
    const markup = renderToStaticMarkup(createElement(StatusRoute));

    expect(markup).toContain("0 of 0 active watchlists (0%)");
  });
});
