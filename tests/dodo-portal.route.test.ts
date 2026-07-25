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

const enforceBillingProviderRateLimit = vi.fn();

beforeEach(() => {
  vi.resetModules();
  enforceBillingProviderRateLimit.mockReset().mockResolvedValue(null);
  vi.doMock("~/lib/rate-limit.server", () => ({
    enforceBillingProviderRateLimit,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/auth.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/dodo-billing.server");
  vi.doUnmock("~/lib/rate-limit.server");
});

describe("Dodo customer portal route", () => {
  it("303s into a fresh portal session for a linked customer", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({})),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getUserPlanBillingInfo: vi.fn().mockResolvedValue({
        plan: "starter",
        dodoCustomerId: "cus_123",
      }),
    }));
    const createDodoCustomerPortalSession = vi
      .fn()
      .mockResolvedValue("https://customer.dodopayments.com/session");
    vi.doMock("~/lib/dodo-billing.server", () => ({ createDodoCustomerPortalSession }));

    const { action } = await import("~/routes/api.billing.dodo.portal");

    try {
      await action({
        context: {},
        request: new Request("https://0509.io/api/billing/dodo/portal", { method: "POST" }),
        params: {},
      } as never);
      throw new Error("expected redirect");
    } catch (response) {
      expect((response as Response).status).toBe(303);
      expect((response as Response).headers.get("Location")).toBe(
        "https://customer.dodopayments.com/session",
      );
    }
    expect(createDodoCustomerPortalSession).toHaveBeenCalledWith(
      expect.anything(),
      "cus_123",
      expect.objectContaining({ request: expect.any(Request) }),
    );
  });

  it("falls back to the billing page when no Dodo customer is linked", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({})),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getUserPlanBillingInfo: vi.fn().mockResolvedValue({
        plan: "starter",
        dodoCustomerId: null,
      }),
    }));
    vi.doMock("~/lib/dodo-billing.server", () => ({
      createDodoCustomerPortalSession: vi.fn(),
    }));

    const { action } = await import("~/routes/api.billing.dodo.portal");

    try {
      await action({
        context: {},
        request: new Request("https://0509.io/api/billing/dodo/portal", { method: "POST" }),
        params: {},
      } as never);
      throw new Error("expected redirect");
    } catch (response) {
      expect((response as Response).headers.get("Location")).toBe(
        "/app/billing?portal=unavailable",
      );
    }
  });

  it("blocks workspace members before reading or opening any billing portal", async () => {
    const memberSession = {
      ...session,
      user: {
        ...session.user,
        email: "teammate@example.com",
        id: "member-1",
        name: "Teammate",
      },
      session: {
        ...session.session,
        id: "member-session-1",
        userId: "member-1",
      },
    };
    const getUserPlanBillingInfo = vi.fn().mockImplementation(async (_env, userId: string) => {
      if (userId === "owner-1") {
        return { plan: "starter", dodoCustomerId: "cus_owner" };
      }
      return { plan: "starter", dodoCustomerId: "cus_member_personal" };
    });
    const createDodoCustomerPortalSession = vi.fn();
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(memberSession),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session: memberSession,
        workspaceUserId: "owner-1",
        isMember: true,
        ownerName: "Owner",
      })),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({})),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getUserPlanBillingInfo,
    }));
    vi.doMock("~/lib/dodo-billing.server", () => ({ createDodoCustomerPortalSession }));

    const { action } = await import("~/routes/api.billing.dodo.portal");

    const response = (await action({
      context: {},
      request: new Request("https://0509.io/api/billing/dodo/portal", { method: "POST" }),
      params: {},
    } as never).catch((error) => error)) as Response;

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe("Only the workspace owner can manage billing.");
    expect(getUserPlanBillingInfo).not.toHaveBeenCalled();
    expect(getUserPlanBillingInfo).not.toHaveBeenCalledWith(expect.anything(), "owner-1");
    expect(createDodoCustomerPortalSession).not.toHaveBeenCalled();
  });

  it("falls back to the billing page when a linked Dodo customer cannot open a portal session", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({})),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getUserPlanBillingInfo: vi.fn().mockResolvedValue({
        plan: "starter",
        dodoCustomerId: "cus_123",
      }),
    }));
    const createDodoCustomerPortalSession = vi.fn().mockResolvedValue(null);
    vi.doMock("~/lib/dodo-billing.server", () => ({ createDodoCustomerPortalSession }));

    const { action } = await import("~/routes/api.billing.dodo.portal");

    try {
      await action({
        context: {},
        request: new Request("https://0509.io/api/billing/dodo/portal", { method: "POST" }),
        params: {},
      } as never);
      throw new Error("expected redirect");
    } catch (response) {
      expect((response as Response).status).toBe(303);
      expect((response as Response).headers.get("Location")).toBe(
        "/app/billing?portal=unavailable",
      );
    }
    expect(createDodoCustomerPortalSession).toHaveBeenCalledTimes(1);
  });

  it("does not open a provider portal when the mutation budget is exhausted", async () => {
    const createDodoCustomerPortalSession = vi.fn();
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      }),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
    vi.doMock("~/lib/data.server", () => ({
      getUserPlanBillingInfo: vi.fn().mockResolvedValue({ plan: "starter", dodoCustomerId: "cus_123" }),
    }));
    vi.doMock("~/lib/dodo-billing.server", () => ({ createDodoCustomerPortalSession }));
    enforceBillingProviderRateLimit.mockResolvedValue(
      new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 }),
    );
    const { action } = await import("~/routes/api.billing.dodo.portal");
    const response = (await action({
      context: {},
      request: new Request("https://0509.io/api/billing/dodo/portal", { method: "POST" }),
      params: {},
    } as never).catch((error) => error)) as Response;
    expect(response.status).toBe(429);
    expect(createDodoCustomerPortalSession).not.toHaveBeenCalled();
  });
});
