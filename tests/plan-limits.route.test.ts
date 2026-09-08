import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

function createContext() {
  return {
    cloudflare: {
      env: {},
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.doMock("~/lib/email-verification.server", () => ({
    isUserEmailVerified: vi.fn().mockResolvedValue(true),
    requireVerifiedEmailForRetention: vi.fn().mockResolvedValue({ ok: true }),
    emailUnverifiedActionResult: () => ({
      ok: false,
      error: "email_unverified",
      message: "Verify your email",
    }),
    requestEmailVerification: vi.fn().mockResolvedValue({ ok: true }),
    EMAIL_UNVERIFIED_ERROR: "email_unverified",
    EMAIL_UNVERIFIED_MESSAGE: "Verify your email",
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/email-verification.server");
});

const session = {
  user: {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
    onboardedAt: "2026-04-02 18:30:00",
  },
  session: {
    id: "session-1",
    userId: "user-1",
    expiresAt: "2026-04-03T00:00:00.000Z",
  },
};

const emptyWorkspaceReadiness = {
  generatedAt: "2026-06-18T00:00:00.000Z",
  readyCount: 0,
  totalCount: 0,
  items: [],
  nextActions: [],
};

describe("search watchlist limit", () => {
  it("returns a structured limit prompt when the watchlist plan limit is reached", async () => {
    const createWatchlistWithinLimit = vi.fn().mockResolvedValue({
      status: "over_cap",
      watchlist: null,
      current: 3,
      limit: 3,
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
      session,
      workspaceUserId: session.user.id,
      isMember: false,
      ownerName: null,
    })),
    }));
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace: vi.fn(async (_env: unknown, id: string) => ({
        workspaceUserId: id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("scout"),
      checkPlanLimit: vi.fn().mockResolvedValue({
        allowed: false,
        current: 3,
        limit: 3,
      }),
    }));
    vi.doMock("~/lib/data.server", () => ({
      createSavedQuery: vi.fn(),
      createWatchlistWithinLimit,
      addAdToCollection: vi.fn(),
    }));

    const { action } = await import("~/routes/search");
    const formData = new FormData();
    formData.set("intent", "create-watchlist");
    formData.set("mode", "advertiser");
    formData.set("query", "boAt");
    formData.set("country", "India");
    formData.set("platform", "all");
    formData.set("creativeType", "all");
    formData.set("status", "all");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/search", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      current: 3,
      error: "plan_limit_exceeded",
      limit: 3,
      message: "You've reached your competitor tracking limit.",
      ok: false,
      upgradePath: "/app/billing?source=search#plans",
    });
    expect(createWatchlistWithinLimit).not.toHaveBeenCalled();
  });
});

describe("collection limit", () => {
  it("returns a structured limit prompt when the collection plan limit is reached", async () => {
    const createCollection = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
      session,
      workspaceUserId: session.user.id,
      isMember: false,
      ownerName: null,
    })),
    }));
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace: vi.fn(async (_env: unknown, id: string) => ({
        workspaceUserId: id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      checkPlanLimit: vi.fn().mockResolvedValue({
        allowed: false,
        current: 3,
        limit: 3,
      }),
      getUserPlan: vi.fn().mockResolvedValue("free"),
    }));
    vi.doMock("~/lib/data.server", () => ({
      addExternalProofToCollection: vi.fn(),
      createCollection,
      createCollectionWithinLimit: vi.fn(),
      createShareLink: vi.fn(),
      getCollection: vi.fn(),
      listCollectionItems: vi.fn(),
      listCollections: vi.fn().mockResolvedValue([]),
      updateCollectionItem: vi.fn(),
    }));

    const { action } = await import("~/routes/app.collections");
    const formData = new FormData();
    formData.set("intent", "create-collection");
    formData.set("name", "Top competitors");
    formData.set("description", "Notes");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/collections", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      current: 3,
      error: "plan_limit_exceeded",
      intent: "create-collection",
      limit: 3,
      message: "You've reached your collection limit.",
      ok: false,
    });
    expect(createCollection).not.toHaveBeenCalled();
  });

  it("adds an external proof link to the selected collection", async () => {
    const addExternalProofToCollection = vi.fn().mockResolvedValue({
      advertiser: "Mamaearth",
      platforms: ["LinkedIn"],
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
      session,
      workspaceUserId: session.user.id,
      isMember: false,
      ownerName: null,
    })),
    }));
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace: vi.fn(async (_env: unknown, id: string) => ({
        workspaceUserId: id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("free"),
      checkPlanLimit: vi.fn(),
    }));
    vi.doMock("~/lib/data.server", () => ({
      addExternalProofToCollection,
      createCollection: vi.fn(),
      createCollectionWithinLimit: vi.fn(),
      createShareLink: vi.fn(),
      getCollection: vi.fn(),
      listCollectionItems: vi.fn(),
      listCollections: vi.fn().mockResolvedValue([]),
      updateCollectionItem: vi.fn(),
    }));

    const { action } = await import("~/routes/app.collections");
    const formData = new FormData();
    formData.set("intent", "add-external-proof");
    formData.set("collectionId", "collection-1");
    formData.set("channel", "LinkedIn");
    formData.set("advertiser", "Mamaearth");
    formData.set("proofUrl", "https://www.linkedin.com/posts/mamaearth-campaign");
    formData.set("hook", "Creator-led sunscreen routine");
    formData.set("offer", "Combo launch");
    formData.set("cta", "Shop now");
    formData.set("note", "Seen in launch review.");
    formData.set("observedAt", "2026-06-06");
    formData.set("spend", "₹50k");
    formData.set("impressions", "120k");
    formData.set("reach", "80k");
    formData.set("tags", "creator, sunscreen");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/collections", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(addExternalProofToCollection).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "collection-1",
      {
        advertiser: "Mamaearth",
        proofUrl: "https://www.linkedin.com/posts/mamaearth-campaign",
        channel: "LinkedIn",
        hook: "Creator-led sunscreen routine",
        offer: "Combo launch",
        cta: "Shop now",
        note: "Seen in launch review.",
        observedAt: "2026-06-06",
        spend: "₹50k",
        impressions: "120k",
        reach: "80k",
        tags: ["creator", "sunscreen"],
      },
    );
    expect(result).toEqual({
      ok: true,
      intent: "add-external-proof",
      message: "Saved LinkedIn evidence for Mamaearth.",
    });
  });
});

describe("digest access", () => {
  it("returns locked digest access for free users", async () => {
    const listDigests = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
      session,
      workspaceUserId: session.user.id,
      isMember: false,
      ownerName: null,
    })),
    }));
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace: vi.fn(async (_env: unknown, id: string) => ({
        workspaceUserId: id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("free"),
      PLAN_LIMITS: {
        free: { digests: false },
        scout: { digests: true },
        starter: { digests: true },
        agency: { digests: true },
      },
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDigest: vi.fn(),
      listDeliveryAttempts: vi.fn(),
      listDigests,
    }));

    const { loader } = await import("~/routes/app.digests");
    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app/digests"),
    } as never);

    expect(result).toEqual({
      canAccessDigests: false,
      digests: [],
      selectedDigest: null,
    });
    expect(listDigests).not.toHaveBeenCalled();
  });

  it("allows Scout users to access digest history", async () => {
    const listDigests = vi.fn().mockResolvedValue([]);
    const listDeliveryAttempts = vi.fn().mockResolvedValue([]);

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
      session,
      workspaceUserId: session.user.id,
      isMember: false,
      ownerName: null,
    })),
    }));
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace: vi.fn(async (_env: unknown, id: string) => ({
        workspaceUserId: id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("scout"),
      PLAN_LIMITS: {
        free: { digests: false },
        scout: { digests: true },
        starter: { digests: true },
        agency: { digests: true },
      },
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDigest: vi.fn(),
      listDeliveryAttempts,
      listDigests,
    }));

    const { loader } = await import("~/routes/app.digests");
    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app/digests"),
    } as never);

    expect(result).toMatchObject({
      canAccessDigests: true,
      digests: [],
      selectedDigest: null,
    });
    expect(listDigests).toHaveBeenCalledWith(expect.anything(), "user-1");
    expect(listDeliveryAttempts).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      limit: 80,
    });
  });
});

describe("dashboard watchlist limit", () => {
  it("returns a structured limit prompt when the dashboard watchlist limit is reached", async () => {
    const createWatchlistWithinLimit = vi.fn().mockResolvedValue({
      status: "over_cap",
      watchlist: null,
      current: 3,
      limit: 3,
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
      session,
      workspaceUserId: session.user.id,
      isMember: false,
      ownerName: null,
    })),
    }));
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace: vi.fn(async (_env: unknown, id: string) => ({
        workspaceUserId: id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("free"),
      checkPlanLimit: vi.fn().mockResolvedValue({
        allowed: false,
        current: 3,
        limit: 3,
      }),
    }));
    vi.doMock("~/lib/data.server", () => ({
      createWatchlistWithinLimit,
      getSavedQuery: vi.fn().mockResolvedValue({
        id: "saved-query-1",
        name: "boAt",
        fingerprint: "fp-1",
        normalizedQuery: {
          filters: {
            country: "all",
          },
        },
      }),
      touchSavedQueryRun: vi.fn(),
    }));

    const { action } = await import("~/routes/app.dashboard");
    const formData = new FormData();
    formData.set("intent", "track-saved-query");
    formData.set("savedQueryId", "saved-query-1");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      current: 3,
      error: "plan_limit_exceeded",
      intent: "track-saved-query",
      limit: 3,
      message: "You've reached your competitor tracking limit — pause another watchlist first.",
      ok: false,
    });
    expect(createWatchlistWithinLimit).toHaveBeenCalled();
  });
});

describe("pricing CTA rendering", () => {
  async function mockRouter(overrides: {
    actionData?: unknown;
    loaderData?: unknown;
    rootData?: unknown;
  }) {
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");

      return {
        ...actual,
        Form: ({ children, ...props }: MockFormProps) =>
          React.createElement("form", props, children),
        Link: ({ children, to, ...props }: MockLinkProps) =>
          React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
        useActionData: vi.fn().mockReturnValue(overrides.actionData),
        useLoaderData: vi.fn().mockReturnValue(overrides.loaderData),
        useLocation: vi.fn().mockReturnValue({ pathname: "/search", search: "", hash: "", state: null, key: "test" }),
        useNavigate: vi.fn().mockReturnValue(vi.fn()),
        useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
        useRevalidator: vi.fn().mockReturnValue({ state: "idle", revalidate: vi.fn() }),
        useRouteLoaderData: vi.fn().mockReturnValue(overrides.rootData),
        useSearchParams: vi.fn().mockReturnValue([new URLSearchParams(), vi.fn()]),
      };
    });
  }

  it("points gated digest users at plans instead of a dead end", async () => {
    await mockRouter({
      actionData: undefined,
      loaderData: {
        canAccessDigests: false,
        digests: [],
        selectedDigest: null,
      },
    });

    const { default: DigestsRoute } = await import("~/routes/app.digests");
    const markup = renderToStaticMarkup(createElement(DigestsRoute));

    expect(markup).toContain("Competitor change briefs");
    expect(markup).toContain("See plans");
    expect(markup).toContain("/app/billing?source=digests#plans");
  });

  it("offers an upgrade path on dashboard plan-limit errors", async () => {
    await mockRouter({
      actionData: {
        ok: false,
        error: "plan_limit_exceeded",
        message: "You've reached your workspace watchlist limit.",
      },
      loaderData: {
        savedQueries: [],
        collections: [],
        watchlists: [],
        digests: [],
        metaStatus: {
          status: "healthy",
          summary: "Healthy",
          lastCheckedAt: null,
        },
        proofUsage: {
          warningLevel: "ok",
        },
        workspaceReadiness: emptyWorkspaceReadiness,
      },
    });

    const { default: AppDashboardRoute } = await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("reached your workspace watchlist limit.");
    expect(markup).toContain("View plans");
    expect(markup).toContain("/app/billing?source=dashboard-limit#plans");
  });

  it("reports the free weekly check honestly, with the paid cadence upsell", async () => {
    await mockRouter({
      loaderData: {
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
          limit: 0,
          remaining: 0,
          plan: "free",
        },
        overnightStats: {
          runs: 1,
          watchlistsChecked: 1,
          adsSeen: 0,
        },
        nextScanLabel: "tomorrow morning",
        workspaceReadiness: emptyWorkspaceReadiness,
      },
    });

    const { default: AppDashboardRoute } = await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("Weekly check complete");
    expect(markup).toContain("We checked 1 competitor — nothing moved. The next weekly check runs Monday.");
    expect(markup).toContain("Paid plans check every 3–6 hours and add instant alerts.");
    expect(markup).not.toContain("One-time activation check");
    expect(markup).not.toContain("All quiet");
    expect(markup).not.toContain("Next sweep: tomorrow morning");
  });

  it("does not mark failed proof attempts as completed proof", async () => {
    await mockRouter({
      loaderData: {
        savedQueries: [],
        collections: [],
        watchlists: [],
        digests: [],
        recentEvents: [],
        recentProofCaptures: [
          {
            status: "failed",
          },
        ],
        deliveryTargets: [],
        metaStatus: {
          status: "healthy",
          summary: "Healthy",
          lastCheckedAt: null,
        },
        proofUsage: {
          warningLevel: "ok",
          used: 1,
          limit: 10,
          remaining: 9,
          plan: "starter",
        },
        workspaceReadiness: emptyWorkspaceReadiness,
      },
    });

    const { default: AppDashboardRoute } = await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("Search ads");
    expect(markup).toContain("Competitor website");
    expect(markup).not.toContain("Screenshots and landing-page evidence are attached to the trail.");
  });

  it("keeps proved complete when older successful proof exists outside recent attempts", async () => {
    await mockRouter({
      loaderData: {
        savedQueries: [],
        collections: [],
        watchlists: [],
        digests: [],
        recentEvents: [],
        recentProofCaptures: [
          {
            status: "failed",
          },
        ],
        successfulProofStats: {
          count: 1,
          latestAt: "2026-04-18T16:00:05.000Z",
        },
        deliveryTargets: [],
        metaStatus: {
          status: "healthy",
          summary: "Healthy",
          lastCheckedAt: null,
        },
        proofUsage: {
          warningLevel: "ok",
          used: 9,
          limit: 10,
          remaining: 1,
          plan: "starter",
        },
        workspaceReadiness: emptyWorkspaceReadiness,
      },
    });

    const { default: AppDashboardRoute } = await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("Evidence captures");
    expect(markup).toContain("9");
    expect(markup).toContain("1 left this month");
  });

  it("describes evidence usage against the current billing period", async () => {
    await mockRouter({
      loaderData: {
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
          warningLevel: "warning",
          used: 220,
          limit: 250,
          remaining: 30,
          plan: "starter",
          upgradeTarget: "Agency",
        },
        workspaceReadiness: emptyWorkspaceReadiness,
      },
    });

    const { default: AppDashboardRoute } = await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("220 of 250 proof captures used in the current billing period.");
    expect(markup).not.toContain("evidence checks used in the last 30 days");
  });

  it("does not mark delivery complete just because email is configured", async () => {
    await mockRouter({
      loaderData: {
        savedQueries: [],
        collections: [],
        watchlists: [],
        digests: [],
        recentEvents: [],
        recentProofCaptures: [],
        deliveryTargets: [
          {
            channel: "email",
            isOptedIn: true,
            isPaused: false,
            optedOutAt: null,
          },
        ],
        metaStatus: {
          status: "healthy",
          summary: "Healthy",
          lastCheckedAt: null,
        },
        proofUsage: {
          warningLevel: "ok",
          used: 0,
          limit: 10,
          remaining: 10,
          plan: "starter",
        },
        workspaceReadiness: emptyWorkspaceReadiness,
      },
    });

    const { default: AppDashboardRoute } = await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("Search ads");
    expect(markup).not.toContain("Prove delivery");
    expect(markup).not.toContain("Delivery target is saved; send the first proof-backed brief to prove it reaches the team.");
    expect(markup).not.toContain("A successful delivery trail exists.");
    expect(markup).not.toContain("Retained value loop");
  });

  it("offers an upgrade path on collections plan-limit errors", async () => {
    await mockRouter({
      actionData: {
        ok: false,
        error: "plan_limit_exceeded",
        message: "You've reached your collection limit.",
      },
      loaderData: {
        collections: [],
        selectedCollection: null,
        items: [],
      },
    });

    const { default: CollectionsRoute } = await import("~/routes/app.collections");
    const markup = renderToStaticMarkup(createElement(CollectionsRoute));

    expect(markup).toContain("reached your collection limit.");
    expect(markup).toContain("View plans");
    expect(markup).toContain("/app/billing?source=collections#plans");
  });

  it("renders the external proof form inside collections", async () => {
    await mockRouter({
      loaderData: {
        collections: [
          {
            id: "collection-1",
            userId: "user-1",
            name: "Cross-channel proof",
            description: null,
            createdAt: "2026-06-06T00:00:00.000Z",
            updatedAt: "2026-06-06T00:00:00.000Z",
          },
        ],
        selectedCollection: {
          id: "collection-1",
          userId: "user-1",
          name: "Cross-channel proof",
          description: null,
          createdAt: "2026-06-06T00:00:00.000Z",
          updatedAt: "2026-06-06T00:00:00.000Z",
        },
        items: [],
      },
    });

    const { default: CollectionsRoute } = await import("~/routes/app.collections");
    const markup = renderToStaticMarkup(createElement(CollectionsRoute));

    expect(markup).toContain("File evidence from another source");
    expect(markup).toContain("add-external-proof");
    expect(markup).toContain("Google / YouTube");
    expect(markup).toContain("LinkedIn");
    expect(markup).toContain("Save evidence link");
  });

  it("keeps rendering legacy collection items without stored platforms", async () => {
    await mockRouter({
      loaderData: {
        collections: [
          {
            id: "collection-1",
            userId: "user-1",
            name: "Legacy proof",
            description: null,
            createdAt: "2026-06-06T00:00:00.000Z",
            updatedAt: "2026-06-06T00:00:00.000Z",
          },
        ],
        selectedCollection: {
          id: "collection-1",
          userId: "user-1",
          name: "Legacy proof",
          description: null,
          createdAt: "2026-06-06T00:00:00.000Z",
          updatedAt: "2026-06-06T00:00:00.000Z",
        },
        items: [
          {
            id: "item-1",
            collectionId: "collection-1",
            adId: "legacy-ad-1",
            note: null,
            createdAt: "2026-06-06T00:00:00.000Z",
            updatedAt: "2026-06-06T00:00:00.000Z",
            tags: [],
            ad: {
              metaAdId: "legacy-ad-1",
              advertiser: "Nykaa",
              hook: "Routine-first bundle",
              offer: "Bundle and save",
              format: "image",
              firstSeenAt: null,
              lastSeenAt: null,
              active: true,
              landingPageUrl: null,
              adSnapshotUrl: null,
            },
          },
        ],
      },
    });

    const { default: CollectionsRoute } = await import("~/routes/app.collections");
    const markup = renderToStaticMarkup(createElement(CollectionsRoute));

    expect(markup).toContain("Nykaa");
    // Legacy items fall back to the ad format; the status pill now renders it
    // sentence-cased ("Image") instead of relying on CSS capitalize.
    expect(markup).toContain("Image");
  });

  it("renders saved external proof links from the stored proof URL", async () => {
    await mockRouter({
      loaderData: {
        collections: [
          {
            id: "collection-1",
            userId: "user-1",
            name: "External proof",
            description: null,
            createdAt: "2026-06-06T00:00:00.000Z",
            updatedAt: "2026-06-06T00:00:00.000Z",
          },
        ],
        selectedCollection: {
          id: "collection-1",
          userId: "user-1",
          name: "External proof",
          description: null,
          createdAt: "2026-06-06T00:00:00.000Z",
          updatedAt: "2026-06-06T00:00:00.000Z",
        },
        items: [
          {
            id: "item-1",
            collectionId: "collection-1",
            adId: "external:linkedin:fnv1a-abc123",
            note: "Seen in launch review.",
            createdAt: "2026-06-06T00:00:00.000Z",
            updatedAt: "2026-06-06T00:00:00.000Z",
            tags: ["LinkedIn"],
            ad: {
              metaAdId: "external:linkedin:fnv1a-abc123",
              advertiser: "Mamaearth",
              hook: "Creator-led sunscreen routine",
              offer: "Combo launch",
              format: "unknown",
              source: "external",
              platforms: ["LinkedIn"],
              firstSeenAt: "2026-06-06T00:00:00.000Z",
              lastSeenAt: null,
              active: false,
              landingPageUrl: null,
              adSnapshotUrl: null,
              analysisFields: [
                {
                  scopeType: "ad",
                  fieldKey: "proof_url",
                  fieldValue: "https://www.linkedin.com/posts/mamaearth-campaign",
                  provenanceSource: "user",
                  extractorVersion: "manual-external-proof-v1",
                  confidence: 1,
                },
              ],
            },
          },
        ],
      },
    });

    const { default: CollectionsRoute } = await import("~/routes/app.collections");
    const markup = renderToStaticMarkup(createElement(CollectionsRoute));

    expect(markup).toContain("Open evidence");
    expect(markup).toContain("https://www.linkedin.com/posts/mamaearth-campaign");
  });

  it("does not render a pricing CTA on search plan-limit errors", async () => {
    vi.doMock("~/components/dashboard-shell", () => ({
      DashboardShell: ({ children }: { children: React.ReactNode }) => children,
    }));

    await mockRouter({
      actionData: {
        ok: false,
        error: "plan_limit_exceeded",
        message: "You've reached your workspace watchlist limit.",
      },
      loaderData: {
        mode: "advertiser",
        filters: {
          query: "boAt",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
        fingerprint: "fp-1",
        result: {
          ads: [],
          nextCursor: null,
          source: "meta",
        },
        selectedAd: null,
        collections: [],
        session: null,
      },
      rootData: {
        session: null,
      },
    });

    const { default: SearchRoute } = await import("~/routes/search");
    const markup = renderToStaticMarkup(createElement(SearchRoute));

    expect(markup).toContain("reached your workspace watchlist limit.");
    expect(markup).not.toContain("View pricing");
  });
});
