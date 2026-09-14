import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { presenceSourceCoverageForDocs } from "~/lib/presence-source-coverage.server";

/**
 * The /status App-stores per-source row (issue #3210's acceptance). Kept in
 * its own file because `tests/status.route.test.ts` sits at the 800-line
 * ceiling the file-size ratchet enforces — the same split
 * `tests/status-route-youtube.test.ts` (#3203) already took.
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

describe("status route — the App-stores mention-source row (issue #3210)", () => {
  it("publishes the appstore row wired-but-gated in the loader catalog", async () => {
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

    // Issue #3210 — the App-stores row reads wired-but-gated the same way as
    // the sibling slices: the connector ships in, but stays dark until its
    // rollout flag lands. The note names what the public surfaces cover and
    // the honest Play-reviews exclusion.
    const mentionSources = result.mentionSources as Array<{
      sourceId: string;
      productionStatus: string;
      notes: string;
    }>;
    expect(Array.isArray(mentionSources)).toBe(true);
    const appstoreRow = mentionSources.find((source) => source.sourceId === "appstore");
    expect(appstoreRow).toBeDefined();
    expect(appstoreRow?.productionStatus).toBe("gated");
    expect(appstoreRow?.notes).toContain("customer-review RSS feed");
    expect(appstoreRow?.notes).toContain("PRESENCE_APPSTORE_ROLLOUT");
  });

  it("renders the App-stores tracked-source row — the public listings + reviews surface", async () => {
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
    // The appstore per-source row (the #3210 acceptance) renders its posture
    // verbatim from the catalog: the Apple listing + most-recent-review
    // surface, the Play structured-data surface, the honest Play-reviews
    // exclusion, the kill flag, still gated.
    expect(markup).toContain("App stores");
    expect(markup).toContain("App-stores mention connector wired in");
    expect(markup).toContain("customer-review RSS feed");
    expect(markup).toContain("SoftwareApplication structured data");
    expect(markup).toContain("PRESENCE_APPSTORE_ROLLOUT");
    expect(markup).toContain("gated");
  });
});
