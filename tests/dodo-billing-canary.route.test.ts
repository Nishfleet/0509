import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createContext(env = {}) {
  return {
    cloudflare: {
      env,
    },
  };
}

function createCanaryDb() {
  return {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          return {
            async run() {
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

              if (sql.includes("FROM user_plan") && sql.includes("dodo_payment_id")) {
                return {
                  results: [
                    {
                      plan: "starter",
                      dodo_payment_id: bindings[1],
                    },
                  ] as T[],
                };
              }

              if (sql.includes("FROM proof_usage_credit")) {
                return {
                  results: [
                    {
                      credits: 500,
                      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
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
        request: new Request("https://0509.in/api/billing/dodo/canary", {
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
      request: new Request("https://0509.in/api/billing/dodo/canary", {
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
      expect(request.url).toBe("https://0509.in/api/webhooks/dodo");
      expect(request.method).toBe("POST");
      expect(request.headers.get("webhook-signature")).toContain("v1=");
      const body = JSON.parse(await request.text());
      webhookPayloads.push(body);
      expect(body.metadata.user_id).toBe("user-1");

      return Response.json({ ok: true });
    });
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => createEnv()),
    }));
    vi.doMock("~/routes/api.webhooks.dodo", () => ({
      action: webhookAction,
    }));

    const { action } = await import("~/routes/api.billing.dodo.canary");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.in/api/billing/dodo/canary", {
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
        proofCreditsGranted: true,
        proofCreditCleanupOk: true,
        credits: 500,
      },
    });
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
