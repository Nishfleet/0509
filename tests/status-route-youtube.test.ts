import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { presenceSourceCoverageForDocs } from "~/lib/presence-source-coverage.server";

/**
 * The /status YouTube per-source row (issue #3203's acceptance). Kept in its
 * own file because `tests/status.route.test.ts` sits at the 800-line ceiling
 * the file-size ratchet enforces — the same split the ratchet's docstring
 * prescribes for new per-source pins.
 */

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
  vi.useFakeTimers({ now: new Date(Date.now()) });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("status route — the YouTube mention-source row (issue #3203)", () => {
  it("publishes the youtube row wired-but-gated in the loader catalog", async () => {
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

    // Issue #3203 — the YouTube row reads wired-but-gated the same way as the
    // sibling slices: the connector ships in, but stays dark until its
    // rollout flag and the Google API key land. The note names what the
    // surface covers.
    const mentionSources = result.mentionSources as Array<{
      sourceId: string;
      productionStatus: string;
      notes: string;
    }>;
    expect(Array.isArray(mentionSources)).toBe(true);
    const youtubeRow = mentionSources.find((source) => source.sourceId === "youtube");
    expect(youtubeRow).toBeDefined();
    expect(youtubeRow?.productionStatus).toBe("gated");
    expect(youtubeRow?.notes).toContain("YouTube Data API v3 search.list");
    expect(youtubeRow?.notes).toContain("PRESENCE_YOUTUBE_ROLLOUT");
  });

  it("renders the YouTube tracked-source row — wired in, gated, rate budget named", async () => {
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
    // The YouTube per-source row (issue #3203's acceptance) renders its
    // posture verbatim from the catalog — wired in, waiting on its rollout
    // flag and key, with its 100-calls/day documented rate budget named.
    expect(markup).toContain("YouTube");
    expect(markup).toContain("gated");
    expect(markup).toContain("PRESENCE_YOUTUBE_ROLLOUT");
    expect(markup).toContain("100 search.list calls/day");
  });
});
