import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createContext() {
  return {
    cloudflare: {
      env: {},
    },
  };
}

async function expectRedirect(
  callback: () => Promise<unknown>,
  location: string,
) {
  try {
    await callback();
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    expect((error as Response).status).toBe(302);
    expect((error as Response).headers.get("Location")).toBe(location);
    return;
  }

  throw new Error(`Expected redirect to ${location}`);
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("auth signup loader", () => {
  it("defaults new signups to the onboarding flow", async () => {
    const { loader } = await import("~/routes/auth.signup");

    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/auth/signup"),
    } as never);

    expect(result).toEqual({
      redirectTo: "/app/onboard",
    });
  });
});

describe("onboarding route", () => {
  it("redirects unauthenticated users to login", async () => {
    const { loader } = await import("~/routes/app.onboard");

    await expectRedirect(
      () =>
        loader({
          context: createContext(),
          request: new Request("http://localhost/app/onboard"),
        } as never),
      "/auth/login?redirectTo=%2Fapp%2Fonboard",
    );
  });

  it("redirects completed users away from onboarding", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue({
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
      }),
    }));

    const { loader } = await import("~/routes/app.onboard");

    await expectRedirect(
      () =>
        loader({
          context: createContext(),
          request: new Request("http://localhost/app/onboard"),
        } as never),
      "/app",
    );
  });

  it("redirects unfinished users from the workspace to onboarding", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue({
        user: {
          id: "user-1",
          email: "owner@example.com",
          name: "Owner",
          onboardedAt: null,
        },
        session: {
          id: "session-1",
          userId: "user-1",
          expiresAt: "2026-04-03T00:00:00.000Z",
        },
      }),
    }));

    const { loader } = await import("~/routes/app-layout");

    await expectRedirect(
      () =>
        loader({
          context: createContext(),
          request: new Request("http://localhost/app/watchlists"),
        } as never),
      "/app/onboard",
    );
  });

  it("creates a first watchlist and marks the user onboarded", async () => {
    const completeUserOnboarding = vi.fn().mockResolvedValue(undefined);
    const createWatchlist = vi.fn().mockResolvedValue({
      id: "watch-1",
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue({
        user: {
          id: "user-1",
          email: "owner@example.com",
          name: "Owner",
          onboardedAt: null,
        },
        session: {
          id: "session-1",
          userId: "user-1",
          expiresAt: "2026-04-03T00:00:00.000Z",
        },
      }),
    }));
    vi.doMock("~/lib/data.server", () => ({
      completeUserOnboarding,
      createSavedQuery: vi.fn(),
      createWatchlist,
    }));

    const { action } = await import("~/routes/app.onboard");
    const formData = new FormData();
    formData.set("intent", "create-watchlist");
    formData.set("query", "boAt");

    await expectRedirect(
      () =>
        action({
          context: createContext(),
          request: new Request("http://localhost/app/onboard", {
            method: "POST",
            body: formData,
          }),
        } as never),
      "/app/watchlists?watchlist=watch-1",
    );

    expect(createWatchlist).toHaveBeenCalledWith(
      {},
      "user-1",
      expect.objectContaining({
        name: "boAt watch",
        targetType: "advertiser",
        targetId: "boAt",
        targetLabel: "boAt",
      }),
    );
    expect(completeUserOnboarding).toHaveBeenCalledWith({}, "user-1");
  });

  it("marks the user onboarded when they skip setup", async () => {
    const completeUserOnboarding = vi.fn().mockResolvedValue(undefined);

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue({
        user: {
          id: "user-1",
          email: "owner@example.com",
          name: "Owner",
          onboardedAt: null,
        },
        session: {
          id: "session-1",
          userId: "user-1",
          expiresAt: "2026-04-03T00:00:00.000Z",
        },
      }),
    }));
    vi.doMock("~/lib/data.server", () => ({
      completeUserOnboarding,
      createSavedQuery: vi.fn(),
      createWatchlist: vi.fn(),
    }));

    const { action } = await import("~/routes/app.onboard");
    const formData = new FormData();
    formData.set("intent", "finish");

    await expectRedirect(
      () =>
        action({
          context: createContext(),
          request: new Request("http://localhost/app/onboard", {
            method: "POST",
            body: formData,
          }),
        } as never),
      "/app",
    );

    expect(completeUserOnboarding).toHaveBeenCalledWith({}, "user-1");
  });
});
