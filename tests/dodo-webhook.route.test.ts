import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/dodo-billing.server");
});

describe("Dodo webhook route", () => {
  it("passes the immutable payment grant timestamp instead of the delivery timestamp", async () => {
    const grantDodoPlanAccess = vi.fn();
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ DODO_0509_WEBHOOK_SECRET: "secret" })),
    }));
    vi.doMock("~/lib/dodo-billing.server", () => ({
      verifyDodoWebhookRequest: vi.fn(),
      extractDodoProofCreditGrant: vi.fn(() => null),
      extractDodoPlanRevocation: vi.fn(() => null),
      extractDodoPlanGrant: vi.fn(() => ({
        userId: "user-1",
        plan: "starter",
        paymentId: "pay-delayed-success",
        productId: "prod_starter_monthly",
        status: "succeeded",
        grantedAt: "2026-06-04T12:00:00.000Z",
        metadata: {
          created_at: "2026-06-04T12:00:00.000Z",
        },
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      grantDodoPlanAccess,
      grantProofUsageCredit: vi.fn(),
      getUserIdByEmail: vi.fn(),
      revokeDodoPlanAccess: vi.fn(),
    }));

    const { action } = await import("~/routes/api.webhooks.dodo");

    await action({
      context: {},
      request: new Request("https://0509.in/api/webhooks/dodo", {
        method: "POST",
        headers: {
          "webhook-id": "evt-delayed-success",
          "webhook-timestamp": "2026-06-05T08:00:00.000Z",
          "webhook-signature": "v1=signed",
        },
        body: JSON.stringify({ type: "payment.succeeded" }),
      }),
      params: {},
    } as never);

    expect(grantDodoPlanAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        providerPaymentId: "pay-delayed-success",
        grantedAt: "2026-06-04T12:00:00.000Z",
      }),
    );
  });

  it("revokes plan access when a subscription lifecycle event arrives", async () => {
    const revokeDodoPlanAccess = vi.fn();
    const getUserIdByEmail = vi.fn();
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ DODO_0509_WEBHOOK_SECRET: "secret" })),
    }));
    vi.doMock("~/lib/dodo-billing.server", () => ({
      verifyDodoWebhookRequest: vi.fn(),
      extractDodoProofCreditGrant: vi.fn(() => null),
      extractDodoPlanGrant: vi.fn(() => null),
      extractDodoPlanRevocation: vi.fn(() => ({
        eventType: "subscription.cancelled",
        userId: "user-1",
        customerEmail: "owner@example.com",
        subscriptionId: "sub_123",
        status: "cancelled",
        revokedAt: "2026-07-01T00:00:00.000Z",
        metadata: {},
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      grantDodoPlanAccess: vi.fn(),
      grantProofUsageCredit: vi.fn(),
      getUserIdByEmail,
      revokeDodoPlanAccess,
    }));

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: new Request("https://0509.in/api/webhooks/dodo", {
        method: "POST",
        headers: {
          "webhook-id": "evt-cancel",
          "webhook-timestamp": "2026-07-01T00:00:01.000Z",
          "webhook-signature": "v1=signed",
        },
        body: JSON.stringify({ type: "subscription.cancelled" }),
      }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, revoked: true });
    expect(revokeDodoPlanAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        providerSubscriptionId: "sub_123",
        status: "subscription.cancelled",
        revokedAt: "2026-07-01T00:00:00.000Z",
      }),
    );
    expect(getUserIdByEmail).not.toHaveBeenCalled();
  });

  it("resolves the user by customer email when subscription metadata lacks a user id", async () => {
    const revokeDodoPlanAccess = vi.fn();
    const getUserIdByEmail = vi.fn().mockResolvedValue("user-email-match");
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ DODO_0509_WEBHOOK_SECRET: "secret" })),
    }));
    vi.doMock("~/lib/dodo-billing.server", () => ({
      verifyDodoWebhookRequest: vi.fn(),
      extractDodoProofCreditGrant: vi.fn(() => null),
      extractDodoPlanGrant: vi.fn(() => null),
      extractDodoPlanRevocation: vi.fn(() => ({
        eventType: "subscription.expired",
        userId: null,
        customerEmail: "owner@example.com",
        subscriptionId: "sub_456",
        status: "expired",
        revokedAt: "2026-07-02T00:00:00.000Z",
        metadata: {},
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      grantDodoPlanAccess: vi.fn(),
      grantProofUsageCredit: vi.fn(),
      getUserIdByEmail,
      revokeDodoPlanAccess,
    }));

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: new Request("https://0509.in/api/webhooks/dodo", {
        method: "POST",
        headers: {
          "webhook-id": "evt-expire",
          "webhook-timestamp": "2026-07-02T00:00:01.000Z",
          "webhook-signature": "v1=signed",
        },
        body: JSON.stringify({ type: "subscription.expired" }),
      }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, revoked: true });
    expect(getUserIdByEmail).toHaveBeenCalledWith(expect.anything(), "owner@example.com");
    expect(revokeDodoPlanAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: "user-email-match" }),
    );
  });

  it("acknowledges but does not revoke when no user can be matched", async () => {
    const revokeDodoPlanAccess = vi.fn();
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ DODO_0509_WEBHOOK_SECRET: "secret" })),
    }));
    vi.doMock("~/lib/dodo-billing.server", () => ({
      verifyDodoWebhookRequest: vi.fn(),
      extractDodoProofCreditGrant: vi.fn(() => null),
      extractDodoPlanGrant: vi.fn(() => null),
      extractDodoPlanRevocation: vi.fn(() => ({
        eventType: "subscription.cancelled",
        userId: null,
        customerEmail: "stranger@example.com",
        subscriptionId: "sub_789",
        status: "cancelled",
        revokedAt: "2026-07-03T00:00:00.000Z",
        metadata: {},
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      grantDodoPlanAccess: vi.fn(),
      grantProofUsageCredit: vi.fn(),
      getUserIdByEmail: vi.fn().mockResolvedValue(null),
      revokeDodoPlanAccess,
    }));

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: {},
      request: new Request("https://0509.in/api/webhooks/dodo", {
        method: "POST",
        headers: {
          "webhook-id": "evt-orphan",
          "webhook-timestamp": "2026-07-03T00:00:01.000Z",
          "webhook-signature": "v1=signed",
        },
        body: JSON.stringify({ type: "subscription.cancelled" }),
      }),
      params: {},
    } as never);

    expect(await response.json()).toMatchObject({ ok: true, ignored: true });
    expect(revokeDodoPlanAccess).not.toHaveBeenCalled();
  });
});
