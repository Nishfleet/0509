import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  it("returns a structured upgrade prompt when the watchlist plan limit is reached", async () => {
    const createWatchlist = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      PLAN_UPGRADE_URL: "/#pricing",
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
      message: "You have reached the free watchlist limit.",
      ok: false,
      upgradeUrl: "/#pricing",
    });
    expect(createWatchlist).not.toHaveBeenCalled();
  });
});

describe("collection limit", () => {
  it("returns a structured upgrade prompt when the collection plan limit is reached", async () => {
    const createCollection = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      PLAN_UPGRADE_URL: "/#pricing",
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
      message: "You have reached the free collection limit.",
      ok: false,
      upgradeUrl: "/#pricing",
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
      PLAN_UPGRADE_URL: "/#pricing",
      getUserPlan: vi.fn().mockResolvedValue("free"),
      PLAN_LIMITS: {
        free: { digests: false },
        starter: { digests: true },
        agency: { digests: true },
      },
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDigest: vi.fn(),
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
      upgradeUrl: "/#pricing",
    });
    expect(listDigests).not.toHaveBeenCalled();
  });
});
