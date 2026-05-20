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
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
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

describe("search watchlist limit", () => {
  it("returns a structured limit prompt when the watchlist plan limit is reached", async () => {
    const createWatchlist = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      checkPlanLimit: vi.fn().mockResolvedValue({
        allowed: false,
        current: 3,
        limit: 3,
      }),
    }));
    vi.doMock("~/lib/data.server", () => ({
      createSavedQuery: vi.fn(),
      createWatchlist,
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
      message: "You have reached your workspace watchlist limit.",
      ok: false,
    });
    expect(createWatchlist).not.toHaveBeenCalled();
  });
});

describe("collection limit", () => {
  it("returns a structured limit prompt when the collection plan limit is reached", async () => {
    const createCollection = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
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
      createCollection,
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
      limit: 3,
      message: "You have reached your workspace collection limit.",
      ok: false,
    });
    expect(createCollection).not.toHaveBeenCalled();
  });
});

describe("digest access", () => {
  it("returns locked digest access for free users", async () => {
    const listDigests = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("free"),
      PLAN_LIMITS: {
        free: { digests: false },
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
});

describe("dashboard watchlist limit", () => {
  it("returns a structured limit prompt when the dashboard watchlist limit is reached", async () => {
    const createWatchlist = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      checkPlanLimit: vi.fn().mockResolvedValue({
        allowed: false,
        current: 3,
        limit: 3,
      }),
    }));
    vi.doMock("~/lib/data.server", () => ({
      createWatchlist,
      getSavedQuery: vi.fn().mockResolvedValue({
        id: "saved-query-1",
        name: "boAt",
        fingerprint: "fp-1",
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
      limit: 3,
      message: "You have reached your workspace watchlist limit.",
      ok: false,
    });
    expect(createWatchlist).not.toHaveBeenCalled();
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
        useRouteLoaderData: vi.fn().mockReturnValue(overrides.rootData),
        useSearchParams: vi.fn().mockReturnValue([new URLSearchParams(), vi.fn()]),
      };
    });
  }

  it("does not render a pricing CTA on the digests route", async () => {
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

    expect(markup).not.toContain("View pricing");
    expect(markup).toContain("Proof-backed digests are not available in the current workspace.");
  });

  it("does not render a pricing CTA on dashboard plan-limit errors", async () => {
    await mockRouter({
      actionData: {
        ok: false,
        error: "plan_limit_exceeded",
        message: "You have reached your workspace watchlist limit.",
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
      },
    });

    const { default: AppDashboardRoute } = await import("~/routes/app.dashboard");
    const markup = renderToStaticMarkup(createElement(AppDashboardRoute));

    expect(markup).toContain("You have reached your workspace watchlist limit.");
    expect(markup).not.toContain("View pricing");
  });

  it("does not render a pricing CTA on collections plan-limit errors", async () => {
    await mockRouter({
      actionData: {
        ok: false,
        error: "plan_limit_exceeded",
        message: "You have reached your workspace collection limit.",
      },
      loaderData: {
        collections: [],
        selectedCollection: null,
        items: [],
      },
    });

    const { default: CollectionsRoute } = await import("~/routes/app.collections");
    const markup = renderToStaticMarkup(createElement(CollectionsRoute));

    expect(markup).toContain("You have reached your workspace collection limit.");
    expect(markup).not.toContain("View pricing");
  });

  it("does not render a pricing CTA on search plan-limit errors", async () => {
    await mockRouter({
      actionData: {
        ok: false,
        error: "plan_limit_exceeded",
        message: "You have reached your workspace watchlist limit.",
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

    expect(markup).toContain("You have reached your workspace watchlist limit.");
    expect(markup).not.toContain("View pricing");
  });
});
