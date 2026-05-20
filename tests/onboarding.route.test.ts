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
  vi.doUnmock("~/lib/auth.server");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("~/lib/auth.server");
  vi.resetModules();
});

describe("auth signup loader", () => {
  it("defaults new signups to the onboarding flow", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));

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
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockImplementation(() => {
        throw new Response(null, {
          headers: {
            Location: "/auth/login?redirectTo=%2Fapp%2Fonboard",
          },
          status: 302,
        });
      }),
    }));

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
    vi.doMock("~/lib/plan.server", () => ({
      checkPlanLimit: vi.fn().mockResolvedValue({
        allowed: true,
        current: 0,
        limit: 3,
      }),
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

  it("returns a structured limit prompt without a pricing link when onboarding watchlists are capped", async () => {
    const completeUserOnboarding = vi.fn();
    const createWatchlist = vi.fn();

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
      createWatchlist,
    }));
    vi.doMock("~/lib/plan.server", () => ({
      checkPlanLimit: vi.fn().mockResolvedValue({
        allowed: false,
        current: 3,
        limit: 3,
      }),
    }));

    const { action } = await import("~/routes/app.onboard");
    const formData = new FormData();
    formData.set("intent", "create-watchlist");
    formData.set("query", "boAt");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/onboard", {
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
    expect(completeUserOnboarding).not.toHaveBeenCalled();
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

  it("does not render a pricing CTA on onboarding plan-limit errors", async () => {
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");

      return {
        ...actual,
        Form: ({ children, ...props }: MockFormProps) =>
          React.createElement("form", props, children),
        Link: ({ children, to, ...props }: MockLinkProps) =>
          React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
        useActionData: vi.fn().mockReturnValue({
          ok: false,
          error: "plan_limit_exceeded",
          message: "You have reached your workspace watchlist limit.",
        }),
      };
    });

    const { default: AppOnboardRoute } = await import("~/routes/app.onboard");
    const markup = renderToStaticMarkup(createElement(AppOnboardRoute));

    expect(markup).toContain("You have reached your workspace watchlist limit.");
    expect(markup).not.toContain("View pricing");
  });
});
