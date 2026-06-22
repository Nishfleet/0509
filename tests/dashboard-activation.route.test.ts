import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

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
      useRevalidator: vi.fn().mockReturnValue({ revalidate: vi.fn() }),
    };
  });
}

function baseDashboardData(overrides: Record<string, unknown> = {}) {
  return {
    savedQueries: [],
    collections: [],
    watchlists: [],
    digests: [],
    recentEvents: [],
    recentProofCaptures: [],
    deliveryTargets: [],
    metaStatus: {
      status: "healthy",
      summary: "Healthy",
      lastCheckedAt: null,
    },
    proofUsage: {
      warningLevel: "ok",
      used: 0,
      limit: 250,
      remaining: 250,
      plan: "starter",
    },
    overnightStats: {
      runs: 0,
      watchlistsChecked: 0,
      adsSeen: 0,
    },
    successfulProofStats: {
      count: 0,
      latestAt: null,
    },
    workspaceReadiness: {
      generatedAt: "2026-06-20T00:00:00.000Z",
      readyCount: 0,
      totalCount: 0,
      items: [],
      nextActions: [],
      nudges: [],
      counts: {
        agentMemoryEntries: 0,
      },
    },
    agentMemories: [],
    counterMoveFollowUps: [],
    plan: "starter",
    teamMemberCount: 1,
    nextScanLabel: "tonight",
    hasPaymentIssue: false,
    checkoutReturn: false,
    customerMetaConnection: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("dashboard first 15 minutes activation", () => {
  it("gives a brand-new account one clear first move", async () => {
    await mockRouter(baseDashboardData());

    const { default: AppDashboardRoute } = await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("First 15 minutes");
    expect(markup).toContain("Add one competitor");
    expect(markup).toContain("No market watch yet");
    expect(markup).toContain("00-02");
    expect(markup).toContain("Paste one competitor website");
    expect(markup).toContain("href=\"/search\"");
  });

  it("shows the first setup loop complete when scan, proof, delivery, and context exist", async () => {
    await mockRouter(baseDashboardData({
      watchlists: [
        {
          id: "watchlist-1",
          name: "Nykaa watch",
          targetType: "advertiser",
          targetLabel: "Nykaa",
          isActive: true,
          lastScannedAt: "2026-06-20T08:00:00.000Z",
        },
      ],
      recentProofCaptures: [
        {
          id: "proof-1",
          status: "succeeded",
        },
      ],
      successfulProofStats: {
        count: 1,
        latestAt: "2026-06-20T08:00:00.000Z",
      },
      deliveryTargets: [
        {
          channel: "email",
          isOptedIn: true,
          isPaused: false,
          optedOutAt: null,
          lastSuccessfulDeliveryAt: "2026-06-20T08:05:00.000Z",
        },
      ],
      overnightStats: {
        runs: 1,
        watchlistsChecked: 1,
        adsSeen: 0,
      },
      workspaceReadiness: {
        generatedAt: "2026-06-20T00:00:00.000Z",
        readyCount: 1,
        totalCount: 1,
        items: [
          {
            id: "delivery",
            label: "Delivery proof",
            status: "ready",
            detail: "A delivery path has successful proof.",
            action: { label: "Open sources", href: "/app/sources" },
          },
        ],
        nextActions: [],
        nudges: [],
        counts: {
          agentMemoryEntries: 1,
        },
      },
      agentMemories: [
        {
          id: "memory-1",
          key: "review_cadence",
          scope: "workspace",
          preview: "Weekly review",
          updatedAt: "2026-06-20T08:00:00.000Z",
        },
      ],
    }));

    const { default: AppDashboardRoute } = await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("Today");
    expect(markup).toContain("Quiet check completed");
    expect(markup).toContain("0 ads checked across 1 competitor");
    expect(markup).toContain("1 evidence check");
    expect(markup).toContain("A delivery path has successful proof");
    expect(markup).toContain("Future reports and briefs can use saved goals, tone, and review preferences");
    expect(markup).toContain("Retained value loop");
    expect(markup).not.toContain("First 15 minutes");
  });

  it("keeps delivery incomplete until there is successful delivery proof", async () => {
    await mockRouter(baseDashboardData({
      watchlists: [
        {
          id: "watchlist-1",
          name: "Nykaa watch",
          targetType: "advertiser",
          targetLabel: "Nykaa",
          isActive: true,
          lastScannedAt: "2026-06-20T08:00:00.000Z",
        },
      ],
      recentProofCaptures: [
        {
          id: "proof-1",
          status: "succeeded",
        },
      ],
      successfulProofStats: {
        count: 1,
        latestAt: "2026-06-20T08:00:00.000Z",
      },
      deliveryTargets: [
        {
          channel: "email",
          isOptedIn: true,
          isPaused: false,
          optedOutAt: null,
          lastSuccessfulDeliveryAt: null,
        },
      ],
      overnightStats: {
        runs: 1,
        watchlistsChecked: 1,
        adsSeen: 0,
      },
      workspaceReadiness: {
        generatedAt: "2026-06-20T00:00:00.000Z",
        readyCount: 0,
        totalCount: 1,
        items: [
          {
            id: "delivery",
            label: "Delivery proof",
            status: "needs_proof",
            detail: "A delivery target exists but needs successful delivery proof.",
            action: { label: "Open sources", href: "/app/sources" },
          },
        ],
        nextActions: [],
        nudges: [],
        counts: {
          agentMemoryEntries: 1,
        },
      },
      agentMemories: [
        {
          id: "memory-1",
          key: "review_cadence",
          scope: "workspace",
          preview: "Weekly review",
          updatedAt: "2026-06-20T08:00:00.000Z",
        },
      ],
    }));

    const { default: AppDashboardRoute } = await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("First 15 minutes");
    expect(markup).toContain("Prove delivery");
    expect(markup).toContain("Delivery target is saved; send the first proof-backed brief");
    expect(markup).not.toContain("Retained value loop");
  });

  it("does not let stale delivery success override readiness", async () => {
    await mockRouter(baseDashboardData({
      watchlists: [
        {
          id: "watchlist-1",
          name: "Nykaa watch",
          targetType: "advertiser",
          targetLabel: "Nykaa",
          isActive: true,
          lastScannedAt: "2026-06-20T08:00:00.000Z",
        },
      ],
      recentProofCaptures: [
        {
          id: "proof-1",
          status: "succeeded",
        },
      ],
      successfulProofStats: {
        count: 1,
        latestAt: "2026-06-20T08:00:00.000Z",
      },
      deliveryTargets: [
        {
          channel: "email",
          isOptedIn: true,
          isPaused: false,
          optedOutAt: null,
          lastSuccessfulDeliveryAt: "2026-06-01T08:05:00.000Z",
        },
      ],
      overnightStats: {
        runs: 1,
        watchlistsChecked: 1,
        adsSeen: 0,
      },
      workspaceReadiness: {
        generatedAt: "2026-06-20T00:00:00.000Z",
        readyCount: 0,
        totalCount: 1,
        items: [
          {
            id: "delivery",
            label: "Delivery proof",
            status: "needs_proof",
            detail: "A delivery target exists but needs fresh successful delivery proof.",
            action: { label: "Open sources", href: "/app/sources" },
          },
        ],
        nextActions: [],
        nudges: [],
        counts: {
          agentMemoryEntries: 1,
        },
      },
      agentMemories: [
        {
          id: "memory-1",
          key: "review_cadence",
          scope: "workspace",
          preview: "Weekly review",
          updatedAt: "2026-06-20T08:00:00.000Z",
        },
      ],
    }));

    const { default: AppDashboardRoute } = await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("First 15 minutes");
    expect(markup).toContain("Prove delivery");
    expect(markup).toContain("Delivery target is saved; send the first proof-backed brief");
    expect(markup).not.toContain("A successful delivery trail exists");
    expect(markup).not.toContain("Retained value loop");
  });

  it("does not treat historical sent digests as current delivery proof", async () => {
    await mockRouter(baseDashboardData({
      watchlists: [
        {
          id: "watchlist-1",
          name: "Nykaa watch",
          targetType: "advertiser",
          targetLabel: "Nykaa",
          isActive: true,
          lastScannedAt: "2026-06-20T08:00:00.000Z",
        },
      ],
      recentProofCaptures: [
        {
          id: "proof-1",
          status: "succeeded",
        },
      ],
      successfulProofStats: {
        count: 1,
        latestAt: "2026-06-20T08:00:00.000Z",
      },
      digests: [
        {
          id: "digest-1",
          delivery: {
            status: "sent",
          },
        },
      ],
      deliveryTargets: [],
      workspaceReadiness: {
        generatedAt: "2026-06-20T00:00:00.000Z",
        readyCount: 0,
        totalCount: 1,
        items: [
          {
            id: "delivery",
            label: "Delivery proof",
            status: "needs_setup",
            detail: "Digest history exists, but no active delivery target is configured.",
            action: { label: "Open sources", href: "/app/sources" },
          },
        ],
        nextActions: [],
        nudges: [],
        counts: {
          agentMemoryEntries: 1,
        },
      },
      agentMemories: [
        {
          id: "memory-1",
          key: "review_cadence",
          scope: "workspace",
          preview: "Weekly review",
          updatedAt: "2026-06-20T08:00:00.000Z",
        },
      ],
    }));

    const { default: AppDashboardRoute } = await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("Set delivery");
    expect(markup).toContain("Add email or Slack so the proof reaches the team");
    expect(markup).not.toContain("A successful delivery trail exists");
    expect(markup).not.toContain("Retained value loop");
  });

  it("prioritizes open counter-move briefs over quiet scan copy", async () => {
    await mockRouter(baseDashboardData({
      watchlists: [
        {
          id: "watchlist-1",
          name: "Nykaa watch",
          targetType: "advertiser",
          targetLabel: "Nykaa",
          isActive: true,
          lastScannedAt: "2026-06-20T08:00:00.000Z",
        },
      ],
      recentProofCaptures: [
        {
          id: "proof-1",
          status: "succeeded",
        },
      ],
      successfulProofStats: {
        count: 1,
        latestAt: "2026-06-20T08:00:00.000Z",
      },
      deliveryTargets: [
        {
          channel: "email",
          isOptedIn: true,
          isPaused: false,
          optedOutAt: null,
          lastSuccessfulDeliveryAt: "2026-06-20T08:05:00.000Z",
        },
      ],
      overnightStats: {
        runs: 1,
        watchlistsChecked: 1,
        adsSeen: 0,
      },
      workspaceReadiness: {
        generatedAt: "2026-06-20T00:00:00.000Z",
        readyCount: 1,
        totalCount: 1,
        items: [
          {
            id: "delivery",
            label: "Delivery proof",
            status: "ready",
            detail: "A delivery path has successful proof.",
            action: { label: "Open sources", href: "/app/sources" },
          },
        ],
        nextActions: [],
        nudges: [],
        counts: {
          agentMemoryEntries: 1,
        },
      },
      agentMemories: [
        {
          id: "memory-1",
          key: "review_cadence",
          scope: "workspace",
          preview: "Weekly review",
          updatedAt: "2026-06-20T08:00:00.000Z",
        },
      ],
      counterMoveFollowUps: [
        {
          id: "follow-up-1",
          title: "Review Nykaa move",
          ownerLabel: "Growth lead",
          channelLabel: "Client room",
          expiresAt: "2026-06-24T02:00:00.000Z",
          status: "needs_review",
          openCount: 1,
        },
      ],
    }));

    const { default: AppDashboardRoute } = await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("1 brief needs a decision");
    expect(markup).toContain("Review briefs");
    expect(markup).toContain("Review Nykaa move");
    expect(markup).not.toContain("no urgent competitor move is waiting");
    expect(markup).not.toContain("No changes worth your time");
  });
});
