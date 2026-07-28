import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<
  string,
  unknown
>;

async function mockRouter(loaderData: unknown, actionData?: unknown) {
  vi.doMock("react-router", async () => {
    const actual =
      await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement(
          "a",
          { ...props, href: typeof to === "string" ? to : "" },
          children,
        ),
      useActionData: vi.fn().mockReturnValue(actionData),
      // BL-025: the setup card's create-watchlist submit is a fetcher, so it
      // never navigates and never leaves `/app?index` in the address bar.
      useFetcher: vi.fn().mockReturnValue({
        Form: ({ children, ...props }: MockFormProps) =>
          React.createElement("form", props, children),
        data: undefined,
        state: "idle",
        submit: vi.fn(),
      }),
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
      totalCount: 1,
      items: [
        {
          id: "first_competitor",
          label: "First competitor",
          status: "needs_setup",
          detail: "Paste one competitor website to start.",
          action: { label: "Search competitor", href: "/search" },
        },
      ],
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

    const { default: AppDashboardRoute } =
      await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain('id="setup-checklist"');
    expect(markup).toContain("Setup · 0 of 1 done");
    expect(markup).toContain("Finish the workspace that sends your first brief");
    expect(markup).toContain("First competitor");
    expect(markup).toContain('aria-current="step"');
    expect(markup).toContain("Competitor website");
    expect(markup).toContain("Track this competitor");
    expect(markup).toContain("Add several competitors by paste or CSV");
    expect(markup).toContain("Search first instead");
    expect(markup).toContain("Add your brand website");
    expect(markup).not.toContain("f9-first-run-spine");
    expect(markup.match(/f9-ed-cta--rank1/g)?.length ?? 0).toBe(1);

    // BL-025 — the step state is ONE §6.3 status strip, not four repeated
    // title+sentence rows (§6.6 kills the micro-label stack). Every step still
    // states itself in words, so colour is never the only channel (§10).
    expect(markup).toContain("f9-ed-setup-track");
    expect(markup).toContain("f9-ed-status-cell");
    expect(markup).toContain(">Now<");
    expect(markup).not.toContain("f9-ed-setup-row");
    expect(markup).not.toContain("f9-ed-setup-stamp");
    expect(markup).not.toContain("f9-ed-setup-list");

    // The ink treatment is an accent STRIP carrying mono only. The display
    // headline moved onto the card surface, so the inverted block can never
    // grow into a full-height sheet again.
    expect(markup).toContain("f9-ed-setup-strip");
    expect(markup).not.toContain("f9-ed-setup-header");
    const strip = markup.slice(
      markup.indexOf("f9-ed-setup-strip"),
      markup.indexOf("f9-ed-setup-track"),
    );
    expect(strip).not.toContain("<h2");

    // §5: the single Rank-1 is never rendered disabled — the action answers an
    // empty or malformed website with its own honest message.
    expect(markup).not.toMatch(/f9-ed-cta--rank1[^>]*disabled/);

    // BL-025 F2 — action feedback renders in the card's own language. The
    // Vercel-era `.f9-message` pill (18px radius / soft shadow, or 12px under
    // `.f9-dash-page`) must not appear inside an Evidence Desk card.
    expect(markup).toContain("f9-ed-setup-action");
    expect(markup).not.toContain('class="f9-message');
  });

  it("keeps the filed brief reachable while setup still has another step", async () => {
    await mockRouter(
      baseDashboardData({
        digests: [{ id: "digest-1", delivery: { status: "sent" } }],
      }),
    );

    const { default: AppDashboardRoute } =
      await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain('href="/app/digests?firstrun=1"');
    expect(markup).toContain("Read latest brief");
    expect(markup).toContain('class="f9-ed-cta f9-ed-cta--rank2"');
    expect(markup.match(/f9-ed-cta--rank1/g)?.length ?? 0).toBe(1);
  });

  it("restores the state-specific Overview action after setup is complete", async () => {
    await mockRouter(
      baseDashboardData({
        watchlists: [
          {
            id: "watchlist-1",
            name: "Rival watch",
            targetType: "advertiser",
            targetLabel: "Rival Labs",
            isActive: true,
            lastScannedAt: "2026-06-20T08:00:00.000Z",
          },
        ],
        digests: [{ id: "digest-1", delivery: { status: "sent" } }],
        recentEvents: [
          {
            id: "event-1",
            watchlistId: "watchlist-1",
            eventType: "offer_change",
            title: "Rival Labs changed its offer",
            summary: "A confirmed competitor move is ready to review.",
            status: "confirmed",
            metadata: {},
          },
        ],
        workspaceReadiness: {
          readyCount: 4,
          totalCount: 4,
          items: [
            ...["first_competitor", "first_watchlist", "first_proof", "first_digest"].map((id) => ({
              id,
              label: id,
              status: "ready",
              detail: "Durable activation step complete.",
              action: null,
            })),
          ],
          nudges: [],
          counts: { agentMemoryEntries: 0, competitors: 1, activeWatchlists: 1 },
        },
      }),
    );

    const { default: AppDashboardRoute } =
      await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("Review moves");
    expect(markup).toContain('href="/app/watchlists"');
    expect(markup).not.toContain("Read latest brief");
  });

  it("surfaces retention moves without showing low-priority optional setup", async () => {
    await mockRouter(
      baseDashboardData({
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
              detail:
                "Open Digests after the first monitored change or quiet check to confirm the delivery trail.",
              href: "/app/digests",
              priority: "medium",
            },
            {
              id: "billing_support",
              title: "Cancellation and help path",
              detail:
                "Plan changes start from billing; cancellation, receipts, invoices, and sensitive requests keep a support path.",
              href: "/app/support?category=billing",
              priority: "low",
            },
            {
              id: "agent_setup",
              title: "Developer access is missing",
              detail:
                "Create a read key for exports; enable approved actions only for trusted workflows.",
              href: "/app/developer-access",
              priority: "low",
            },
            {
              id: "client_room_setup",
              title: "No client room yet",
              detail:
                "Group one watchlist or report into a client room before agency handoff.",
              href: "/app/clients",
              priority: "low",
            },
          ],
          counts: {
            agentMemoryEntries: 0,
          },
        },
      }),
    );

    const { default: AppDashboardRoute } =
      await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("Next moves");
    expect(markup).toContain("Keep your overview useful");
    expect(markup).toContain("No first digest yet");
    expect(markup).toContain("/app/digests");
    expect(markup).not.toContain("Cancellation and help path");
    expect(markup).not.toContain("Developer access is missing");
    expect(markup).not.toContain("No client room yet");
  });

  it("does not resurrect setup for volatile source, billing, or delivery health", async () => {
    await mockRouter(
      baseDashboardData({
        workspaceReadiness: {
          readyCount: 4,
          totalCount: 7,
          items: [
            ...["first_competitor", "first_watchlist", "first_proof", "first_digest"].map((id) => ({
              id,
              label: id,
              status: id === "first_watchlist" ? "attention" : "ready",
              detail:
                id === "first_watchlist"
                  ? "A watchlist exists but is paused."
                  : "Durable activation step complete.",
              action: null,
            })),
            {
              id: "source",
              label: "Source access",
              status: "attention",
              detail: "Provider health is temporarily degraded.",
              action: { label: "Open source access", href: "/app/source-access" },
            },
            {
              id: "billing",
              label: "Billing",
              status: "attention",
              detail: "Payment needs attention.",
              action: { label: "Open billing", href: "/app/billing" },
            },
            {
              id: "delivery",
              label: "Delivery",
              status: "needs_proof",
              detail: "Delivery needs a fresh check.",
              action: { label: "Open notifications", href: "/app/notifications" },
            },
          ],
          nudges: [],
          counts: { agentMemoryEntries: 0, competitors: 1, successfulProofs: 1 },
        },
      }),
    );

    const { default: AppDashboardRoute } =
      await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).not.toContain('id="setup-checklist"');
    expect(markup).not.toContain("Finish the workspace that sends your first brief");
  });

  it("replaces bulk import with the plan path when competitor capacity is full", async () => {
    await mockRouter(
      baseDashboardData({
        workspaceReadiness: {
          readyCount: 2,
          totalCount: 7,
          items: [
            {
              id: "first_competitor",
              label: "First competitor",
              status: "ready",
              detail: "One competitor saved.",
              action: null,
            },
            {
              id: "first_watchlist",
              label: "First watchlist",
              status: "ready",
              detail: "One active watchlist.",
              action: null,
            },
            {
              id: "first_proof",
              label: "First evidence",
              status: "needs_setup",
              detail: "Capture the first evidence.",
              action: { label: "Capture evidence", href: "/app/watchlists" },
            },
            {
              id: "first_digest",
              label: "First digest",
              status: "needs_setup",
              detail: "Wait for the first brief.",
              action: { label: "Open digests", href: "/app/digests" },
            },
          ],
          billing: { plan: "free" },
          nudges: [],
          counts: { agentMemoryEntries: 0, competitors: 1, activeWatchlists: 1 },
        },
      }),
    );

    const { default: AppDashboardRoute } =
      await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).not.toContain("Add several competitors by paste or CSV");
    expect(markup).toContain("Your current plan is at its competitor limit.");
    expect(markup).toContain("/app/billing?source=setup-checklist#plans");
  });

  it("keeps the next setup action after an unusable import preview", async () => {
    await mockRouter(baseDashboardData(), {
      ok: false,
      intent: "preview-market-desk-import",
      message: "No ready competitors found.",
      preview: {
        error: null,
        selectedCount: 0,
        rows: [],
        summary: {
          valid: 0,
          over_cap: 0,
          duplicate: 0,
          existing: 0,
          invalid: 1,
        },
      },
    });

    const { default: AppDashboardRoute } =
      await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("Track this competitor");
    expect(markup).toContain("No ready competitors found.");
    expect(markup).not.toContain("Create 0 watchlists");
    expect(markup.match(/f9-ed-cta--rank1/g)?.length ?? 0).toBe(1);
  });

  it("keeps unrelated dashboard feedback out of the setup live region", async () => {
    await mockRouter(baseDashboardData(), {
      ok: true,
      intent: "close-counter-move",
      message: "Marked done.",
    });

    const { default: AppDashboardRoute } =
      await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain('id="setup-checklist"');
    expect(markup.match(/Marked done\./g)?.length ?? 0).toBe(1);
  });

  it("uses active watchlists, not paused history, for import capacity", async () => {
    await mockRouter(
      baseDashboardData({
        workspaceReadiness: {
          readyCount: 2,
          totalCount: 7,
          items: [
            {
              id: "first_competitor",
              label: "First competitor",
              status: "ready",
              detail: "Two competitors saved.",
              action: null,
            },
            {
              id: "first_watchlist",
              label: "First watchlist",
              status: "attention",
              detail: "Both watchlists are paused.",
              action: { label: "Add a competitor", href: "/app/watchlists" },
            },
            {
              id: "first_proof",
              label: "First evidence",
              status: "needs_setup",
              detail: "Capture the first evidence.",
              action: { label: "Capture evidence", href: "/app/watchlists" },
            },
            {
              id: "first_digest",
              label: "First digest",
              status: "needs_setup",
              detail: "Wait for the first brief.",
              action: { label: "Open digests", href: "/app/digests" },
            },
          ],
          billing: { plan: "free" },
          nudges: [],
          counts: {
            agentMemoryEntries: 0,
            competitors: 2,
            activeWatchlists: 0,
          },
        },
      }),
    );

    const { default: AppDashboardRoute } =
      await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("Add several competitors by paste or CSV");
    expect(markup).not.toContain("Your current plan is at its competitor limit.");
  });

  it("shows the first setup loop complete when scan, proof, delivery, and context exist", async () => {
    await mockRouter(
      baseDashboardData({
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
              action: {
                label: "Open notifications",
                href: "/app/notifications",
              },
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
      }),
    );

    const { default: AppDashboardRoute } =
      await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("Overview");
    expect(markup).toContain("Brief");
    expect(markup).toContain("Quiet check completed");
    expect(markup).toContain("0 ads checked across 1 competitor");
    expect(markup).toContain(
      "Completed checks found no action-worthy movement",
    );
    expect(markup).toContain("Competitors watched");
    expect(markup).toContain("Evidence checks");
    expect(markup).toContain("Being watched");
    expect(markup).not.toContain('id="setup-checklist"');
    expect(markup).not.toContain("First 15 minutes");
    expect(markup).not.toContain("Retained value loop");
  });

  it("shows paused competitors as paused instead of active monitoring", async () => {
    await mockRouter(
      baseDashboardData({
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
        workspaceReadiness: {
          readyCount: 1,
          totalCount: 2,
          items: [
            {
              id: "first_competitor",
              label: "First competitor",
              status: "ready",
              detail: "1 competitor saved.",
              action: null,
            },
            {
              id: "first_watchlist",
              label: "First watchlist",
              status: "attention",
              detail: "A watchlist exists but is paused.",
              action: { label: "Add a competitor", href: "/app/watchlists" },
            },
          ],
          nudges: [],
          counts: { agentMemoryEntries: 0 },
        },
      }),
    );

    const { default: AppDashboardRoute } =
      await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("Tracking is paused");
    expect(markup).toContain("Resume a competitor watch");
    expect(markup).toContain("Add a competitor");
    expect(markup).toContain("/app/watchlists");
    expect(markup).toContain("All paused");
    expect(markup).toContain("Paused");
    expect(markup).not.toContain("Watching for the next change");
    expect(markup).not.toContain("Your watchlist is ready");
    expect(markup).not.toContain("move need review");
    expect(markup).not.toContain("Review moves");
    expect(markup).not.toContain("Old offer changed");
  });

  it("keeps delivery incomplete until there is successful delivery proof", async () => {
    await mockRouter(
      baseDashboardData({
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
              detail:
                "A delivery target exists but needs successful delivery proof.",
              action: {
                label: "Open notifications",
                href: "/app/notifications",
              },
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
      }),
    );

    const { default: AppDashboardRoute } =
      await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("Quiet check completed");
    expect(markup).toContain("0 ads checked across 1 competitor");
    expect(markup).toContain("Being watched");
    expect(markup).not.toContain("First 15 minutes");
    expect(markup).not.toContain("Prove delivery");
    expect(markup).not.toContain("Retained value loop");
  });

  it("does not let stale delivery success override readiness", async () => {
    await mockRouter(
      baseDashboardData({
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
              detail:
                "A delivery target exists but needs fresh successful delivery proof.",
              action: {
                label: "Open notifications",
                href: "/app/notifications",
              },
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
      }),
    );

    const { default: AppDashboardRoute } =
      await import("~/routes/app.dashboard");
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
    await mockRouter(
      baseDashboardData({
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
              detail:
                "Digest history exists, but no active delivery target is configured.",
              action: {
                label: "Open notifications",
                href: "/app/notifications",
              },
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
      }),
    );

    const { default: AppDashboardRoute } =
      await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("Watching for the next change");
    expect(markup).toContain("Your watchlist is ready.");
    expect(markup).toContain("Briefs sent");
    expect(markup).toContain("Email trail active");
    expect(markup).not.toContain("Set delivery");
    expect(markup).not.toContain("A successful delivery trail exists");
    expect(markup).not.toContain("Retained value loop");
  });

  it("prioritizes open counter-move briefs over quiet scan copy", async () => {
    await mockRouter(
      baseDashboardData({
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
              action: {
                label: "Open notifications",
                href: "/app/notifications",
              },
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
      }),
    );

    const { default: AppDashboardRoute } =
      await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("1 follow-up to decide");
    expect(markup).toContain("Responses waiting on you");
    expect(markup).toContain("Review changes");
    expect(markup).toContain("Review Nykaa move");
    expect(markup).not.toContain("no urgent competitor move is waiting");
    expect(markup).not.toContain("No changes worth your time");
  });
});
