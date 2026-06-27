import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createContext(env = {}) {
  return {
    cloudflare: {
      env,
    },
  };
}

function createCanaryDb() {
  const cleanedPlanPaymentIds = new Set<string>();
  const cleanedCreditPaymentIds = new Set<string>();
  const restoredWatchlistIds = new Set<string>();

  return {
    cleanedPlanPaymentIds,
    cleanedCreditPaymentIds,
    restoredWatchlistIds,
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          return {
            async run() {
              if (sql.includes("UPDATE user_plan") && sql.includes("dodo_payment_id = ?")) {
                cleanedPlanPaymentIds.add(String(bindings.at(-1)));
              }
              if (sql.includes("DELETE FROM evidence_top_up_grant")) {
                cleanedCreditPaymentIds.add(String(bindings[1]));
              }
              if (sql.includes("UPDATE watchlist") && sql.includes("paused_reason = ?")) {
                restoredWatchlistIds.add(String(bindings[4]));
              }
              return { success: true };
            },
            async all<T>() {
              if (sql.includes("FROM user") && sql.includes("LEFT JOIN user_plan")) {
                return {
                  results: [
                    {
                      id: "user-1",
                      email: "owner@example.com",
                      name: "Owner",
                      plan: "starter",
                    },
                  ] as T[],
                };
              }

              if (sql.includes("FROM watchlist")) {
                return {
                  results: [
                    {
                      id: "watchlist-1",
                      is_active: 0,
                      paused_reason: "plan_limit",
                      updated_at: "2026-06-01T00:00:00.000Z",
                    },
                  ] as T[],
                };
              }

              if (sql.includes("FROM user_plan") && sql.includes("LIMIT 1")) {
                if (sql.includes("AND dodo_payment_id = ?")) {
                  if (cleanedPlanPaymentIds.has(String(bindings[1]))) {
                    return { results: [] as T[] };
                  }

                  return {
                    results: [
                      {
                        plan: "starter",
                        dodo_payment_id: bindings[1],
                      },
                    ] as T[],
                  };
                }

                return {
                  results: [
                    {
                      user_id: "user-1",
                      plan: "starter",
                      plan_updated_at: "2026-06-01T00:00:00.000Z",
                      dodo_payment_id: "real-payment-1",
                      dodo_product_id: "real-product-1",
                      dodo_status: "payment.succeeded",
                      dodo_subscription_id: "real-subscription-1",
                      dodo_customer_id: "real-customer-1",
                      dodo_next_billing_at: "2026-07-01T00:00:00.000Z",
                    },
                  ] as T[],
                };
              }

              if (sql.includes("FROM evidence_top_up_grant")) {
                if (cleanedCreditPaymentIds.has(String(bindings[1]))) {
                  return { results: [] as T[] };
                }

                return {
                  results: [
                    {
                      quantity_granted: 500,
                      status: "active",
                      granted_at: new Date().toISOString(),
                      provider_payment_id: bindings[1],
                    },
                  ] as T[],
                };
              }

              return { results: [] as T[] };
            },
          };
        },
      };
    },
  };
}

function createEnv() {
  return {
    CANARY_BYPASS_TOKEN: "secret-token",
    DB: createCanaryDb(),
    DODO_0509_BRAND_ID: "brand_0509",
    DODO_0509_PRODUCT_PROOF_PACK_500_ID: "prod_pack_500",
    DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
    DODO_0509_PRODUCT_STARTER_MONTHLY_ID: "prod_starter_monthly",
    DODO_0509_WEBHOOK_SECRET: "webhook-secret",
    LAUNCH_CANARY_EMAIL: "owner@example.com",
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/routes/api.webhooks.dodo");
});

describe("Dodo billing canary route", () => {
  it("hides the endpoint without the canary token", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => createEnv()),
    }));

    const { action } = await import("~/routes/api.billing.dodo.canary");

    await expect(
      action({
        context: createContext(),
        request: new Request("https://0509.io/api/billing/dodo/canary", {
          method: "POST",
        }),
      } as never),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it("rejects non-test email overrides", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => createEnv()),
    }));

    const { action } = await import("~/routes/api.billing.dodo.canary");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.io/api/billing/dodo/canary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-0509-canary-token": "secret-token",
        },
        body: JSON.stringify({
          email: "customer@realcompany.com",
        }),
      }),
    } as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      blocker: "invalid_canary_email_override",
    });
  });

  it("posts signed plan and proof-credit events through the real webhook route", async () => {
    const webhookPayloads: Array<{
      created_at?: string;
      payment_id: string;
      metadata: { user_id: string };
    }> = [];
    const webhookAction = vi.fn(async ({ request }: { request: Request }) => {
      expect(request.url).toBe("https://0509.io/api/webhooks/dodo");
      expect(request.method).toBe("POST");
      expect(request.headers.get("webhook-signature")).toContain("v1=");
      const body = JSON.parse(await request.text());
      webhookPayloads.push(body);
      expect(body.metadata.user_id).toBe("user-1");

      return Response.json({ ok: true });
    });
    const env = createEnv();
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/routes/api.webhooks.dodo", () => ({
      action: webhookAction,
    }));

    const { action } = await import("~/routes/api.billing.dodo.canary");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.io/api/billing/dodo/canary", {
        method: "POST",
        headers: {
          "x-0509-canary-token": "secret-token",
        },
      }),
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      user: {
        email: "owner@example.com",
        plan: "starter",
      },
      grants: {
        paidPlanUnlocked: true,
        planCleanupOk: true,
        watchlistCleanupOk: true,
        proofCreditsGranted: true,
        proofCreditCleanupOk: true,
        credits: 500,
      },
    });
    expect(env.DB.cleanedCreditPaymentIds.size).toBe(1);
    expect(env.DB.restoredWatchlistIds.has("watchlist-1")).toBe(true);
    expect(webhookAction).toHaveBeenCalledTimes(2);
    const paymentIds = webhookPayloads.map((payload) => payload.payment_id).sort();
    expect(paymentIds).toHaveLength(2);
    expect(paymentIds[0]).toMatch(
      /^billing-canary-user-1-starter-monthly-proof-500-\d{4}-\d{2}-\d{2}t.*-plan$/,
    );
    expect(paymentIds[1]).toMatch(
      /^billing-canary-user-1-starter-monthly-proof-500-\d{4}-\d{2}-\d{2}t.*-proof-500$/,
    );
  });
});
