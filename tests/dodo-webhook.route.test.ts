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
});
