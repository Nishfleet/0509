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

    expect(markup).toContain("Market Desk Brief");
    expect(markup).toContain("Build your Market Desk");
    expect(markup).toContain("Add your first competitor");
    expect(markup).toContain("Add competitors");
    expect(markup).toContain("Competitor website");
    expect(markup).toContain("Search ads");
    expect(markup).toContain("f9-primary-button");
    expect(markup).toContain("href=\"/app/onboard?resume=1\"");
  });

  it("surfaces retention moves without showing low-priority optional setup", async () => {
    await mockRouter(baseDashboardData({
      workspaceReadiness: {
        generatedAt: "2026-06-20T00:00:00.000Z",
        readyCount: 4,
        totalCount: 4,
        items: [],
        nextActions: [],
        nudges: [
          {
            id: "first_digest",
            title: "No first digest yet",
            detail: "Open Digests after the first monitored change or quiet check to confirm the delivery trail.",
            href: "/app/digests",
            priority: "medium",
          },
          {
            id: "billing_support",
            title: "Cancellation and help path",
            detail: "Plan changes, cancellation, receipts, invoices, and sensitive requests now open as support cases.",
            href: "/app/support?category=billing",
            priority: "low",
          },
          {
            id: "agent_setup",
            title: "Developer access is missing",
            detail: "Create a read key for exports; enable approved actions only for trusted workflows.",
            href: "/app/sources",
            priority: "low",
          },
          {
            id: "client_room_setup",
            title: "No client room yet",
            detail: "Group one watchlist or report into a client room before agency handoff.",
            href: "/app/clients",
            priority: "low",
          },
        ],
        counts: {
          agentMemoryEntries: 0,
        },
      },
    }));

    const { default: AppDashboardRoute } = await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("Next moves");
    expect(markup).toContain("Keep the Market Desk useful");
    expect(markup).toContain("No first digest yet");
    expect(markup).toContain("/app/digests");
    expect(markup).not.toContain("Cancellation and help path");
    expect(markup).not.toContain("Developer access is missing");
    expect(markup).not.toContain("No client room yet");
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

    expect(markup).toContain("Overview");
    expect(markup).toContain("Market Desk Brief");
    expect(markup).toContain("Quiet check completed");
    expect(markup).toContain("0 ads checked across 1 competitor");
    expect(markup).toContain("Completed checks found no action-worthy movement");
    expect(markup).toContain("Competitors watched");
    expect(markup).toContain("Evidence checks");
    expect(markup).toContain("Being watched");
    expect(markup).not.toContain("First 15 minutes");
    expect(markup).not.toContain("Retained value loop");
  });

  it("shows paused competitors as paused instead of active monitoring", async () => {
    await mockRouter(baseDashboardData({
      watchlists: [
        {
          id: "watchlist-1",
          name: "Nykaa watch",
          targetType: "advertiser",
          targetLabel: "Nykaa",
          isActive: false,
          lastScannedAt: "2026-06-20T08:00:00.000Z",
        },
      ],
      recentEvents: [
        {
          id: "event-1",
          watchlistId: "watchlist-1",
          eventType: "offer_change",
          title: "Old offer changed",
          summary: "Historical change from before tracking was paused.",
          status: "confirmed",
          createdAt: "2026-06-20T08:10:00.000Z",
        },
      ],
    }));

    const { default: AppDashboardRoute } = await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("Tracking is paused");
    expect(markup).toContain("Resume a competitor watch");
    expect(markup).toContain("Resume watch");
    expect(markup).toContain("All paused");
    expect(markup).toContain("Paused");
    expect(markup).not.toContain("Watching for the first change");
    expect(markup).not.toContain("Your watchlist is ready");
    expect(markup).not.toContain("move need review");
    expect(markup).not.toContain("Review moves");
    expect(markup).not.toContain("Old offer changed");
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

    expect(markup).toContain("Quiet check completed");
    expect(markup).toContain("0 ads checked across 1 competitor");
    expect(markup).toContain("Being watched");
    expect(markup).not.toContain("First 15 minutes");
    expect(markup).not.toContain("Prove delivery");
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

    expect(markup).toContain("Quiet check completed");
    expect(markup).toContain("0 ads checked across 1 competitor");
    expect(markup).toContain("Being watched");
    expect(markup).not.toContain("First 15 minutes");
    expect(markup).not.toContain("Prove delivery");
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

    expect(markup).toContain("Watching for the first change");
    expect(markup).toContain("Your watchlist is ready.");
    expect(markup).toContain("Digests sent");
    expect(markup).toContain("Email trail active");
    expect(markup).not.toContain("Set delivery");
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

    expect(markup).toContain("1 follow-up to decide");
    expect(markup).toContain("Responses waiting on you");
    expect(markup).toContain("Review changes");
    expect(markup).toContain("Review Nykaa move");
    expect(markup).not.toContain("no urgent competitor move is waiting");
    expect(markup).not.toContain("No changes worth your time");
  });
});
