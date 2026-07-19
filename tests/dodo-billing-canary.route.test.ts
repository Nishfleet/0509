import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CanaryWatchlistRow = {
  id: string;
  is_active: number;
  paused_reason: string | null;
  updated_at: string;
};

type CanaryUserPlan = {
  user_id: string;
  plan: string | null;
  plan_updated_at: string;
  dodo_payment_id: string | null;
  dodo_product_id: string | null;
  dodo_plan_change_product_id: string | null;
  dodo_status: string | null;
  dodo_subscription_id: string | null;
  dodo_customer_id: string | null;
  dodo_next_billing_at: string | null;
  evidence_entitlement_anchor: string | null;
  evidence_entitlement_anchor_source: string | null;
};

type WebhookAction = (args: { request: Request }) => Response | Promise<Response>;

function createContext(env = {}) {
  return {
    cloudflare: {
      env,
    },
  };
}

function createCanaryDb(options: {
  plan?: string | null;
  planUpdateChanges?: number;
  watchlistUpdateChanges?: number;
  creditDeleteChanges?: number;
  snapshotReadThrows?: boolean;
  planCleanupThrows?: boolean;
  watchlistCleanupThrows?: boolean;
  creditCleanupThrows?: boolean;
  canaryLockOutcome?: "processing" | "failed";
  canaryLockReleaseChanges?: number;
  canaryLockReleaseThrows?: boolean;
  concurrentPlanUpdateBeforeCleanup?: boolean;
  watchlistRowsAfterCleanup?: CanaryWatchlistRow[];
} = {}) {
  const cleanedPlanPaymentIds = new Set<string>();
  const cleanedCreditPaymentIds = new Set<string>();
  const restoredWatchlistIds = new Set<string>();
  let canaryLockOutcome = options.canaryLockOutcome ?? null;
  let currentLockEventId: string | null = null;
  let currentLockMetadata = "{}";
  const recoverableLockRows: Array<{ event_id: string; metadata_json: string }> = [];
  let watchlistQueryCount = 0;
  const initialWatchlistRows: CanaryWatchlistRow[] = [
    {
      id: "watchlist-1",
      is_active: 0,
      paused_reason: "plan_limit",
      updated_at: "2026-06-01T00:00:00.000Z",
    },
  ];
  const initialUserPlan: CanaryUserPlan = {
    user_id: "user-1",
    plan: options.plan === undefined ? "starter" : options.plan,
    plan_updated_at: "2026-06-01T00:00:00.000Z",
    dodo_payment_id: "real-payment-1",
    dodo_product_id: "real-product-1",
    dodo_plan_change_product_id: null,
    dodo_status: "payment.succeeded",
    dodo_subscription_id: "real-subscription-1",
    dodo_customer_id: "real-customer-1",
    dodo_next_billing_at: "2026-07-01T00:00:00.000Z",
    evidence_entitlement_anchor: "2026-06-01T00:00:00.000Z",
    evidence_entitlement_anchor_source: "provider",
  };
  let userPlan = { ...initialUserPlan };
  let watchlistRows = initialWatchlistRows.map((row) => ({ ...row }));
  const mutationKinds: string[] = [];
  let creditGrant: {
    quantity_granted: number;
    status: string;
    granted_at: string;
    provider_payment_id: string;
  } | null = null;

  return {
    cleanedPlanPaymentIds,
    cleanedCreditPaymentIds,
    restoredWatchlistIds,
    get canaryLockOutcome() {
      return canaryLockOutcome;
    },
    expireCanaryLockForRecovery() {
      if (currentLockEventId && currentLockMetadata.includes("billing_canary_active")) {
        recoverableLockRows.push({
          event_id: currentLockEventId,
          metadata_json: currentLockMetadata,
        });
      }
      canaryLockOutcome = null;
      currentLockEventId = null;
      currentLockMetadata = "{}";
    },
    get userPlanState() {
      return { ...userPlan };
    },
    get watchlistState() {
      return watchlistRows.map((row) => ({ ...row }));
    },
    get creditGrantState() {
      return creditGrant ? { ...creditGrant } : null;
    },
    get mutationKinds() {
      return [...mutationKinds];
    },
    applyCanaryMutation(payload: {
      payment_id?: string;
      updated_at?: string;
      metadata?: { target_kind?: string };
      product_cart?: Array<{ product_id?: string }>;
    }) {
      const paymentId = String(payload.payment_id ?? "");
      const updatedAt = String(payload.updated_at ?? "2026-07-15T00:00:00.000Z");
      if (payload.metadata?.target_kind === "plan") {
        mutationKinds.push("plan");
        userPlan = {
          ...userPlan,
          plan_updated_at: updatedAt,
          dodo_payment_id: paymentId,
          dodo_product_id: String(payload.product_cart?.[0]?.product_id ?? ""),
          dodo_status: "payment.succeeded",
        };
        watchlistRows = watchlistRows.map((row) => ({
          ...row,
          is_active: 1,
          paused_reason: null,
          updated_at: updatedAt,
        }));
      }
      if (payload.metadata?.target_kind === "usage_bundle") {
        mutationKinds.push("usage_bundle");
        creditGrant = {
          quantity_granted: 500,
          status: "active",
          granted_at: "2026-07-15T00:00:00.000Z",
          provider_payment_id: paymentId,
        };
      }
    },
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          return {
            async run() {
              if (
                options.planCleanupThrows &&
                sql.includes("UPDATE user_plan") &&
                sql.includes("dodo_payment_id = ?")
              ) {
                throw new Error("plan cleanup database secret owner@example.com");
              }
              if (
                options.watchlistCleanupThrows &&
                sql.includes("UPDATE watchlist") &&
                sql.includes("paused_reason = ?")
              ) {
                throw new Error("watchlist cleanup database secret owner@example.com");
              }
              if (options.creditCleanupThrows && sql.includes("DELETE FROM evidence_top_up_grant")) {
                throw new Error("credit cleanup database secret owner@example.com");
              }
              let changes = 0;
              if (sql.includes("INSERT INTO dodo_webhook_event")) {
                if (canaryLockOutcome === "processing") {
                  return { success: true, meta: { changes: 0 } };
                }
                canaryLockOutcome = "processing";
                currentLockEventId = String(bindings[0]);
                return { success: true, meta: { changes: 1 } };
              }
              if (
                sql.includes("UPDATE dodo_webhook_event") &&
                sql.includes("SET metadata_json = ?")
              ) {
                currentLockMetadata = String(bindings[0]);
                return { success: true, meta: { changes: canaryLockOutcome === "processing" ? 1 : 0 } };
              }
              if (
                sql.includes("json_extract(metadata_json, '$.action') = 'billing_canary_active'") &&
                sql.includes("SET outcome = 'failed'")
              ) {
                const eventId = String(bindings[1]);
                const index = recoverableLockRows.findIndex((row) => row.event_id === eventId);
                if (index >= 0) recoverableLockRows.splice(index, 1);
                return { success: true, meta: { changes: index >= 0 ? 1 : 0 } };
              }
              if (sql.includes("SET outcome = 'failed'")) {
                if (options.canaryLockReleaseThrows) {
                  throw new Error("lock release failed");
                }
                changes = options.canaryLockReleaseChanges ?? 1;
                if (changes > 0) canaryLockOutcome = "failed";
                return { success: true, meta: { changes } };
              }
              if (sql.includes("UPDATE user_plan") && sql.includes("SET plan = ?")) {
                const paymentId = String(bindings[14]);
                const markerMatches =
                  userPlan.user_id === String(bindings[11]) &&
                  userPlan.dodo_payment_id === paymentId &&
                  userPlan.plan_updated_at === String(bindings[13]) &&
                  userPlan.plan === String(bindings[12]) &&
                  userPlan.dodo_product_id === String(bindings[15]) &&
                  userPlan.dodo_plan_change_product_id === (bindings[16] as string | null) &&
                  userPlan.dodo_status === "payment.succeeded";
                changes = markerMatches
                  ? options.planUpdateChanges ?? 1
                  : 0;
                if (changes > 0) {
                  cleanedPlanPaymentIds.add(paymentId);
                  userPlan = {
                    user_id: String(bindings[11]),
                    plan: String(bindings[0]),
                    plan_updated_at: String(bindings[1]),
                    dodo_payment_id: bindings[2] as string | null,
                    dodo_product_id: bindings[3] as string | null,
                    dodo_plan_change_product_id: bindings[4] as string | null,
                    dodo_status: bindings[5] as string | null,
                    dodo_subscription_id: bindings[6] as string | null,
                    dodo_customer_id: bindings[7] as string | null,
                    dodo_next_billing_at: bindings[8] as string | null,
                    evidence_entitlement_anchor: bindings[9] as string | null,
                    evidence_entitlement_anchor_source: bindings[10] as string | null,
                  };
                }
              }
              if (sql.includes("UPDATE user_plan") && sql.includes("SET dodo_payment_id = CASE")) {
                const canaryPaymentId = String(bindings[0]);
                const ownsCanaryStatus =
                  userPlan.dodo_payment_id === canaryPaymentId &&
                  userPlan.plan_updated_at === String(bindings[6]) &&
                  userPlan.dodo_status === "payment.succeeded";
                changes = userPlan.dodo_payment_id === canaryPaymentId ? 1 : 0;
                if (changes > 0) {
                  cleanedPlanPaymentIds.add(canaryPaymentId);
                  userPlan = {
                    ...userPlan,
                    dodo_payment_id: bindings[1] as string | null,
                    dodo_product_id: bindings[4] as string | null,
                    dodo_status: ownsCanaryStatus
                      ? bindings[7] as string | null
                      : userPlan.dodo_status,
                    plan_updated_at: ownsCanaryStatus
                      ? String(bindings[10])
                      : userPlan.plan_updated_at,
                  };
                }
              }
              if (sql.includes("DELETE FROM evidence_top_up_grant")) {
                const paymentId = String(bindings[1]);
                changes = creditGrant?.provider_payment_id === paymentId
                  ? options.creditDeleteChanges ?? 1
                  : 0;
                if (changes > 0) {
                  cleanedCreditPaymentIds.add(paymentId);
                  creditGrant = null;
                }
              }
              if (sql.includes("UPDATE watchlist") && sql.includes("paused_reason = ?")) {
                const watchlist = watchlistRows.find((row) => row.id === String(bindings[4]));
                const markerMatches =
                  watchlist?.is_active === Number(bindings[5]) &&
                  watchlist?.paused_reason === (bindings[6] as string | null) &&
                  watchlist?.updated_at === String(bindings[7]);
                changes = markerMatches ? options.watchlistUpdateChanges ?? 1 : 0;
                if (changes > 0 && watchlist) {
                  restoredWatchlistIds.add(String(bindings[4]));
                  watchlist.is_active = Number(bindings[0]);
                  watchlist.paused_reason = bindings[1] as string | null;
                  watchlist.updated_at = String(bindings[2]);
                }
              }
              return { success: true, meta: { changes } };
            },
            async all<T>() {
              if (
                options.snapshotReadThrows &&
                sql.includes("FROM user_plan") &&
                sql.includes("LIMIT 1") &&
                !sql.includes("AND dodo_payment_id = ?")
              ) {
                throw new Error("snapshot database secret owner@example.com");
              }
              if (sql.includes("FROM dodo_webhook_event")) {
                if (sql.includes("SELECT event_id, metadata_json")) {
                  return { results: recoverableLockRows as T[] };
                }
                return {
                  results: canaryLockOutcome
                    ? [{
                        outcome: canaryLockOutcome,
                        processing_started_at: canaryLockOutcome === "processing" ? new Date().toISOString() : null,
                        active_lease: canaryLockOutcome === "processing" ? 1 : 0,
                      }]
                    : [],
                } as { results: T[] };
              }
              if (sql.includes("FROM user") && sql.includes("LEFT JOIN user_plan")) {
                return {
                  results: [
                    {
                      id: "user-1",
                      email: "owner@example.com",
                      name: "Owner",
                      plan: userPlan.plan,
                    },
                  ] as T[],
                };
              }

              if (sql.includes("FROM watchlist")) {
                watchlistQueryCount += 1;
                return {
                  results: (watchlistQueryCount > 1 && options.watchlistRowsAfterCleanup !== undefined
                    ? options.watchlistRowsAfterCleanup
                    : watchlistRows) as T[],
                };
              }

              if (sql.includes("FROM user_plan") && sql.includes("LIMIT 1")) {
                if (sql.includes("AND dodo_payment_id = ?")) {
                  return userPlan.dodo_payment_id === String(bindings[1])
                    ? { results: [{ plan: userPlan.plan, dodo_payment_id: bindings[1] }] as T[] }
                    : { results: [] as T[] };
                }

                return {
                  results: userPlan.dodo_payment_id ? [userPlan as T] : [],
                };
              }

              if (sql.includes("FROM evidence_top_up_grant")) {
                return creditGrant?.provider_payment_id === String(bindings[1])
                  ? { results: [creditGrant as T] }
                  : { results: [] as T[] };
              }

              return { results: [] as T[] };
            },
          };
        },
      };
    },
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      if (options.planCleanupThrows || options.watchlistCleanupThrows) {
        throw new Error("cleanup batch failed");
      }
      if (options.concurrentPlanUpdateBeforeCleanup) {
        options.concurrentPlanUpdateBeforeCleanup = false;
        userPlan = {
          ...userPlan,
          plan_updated_at: "2026-07-16T00:00:00.000Z",
          dodo_status: "cancellation_scheduled",
          dodo_next_billing_at: "2026-09-01T00:00:00.000Z",
        };
      }
      return Promise.all(statements.map((statement) => statement.run()));
    },
  };
}

function createEnv(
  options: Parameters<typeof createCanaryDb>[0] = {},
  workerVersionId?: string,
) {
  return {
    CANARY_BYPASS_TOKEN: "secret-token",
    ...(workerVersionId ? { CF_VERSION_METADATA: { id: workerVersionId } } : {}),
    DB: createCanaryDb(options),
    DODO_0509_BRAND_ID: "brand_0509",
    DODO_0509_PRODUCT_PROOF_PACK_500_ID: "prod_pack_500",
    DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
    DODO_0509_PRODUCT_STARTER_MONTHLY_ID: "prod_starter_monthly",
    DODO_0509_WEBHOOK_SECRET: "webhook-secret",
    LAUNCH_CANARY_EMAIL: "owner@example.com",
  };
}

async function invokeCanary({
  env = createEnv(),
  webhookAction = vi.fn(async () => Response.json({ ok: true })),
  url = "https://0509.io/api/billing/dodo/canary",
  headers = {},
  body,
}: {
  env?: ReturnType<typeof createEnv>;
  webhookAction?: ReturnType<typeof vi.fn<WebhookAction>>;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
  } = {}) {
  const statefulWebhookAction = vi.fn(async ({ request }: { request: Request }) => {
    const payload = JSON.parse(await request.clone().text());
    env.DB.applyCanaryMutation(payload);
    return webhookAction({ request });
  });
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => env),
  }));
  vi.doMock("~/routes/api.webhooks.dodo", () => ({
    action: statefulWebhookAction,
  }));
  const { action } = await import("~/routes/api.billing.dodo.canary");
  return action({
    context: createContext(),
    request: new Request(url, {
      method: "POST",
      headers: {
        "x-0509-canary-token": "secret-token",
        ...headers,
      },
      body,
    }),
  } as never);
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
    const body = await response.json();
    expect(body).toMatchObject({
      ok: false,
      blocker: "invalid_canary_email_override",
    });
  });

  it("rejects a mismatched Worker version before database or webhook mutations", async () => {
    const env = createEnv({}, "worker-v2");
    const webhookAction = vi.fn(async () => Response.json({ ok: true }));
    const response = await invokeCanary({
      env,
      webhookAction,
      headers: { "x-0509-expected-worker-version": "worker-v1" },
    });

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      blocker: "worker_version_mismatch",
    });
    expect(env.DB.mutationKinds).toEqual([]);
    expect(webhookAction).not.toHaveBeenCalled();
  });

  it("runs and cleans up the canary when the Worker version matches", async () => {
    const env = createEnv({}, "worker-v1");
    const webhookAction = vi.fn(async () => Response.json({ ok: true }));
    const response = await invokeCanary({
      env,
      webhookAction,
      headers: { "x-0509-expected-worker-version": "worker-v1" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      workerVersionId: "worker-v1",
      grants: {
        planCleanupOk: true,
        watchlistCleanupOk: true,
        proofCreditCleanupOk: true,
      },
    });
    expect(webhookAction).toHaveBeenCalledTimes(2);
    expect([...env.DB.mutationKinds].sort()).toEqual(["plan", "usage_bundle"]);
    expect(env.DB.userPlanState.dodo_payment_id).toBe("real-payment-1");
    expect(env.DB.watchlistState).toEqual([
      expect.objectContaining({
        id: "watchlist-1",
        is_active: 0,
        paused_reason: "plan_limit",
      }),
    ]);
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
      expect(body.metadata.billing_canary_lock_id).toMatch(
        /^billing-canary-lock:user-1:[a-z0-9-]+$/u,
      );
      expect(request.headers.get("x-0509-billing-canary-lock-id"))
        .toBe(body.metadata.billing_canary_lock_id);
      env.DB.applyCanaryMutation(body);

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
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      user: {
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
    expect(JSON.stringify(body)).not.toContain("owner@example.com");
    expect(env.DB.cleanedCreditPaymentIds.size).toBe(1);
    expect(env.DB.restoredWatchlistIds.has("watchlist-1")).toBe(true);
    expect(env.DB.canaryLockOutcome).toBe("failed");
    expect([...env.DB.mutationKinds].sort()).toEqual(["plan", "usage_bundle"]);
    expect(env.DB.userPlanState).toEqual({
      user_id: "user-1",
      plan: "starter",
      plan_updated_at: "2026-06-01T00:00:00.000Z",
      dodo_payment_id: "real-payment-1",
      dodo_product_id: "real-product-1",
      dodo_plan_change_product_id: null,
      dodo_status: "payment.succeeded",
      dodo_subscription_id: "real-subscription-1",
      dodo_customer_id: "real-customer-1",
      dodo_next_billing_at: "2026-07-01T00:00:00.000Z",
      evidence_entitlement_anchor: "2026-06-01T00:00:00.000Z",
      evidence_entitlement_anchor_source: "provider",
    });
    expect(env.DB.watchlistState).toEqual([
      {
        id: "watchlist-1",
        is_active: 0,
        paused_reason: "plan_limit",
        updated_at: "2026-06-01T00:00:00.000Z",
      },
    ]);
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

  it("compensates after the plan succeeds but the credit webhook fails", async () => {
    const webhookAction = vi.fn(async ({ request }: { request: Request }) => {
      const payload = JSON.parse(await request.text());
      if (payload.metadata.target_kind === "usage_bundle") {
        throw new Error("provider secret should never escape");
      }
      return Response.json({ ok: true });
    });
    const env = createEnv();
    const response = await invokeCanary({ env, webhookAction });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      ok: false,
      blocker: "billing_canary_failed",
      grants: {
        planCleanupOk: true,
        watchlistCleanupOk: true,
        proofCreditCleanupOk: true,
      },
    });
    expect(JSON.stringify(body)).not.toContain("provider secret");
    expect(JSON.stringify(body)).not.toContain("owner@example.com");
    expect(env.DB.cleanedPlanPaymentIds.size).toBe(1);
    expect(env.DB.cleanedCreditPaymentIds.size).toBe(1);
    expect(env.DB.restoredWatchlistIds.has("watchlist-1")).toBe(true);
    expect(env.DB.canaryLockOutcome).toBe("failed");
  });

  it("removes only synthetic residue when the exact plan restore changes zero rows", async () => {
    const env = createEnv({ planUpdateChanges: 0 });
    const response = await invokeCanary({ env });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      grants: {
        planCleanupOk: true,
        watchlistCleanupOk: true,
      },
    });
    expect(env.DB.userPlanState.dodo_payment_id).toBe("real-payment-1");
  });

  it("preserves a newer provider lifecycle update instead of restoring a stale canary snapshot", async () => {
    const env = createEnv({ concurrentPlanUpdateBeforeCleanup: true });
    const response = await invokeCanary({ env });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      grants: {
        planCleanupOk: true,
        watchlistCleanupOk: true,
      },
    });
    expect(env.DB.userPlanState).toMatchObject({
      dodo_status: "cancellation_scheduled",
      plan_updated_at: "2026-07-16T00:00:00.000Z",
      dodo_next_billing_at: "2026-09-01T00:00:00.000Z",
      dodo_payment_id: "real-payment-1",
    });
    expect(env.DB.restoredWatchlistIds.size).toBe(1);
  });

  it("fails closed when proof-credit cleanup changes zero rows", async () => {
    const env = createEnv({ creditDeleteChanges: 0 });
    const response = await invokeCanary({ env });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      ok: false,
      grants: {
        paidPlanUnlocked: true,
        planCleanupOk: true,
        watchlistCleanupOk: true,
        proofCreditsGranted: true,
        proofCreditCleanupOk: false,
      },
    });
    expect(env.DB.creditGrantState).toMatchObject({
      provider_payment_id: expect.stringContaining("-proof-500"),
      quantity_granted: 500,
      status: "active",
    });
    expect(env.DB.canaryLockOutcome).toBe("processing");
  });

  it("recovers a stale synthetic credit residue before starting the next fenced canary", async () => {
    const options = { creditDeleteChanges: 0 };
    const env = createEnv(options);
    const headers = { "content-type": "application/json" };
    const first = await invokeCanary({
      env,
      headers,
      body: JSON.stringify({ gateRunId: "recovery-first" }),
    });
    expect(first.status).toBe(503);
    expect(env.DB.creditGrantState).not.toBeNull();
    expect(env.DB.canaryLockOutcome).toBe("processing");

    env.DB.expireCanaryLockForRecovery();
    options.creditDeleteChanges = 1;
    const second = await invokeCanary({
      env,
      headers,
      body: JSON.stringify({ gateRunId: "recovery-second" }),
    });

    expect(second.status).toBe(200);
    expect(env.DB.creditGrantState).toBeNull();
    expect(env.DB.cleanedCreditPaymentIds.size).toBe(2);
    expect(env.DB.canaryLockOutcome).toBe("failed");
  });

  it("fails closed when watchlist restoration changes zero rows", async () => {
    const env = createEnv({ watchlistUpdateChanges: 0 });
    const response = await invokeCanary({ env });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      ok: false,
      grants: {
        planCleanupOk: true,
        watchlistCleanupOk: false,
        proofCreditCleanupOk: true,
      },
    });
  });

  it.each([
    [
      "plan",
      { planCleanupThrows: true },
      { planCleanupOk: false, watchlistCleanupOk: false, proofCreditCleanupOk: true },
    ],
    [
      "watchlist",
      { watchlistCleanupThrows: true },
      { planCleanupOk: false, watchlistCleanupOk: false, proofCreditCleanupOk: true },
    ],
    [
      "credit",
      { creditCleanupThrows: true },
      { planCleanupOk: true, watchlistCleanupOk: true, proofCreditCleanupOk: false },
    ],
  ])("fails closed when %s cleanup throws", async (_kind, options, cleanupFlags) => {
    const env = createEnv(options);
    const response = await invokeCanary({ env });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      ok: false,
      grants: cleanupFlags,
    });
    expect(body).not.toHaveProperty("restored");
    expect(JSON.stringify(body)).not.toContain("owner@example.com");
    expect(JSON.stringify(body)).not.toContain("database secret");
    expect(env.DB.canaryLockOutcome).toBe("processing");
    expect([...env.DB.mutationKinds].sort()).toEqual(["plan", "usage_bundle"]);
    expect(env.DB.cleanedPlanPaymentIds.size).toBe(
      _kind === "plan" || _kind === "watchlist" ? 0 : 1,
    );
    expect(env.DB.restoredWatchlistIds.size).toBe(
      _kind === "plan" || _kind === "watchlist" ? 0 : 1,
    );
    expect(env.DB.cleanedCreditPaymentIds.size).toBe(_kind === "credit" ? 0 : 1);
    if (_kind === "credit") {
      expect(env.DB.creditGrantState).toMatchObject({ status: "active" });
    } else {
      expect(env.DB.creditGrantState).toBeNull();
    }
  });

  it("fails safely when the initial snapshot read throws", async () => {
    const webhookAction = vi.fn(async () => Response.json({ ok: true }));
    const env = createEnv({ snapshotReadThrows: true });
    const response = await invokeCanary({ env, webhookAction });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({ ok: false, blocker: "billing_canary_failed" });
    expect(JSON.stringify(body)).not.toContain("owner@example.com");
    expect(JSON.stringify(body)).not.toContain("snapshot database secret");
    expect(webhookAction).not.toHaveBeenCalled();
    expect(env.DB.mutationKinds).toEqual([]);
    expect(env.DB.canaryLockOutcome).toBe("failed");
  });

  it.each([
    ["missing", []],
    [
      "changed",
      [
        {
          id: "watchlist-1",
          is_active: 1,
          paused_reason: null,
          updated_at: "2026-07-15T00:00:00.000Z",
        },
      ],
    ],
  ])("fails closed when a watchlist is %s after cleanup", async (_label, watchlistRowsAfterCleanup) => {
    const env = createEnv({ watchlistRowsAfterCleanup });
    const response = await invokeCanary({ env });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      ok: false,
      grants: {
        planCleanupOk: true,
        watchlistCleanupOk: false,
      },
    });
  });

  it("rejects valid-token requests that are not on the canonical origin", async () => {
    const webhookAction = vi.fn(async () => Response.json({ ok: true }));

    await expect(
      invokeCanary({
        url: "https://staging.0509.io/api/billing/dodo/canary",
        webhookAction,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(webhookAction).not.toHaveBeenCalled();
  });

  it("fails closed when the canary user has no supported plan", async () => {
    const response = await invokeCanary({ env: createEnv({ plan: null }) });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ ok: false, blocker: "invalid_canary_plan" });
  });

  it("rejects a concurrent canary while the per-user lease is in progress", async () => {
    const webhookAction = vi.fn(async () => Response.json({ ok: true }));
    const response = await invokeCanary({
      env: createEnv({ canaryLockOutcome: "processing" }),
      webhookAction,
    });

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      blocker: "billing_canary_in_progress",
    });
    expect(webhookAction).not.toHaveBeenCalled();
  });

  it("fails closed when the billing canary lock cannot be released", async () => {
    const response = await invokeCanary({
      env: createEnv({ canaryLockReleaseChanges: 0 }),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      blocker: "billing_canary_lock_release_failed",
    });
  });

  it("fails closed when the bounded canary runtime is exceeded", async () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValue(62_000);
    const webhookAction = vi.fn(async () => Response.json({ ok: true }));
    const response = await invokeCanary({ webhookAction });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      blocker: "billing_canary_duration_exceeded",
    });
    expect(webhookAction).not.toHaveBeenCalled();
  });

  it("rejects non-POST action requests before canary work", async () => {
    const env = createEnv();
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    const { action } = await import("~/routes/api.billing.dodo.canary");

    const response = await action({
      context: createContext(),
      request: new Request("https://0509.io/api/billing/dodo/canary", {
        method: "GET",
        headers: { "x-0509-canary-token": "secret-token" },
      }),
    } as never);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      blocker: "billing_canary_requires_post",
    });
  });
});
