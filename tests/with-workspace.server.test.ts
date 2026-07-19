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

const workspaceSession = {
  session,
  workspaceUserId: "user-1",
  isMember: false,
  ownerName: null,
};

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("withWorkspace", () => {
  it("returns workspace session and plan when no limit is required", async () => {
    const requireWorkspaceSession = vi.fn().mockResolvedValue(workspaceSession);
    const getUserPlan = vi.fn().mockResolvedValue("starter");
    const checkPlanLimit = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({ requireWorkspaceSession }));
    vi.doMock("~/lib/plan.server", () => ({ getUserPlan, checkPlanLimit }));

    const { withWorkspace } = await import("~/lib/with-workspace.server");
    const result = await withWorkspace(new Request("http://localhost/app"), {} as never);

    expect(result).toMatchObject({
      ok: true,
      workspaceUserId: "user-1",
      plan: "starter",
      planLimit: null,
      isMember: false,
    });
    expect(checkPlanLimit).not.toHaveBeenCalled();
  });

  it("returns a canonical action result and 402 response when the plan limit is exceeded", async () => {
    const requireWorkspaceSession = vi.fn().mockResolvedValue(workspaceSession);
    const getUserPlan = vi.fn().mockResolvedValue("free");
    const checkPlanLimit = vi.fn().mockResolvedValue({
      allowed: false,
      limit: 1,
      current: 1,
    });

    vi.doMock("~/lib/auth.server", () => ({ requireWorkspaceSession }));
    vi.doMock("~/lib/plan.server", () => ({ getUserPlan, checkPlanLimit }));

    const { withWorkspace } = await import("~/lib/with-workspace.server");
    const result = await withWorkspace(new Request("http://localhost/app"), {} as never, {
      requirePlan: "watchlists",
      upgradePath: "/app/billing#plans",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected denial");

    expect(result.result).toEqual({
      ok: false,
      error: "plan_limit_exceeded",
      limit: 1,
      current: 1,
      message: "You've reached your competitor tracking limit.",
      upgradePath: "/app/billing#plans",
    });
    expect(result.response.status).toBe(402);
    await expect(result.response.json()).resolves.toMatchObject({
      error: "plan_limit_exceeded",
      limit: 1,
      current: 1,
      plan: "free",
      upgradePath: "/app/billing#plans",
    });
  });

  it("honors a custom limit message function", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue(workspaceSession),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("free"),
      checkPlanLimit: vi.fn().mockResolvedValue({
        allowed: false,
        limit: 1,
        current: 1,
      }),
    }));

    const { withWorkspace } = await import("~/lib/with-workspace.server");
    const result = await withWorkspace(new Request("http://localhost/search"), {} as never, {
      requirePlan: "watchlists",
      limitMessage: ({ limit }) =>
        limit <= 1
          ? "Free includes 1 watchlist. Upgrade to track more competitors with scheduled scans and digests."
          : "You've reached your competitor tracking limit.",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected denial");
    expect(result.result.message).toBe(
      "Free includes 1 watchlist. Upgrade to track more competitors with scheduled scans and digests.",
    );
  });

  it("returns planLimit when requirePlan passes", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue(workspaceSession),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("scout"),
      checkPlanLimit: vi.fn().mockResolvedValue({
        allowed: true,
        limit: 3,
        current: 1,
      }),
    }));

    const { withWorkspace } = await import("~/lib/with-workspace.server");
    const result = await withWorkspace(new Request("http://localhost/app"), {} as never, {
      requirePlan: "collections",
    });

    expect(result).toMatchObject({
      ok: true,
      plan: "scout",
      planLimit: { allowed: true, limit: 3, current: 1 },
    });
  });
});

describe("requireWorkspacePlanLimit", () => {
  it("returns the canonical collection limit result when denied", async () => {
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("free"),
      checkPlanLimit: vi.fn().mockResolvedValue({
        allowed: false,
        limit: 3,
        current: 3,
      }),
    }));

    const { requireWorkspacePlanLimit } = await import("~/lib/with-workspace.server");
    const result = await requireWorkspacePlanLimit({} as never, "user-1", "collections");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected denial");
    expect(result.result).toEqual({
      ok: false,
      error: "plan_limit_exceeded",
      limit: 3,
      current: 3,
      message: "You've reached your collection limit.",
    });
  });
});

describe("planLimitExceededActionResult", () => {
  it("omits upgradePath when not provided", async () => {
    const { planLimitExceededActionResult } = await import("~/lib/with-workspace.server");
    expect(
      planLimitExceededActionResult({
        limit: 3,
        current: 3,
        message: "You've reached your competitor tracking limit.",
      }),
    ).toEqual({
      ok: false,
      error: "plan_limit_exceeded",
      limit: 3,
      current: 3,
      message: "You've reached your competitor tracking limit.",
    });
  });
});
