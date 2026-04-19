import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function createContext(env: Record<string, unknown> = {}) {
  return {
    cloudflare: {
      env,
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

describe("ops route", () => {
  it("allows an allowlisted operator to load the snapshot", async () => {
    const getOperatorSnapshot = vi.fn().mockResolvedValue({
      summary: {
        failingRuns: 1,
        stuckRuns: 0,
        failedProofs: 0,
        budgetBlockedProofs: 0,
        blockedTargets: 0,
        deliveryFailures: 0,
        degradedWatchlists: 1,
      },
      failingRuns: [],
      stuckRuns: [],
      failedProofs: [],
      budgetBlockedProofs: [],
      blockedTargets: [],
      deliveryFailures: [],
      degradedWatchlists: [],
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getOperatorSnapshot,
    }));

    const { loader } = await import("~/routes/app.ops");
    const result = await loader({
      context: createContext({
        OPS_ALLOWLIST_EMAILS: "owner@example.com, teammate@example.com",
      }),
      request: new Request("http://localhost/app/ops"),
    } as never);

    expect(result).toEqual({
      snapshot: expect.objectContaining({
        summary: expect.objectContaining({
          failingRuns: 1,
        }),
      }),
    });
    expect(getOperatorSnapshot).toHaveBeenCalledTimes(1);
  });

  it("denies authenticated users who are not on the allowlist", async () => {
    const getOperatorSnapshot = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue({
        ...session,
        user: {
          ...session.user,
          email: "other@example.com",
        },
      }),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getOperatorSnapshot,
    }));

    const { loader } = await import("~/routes/app.ops");

    await expect(
      loader({
        context: createContext({
          OPS_ALLOWLIST_EMAILS: "owner@example.com",
        }),
        request: new Request("http://localhost/app/ops"),
      } as never),
    ).rejects.toMatchObject({
      status: 403,
    });
    expect(getOperatorSnapshot).not.toHaveBeenCalled();
  });

  it("denies access when the allowlist is unset", async () => {
    const getOperatorSnapshot = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getOperatorSnapshot,
    }));

    const { loader } = await import("~/routes/app.ops");

    await expect(
      loader({
        context: createContext({}),
        request: new Request("http://localhost/app/ops"),
      } as never),
    ).rejects.toMatchObject({
      status: 403,
    });
    expect(getOperatorSnapshot).not.toHaveBeenCalled();
  });

  it("does not fetch operator data when access is denied", async () => {
    const getOperatorSnapshot = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getOperatorSnapshot,
    }));

    const { loader } = await import("~/routes/app.ops");

    await expect(
      loader({
        context: createContext({
          OPS_ALLOWLIST_EMAILS: "someone-else@example.com",
        }),
        request: new Request("http://localhost/app/ops"),
      } as never),
    ).rejects.toMatchObject({
      status: 403,
    });
    expect(getOperatorSnapshot).not.toHaveBeenCalled();
  });
});
