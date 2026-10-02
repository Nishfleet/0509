import { env } from "cloudflare:test";
import { Webhook } from "standardwebhooks";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { checkoutProof } from "../../app/lib/billing/checkout-proof.server";
import { readEntitlements } from "../../app/lib/data/plan.server";
import { action } from "../../app/routes/api.webhooks.dodo";
import subscriptionActive from "../fixtures/dodo/subscription-active.json";

const WORKSPACE = "ws-webhook";

interface PlanRow {
  tier: string;
  status: string;
  provider_customer_id: string;
  provider_subscription_id: string;
  current_period_end: string;
  updated_at: string;
}

let proof = "";

beforeAll(async () => {
  proof = await checkoutProof(WORKSPACE, "pdt_test_starter");
});

function eventBody(overrides: { type?: string; timestamp?: string; data?: Record<string, unknown> }): string {
  return JSON.stringify({
    ...subscriptionActive,
    ...overrides,
    data: {
      ...subscriptionActive.data,
      metadata: { workspace_id: WORKSPACE, plan: "starter", proof },
      ...overrides.data,
    },
  });
}

function signedRequest(id: string, body: string, signedAt: Date = new Date()): Request {
  const signature = new Webhook(env.DODO_WEBHOOK_SECRET).sign(id, signedAt, body);
  return new Request("https://0509.io/api/webhooks/dodo", {
    method: "POST",
    body,
    headers: {
      "webhook-id": id,
      "webhook-timestamp": String(Math.floor(signedAt.getTime() / 1000)),
      "webhook-signature": signature,
    },
  });
}

async function deliver(request: Request): Promise<Response> {
  const result = await action({ request, params: {}, context: {} } as unknown as Parameters<typeof action>[0]);
  return result;
}

const planRow = () => env.DB.prepare("SELECT * FROM plan WHERE workspace_id = ?").bind(WORKSPACE).first<PlanRow>();

const eventRow = (id: string) =>
  env.DB.prepare("SELECT event_type, processed_at FROM dodo_webhook_event WHERE id = ?")
    .bind(id)
    .first<{ event_type: string; processed_at: string | null }>();

describe("Dodo webhook (J13)", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM plan").run();
    await env.DB.prepare("DELETE FROM dodo_webhook_event").run();
    await env.DB.prepare("DELETE FROM workspace").run();
    await env.DB.prepare('DELETE FROM "user"').run();
    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES ('user-webhook', 'Webhook', 'webhook@example.com', 1, '2026-09-29T00:00:00Z', '2026-09-29T00:00:00Z')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES (?, 'Webhook', 'user-webhook', 'UTC', 1, 8, '2026-09-29T00:00:00Z')`,
    )
      .bind(WORKSPACE)
      .run();
  });

  it("flips a scout workspace to the paid tier when subscription.active lands", async () => {
    expect((await readEntitlements(WORKSPACE)).competitors).toBe(5);

    const response = await deliver(signedRequest("evt_active_1", eventBody({})));

    expect(response.status).toBe(200);
    expect(await planRow()).toMatchObject({
      tier: "starter",
      status: "active",
      provider_customer_id: "cus_8VbC6JDZzPEqfBPUdpj0K",
      provider_subscription_id: "sub_7EeHq2ewQuadropD2ra",
      current_period_end: "2026-10-06T10:00:00.125145Z",
    });
    expect((await readEntitlements(WORKSPACE)).competitors).toBe(15);
    expect((await eventRow("evt_active_1"))?.processed_at).not.toBeNull();
  });

  it("applies a redelivered webhook-id once", async () => {
    await deliver(signedRequest("evt_replay", eventBody({})));
    await env.DB.prepare("UPDATE plan SET status = 'marker' WHERE workspace_id = ?").bind(WORKSPACE).run();

    const replay = await deliver(signedRequest("evt_replay", eventBody({})));

    expect(replay.status).toBe(200);
    expect((await planRow())?.status).toBe("marker");
  });

  it("refuses a body signed with another secret, a missing signature and a stale timestamp", async () => {
    const body = eventBody({});
    const forged = new Request("https://0509.io/api/webhooks/dodo", {
      method: "POST",
      body,
      headers: {
        "webhook-id": "evt_forged",
        "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
        "webhook-signature": new Webhook("whsec_YW5vdGhlci1zZWNyZXQtbm90LW91cnM=").sign("evt_forged", new Date(), body),
      },
    });
    const unsigned = new Request("https://0509.io/api/webhooks/dodo", { method: "POST", body });
    const stale = signedRequest("evt_stale", body, new Date(Date.now() - 60 * 60 * 1000));

    for (const request of [forged, unsigned, stale]) {
      expect((await deliver(request)).status).toBe(400);
    }
    expect(await planRow()).toBeNull();
    expect(await eventRow("evt_forged")).toBeNull();
    expect(await eventRow("evt_stale")).toBeNull();
  });

  it("takes paid access away on_hold and keeps it through a cancel scheduled for period end", async () => {
    await deliver(signedRequest("evt_1", eventBody({})));

    await deliver(
      signedRequest(
        "evt_2",
        eventBody({ type: "subscription.on_hold", timestamp: "2026-09-30T00:00:00Z", data: { status: "on_hold" } }),
      ),
    );
    expect((await readEntitlements(WORKSPACE)).competitors).toBe(5);

    const paidThrough = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    await deliver(
      signedRequest(
        "evt_3",
        eventBody({
          type: "subscription.cancelled",
          timestamp: "2026-10-01T00:00:00Z",
          data: { status: "cancelled", cancel_at_next_billing_date: true, next_billing_date: paidThrough },
        }),
      ),
    );
    expect((await readEntitlements(WORKSPACE)).competitors).toBe(15);

    await deliver(
      signedRequest(
        "evt_4",
        eventBody({ type: "subscription.expired", timestamp: "2026-10-02T00:00:00Z", data: { status: "expired" } }),
      ),
    );
    expect((await readEntitlements(WORKSPACE)).competitors).toBe(5);
  });

  it("drops to scout at once on a cancel that was not scheduled for period end", async () => {
    await deliver(signedRequest("evt_now_1", eventBody({})));
    const stillPaidFor = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();

    await deliver(
      signedRequest(
        "evt_now_2",
        eventBody({
          type: "subscription.cancelled",
          timestamp: "2026-10-01T00:00:00Z",
          data: { status: "cancelled", cancel_at_next_billing_date: false, next_billing_date: stillPaidFor },
        }),
      ),
    );

    expect((await planRow())?.current_period_end).toBeNull();
    expect((await readEntitlements(WORKSPACE)).competitors).toBe(5);
  });

  it("does not let an older event overwrite a newer one", async () => {
    await deliver(
      signedRequest(
        "evt_new",
        eventBody({ type: "subscription.on_hold", timestamp: "2026-09-30T00:00:00Z", data: { status: "on_hold" } }),
      ),
    );
    await deliver(signedRequest("evt_old", eventBody({ timestamp: "2026-09-29T10:00:05Z" })));

    expect((await planRow())?.status).toBe("on_hold");
  });

  it("finds the workspace by subscription id when the event carries no metadata", async () => {
    await deliver(signedRequest("evt_meta", eventBody({})));

    const renewed = eventBody({
      type: "subscription.renewed",
      timestamp: "2026-10-06T10:00:09Z",
      data: { metadata: {} },
    });
    expect((await deliver(signedRequest("evt_renewed", renewed))).status).toBe(200);

    expect((await planRow())?.updated_at).toBe("2026-10-06T10:00:09Z");
  });

  it("answers 200 and stores nothing for a signed body it does not understand", async () => {
    for (const [index, body] of ["not json", "[]", '{"hello":"world"}'].entries()) {
      const response = await deliver(signedRequest(`evt_odd_${String(index)}`, body));
      expect(response.status).toBe(200);
      expect(await eventRow(`evt_odd_${String(index)}`)).toBeNull();
    }
  });

  it("stores only the event id, type, subscription id and timestamps, never the customer", async () => {
    await deliver(signedRequest("evt_minimal", eventBody({})));

    const row = await env.DB.prepare("SELECT payload_json, event_type FROM dodo_webhook_event WHERE id = ?")
      .bind("evt_minimal")
      .first<{ payload_json: string; event_type: string }>();

    expect(row?.event_type).toBe("subscription.active");
    expect(JSON.parse(row?.payload_json ?? "")).toEqual({
      subscription_id: "sub_7EeHq2ewQuadropD2ra",
      timestamp: "2026-09-29T10:00:05.736731Z",
    });
    expect(row?.payload_json).not.toContain("buyer@example.com");
  });

  it("records an unknown product and a non-subscription event and changes no plan", async () => {
    await deliver(signedRequest("evt_product", eventBody({ data: { product_id: "pdt_not_ours" } })));
    await deliver(signedRequest("evt_payment", eventBody({ type: "payment.succeeded" })));

    expect(await planRow()).toBeNull();
    expect((await eventRow("evt_product"))?.processed_at).not.toBeNull();
    expect(await eventRow("evt_payment")).toMatchObject({ event_type: "payment.succeeded" });
  });

  it("answers 500 and leaves the event unprocessed when no workspace exists yet, then applies it on redelivery", async () => {
    const orphan = eventBody({ data: { metadata: {}, subscription_id: "sub_not_yet_linked" } });

    const first = await deliver(signedRequest("evt_orphan", orphan));

    expect(first.status).toBe(500);
    expect(await planRow()).toBeNull();
    expect((await eventRow("evt_orphan"))?.processed_at).toBeNull();

    const linked = eventBody({ data: { subscription_id: "sub_not_yet_linked" } });
    const second = await deliver(signedRequest("evt_orphan", linked));

    expect(second.status).toBe(200);
    expect((await planRow())?.tier).toBe("starter");
    expect((await eventRow("evt_orphan"))?.processed_at).not.toBeNull();
  });

  describe("a subscription our server did not start", () => {
    const VICTIM = "ws-victim";
    const seedVictim = async () => {
      await env.DB.prepare(
        `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
         VALUES (?, 'Victim', 'user-webhook', 'UTC', 1, 8, '2026-09-29T00:00:00Z')`,
      )
        .bind(VICTIM)
        .run();
      await env.DB.prepare(
        `INSERT INTO plan (id, workspace_id, tier, status, provider_customer_id, provider_subscription_id, current_period_end, updated_at)
         VALUES ('plan-victim', ?, 'agency', 'active', 'cus_victim', 'sub_victim', '2026-12-01T00:00:00Z', '2026-09-30T00:00:00Z')`,
      )
        .bind(VICTIM)
        .run();
    };
    const victimPlan = () =>
      env.DB.prepare("SELECT tier, provider_subscription_id FROM plan WHERE workspace_id = ?")
        .bind(VICTIM)
        .first<{ tier: string; provider_subscription_id: string }>();

    it("ignores metadata with no proof and answers 200 so Dodo does not retry", async () => {
      const forged = eventBody({ data: { metadata: { workspace_id: WORKSPACE } } });

      const response = await deliver(signedRequest("evt_forged", forged));

      expect(response.status).toBe(200);
      expect(await planRow()).toBeNull();
      expect((await eventRow("evt_forged"))?.processed_at).not.toBeNull();
    });

    it("ignores a proof that does not match the workspace or the product", async () => {
      await seedVictim();
      const stolen = eventBody({ data: { metadata: { workspace_id: VICTIM, plan: "starter", proof } } });
      const wrongProduct = await checkoutProof(WORKSPACE, "pdt_test_agency");

      await deliver(signedRequest("evt_stolen", stolen));
      await deliver(
        signedRequest(
          "evt_product",
          eventBody({ data: { metadata: { workspace_id: WORKSPACE, plan: "starter", proof: wrongProduct } } }),
        ),
      );
      await deliver(
        signedRequest(
          "evt_garbage",
          eventBody({ data: { metadata: { workspace_id: WORKSPACE, plan: "starter", proof: "not hex" } } }),
        ),
      );

      expect(await victimPlan()).toEqual({ tier: "agency", provider_subscription_id: "sub_victim" });
      expect(await planRow()).toBeNull();
    });

    it("does not let a different subscription with a lower tier displace an entitled plan", async () => {
      await deliver(signedRequest("evt_first", eventBody({})));
      const scoutProof = await checkoutProof(WORKSPACE, "pdt_test_scout");
      const oldScout = eventBody({
        timestamp: "2026-10-01T00:00:00Z",
        data: {
          subscription_id: "sub_old_scout",
          product_id: "pdt_test_scout",
          status: "cancelled",
          cancel_at_next_billing_date: false,
          metadata: { workspace_id: WORKSPACE, plan: "scout", proof: scoutProof },
        },
      });

      await deliver(signedRequest("evt_old_scout", oldScout));

      expect(await planRow()).toMatchObject({ tier: "starter", provider_subscription_id: "sub_7EeHq2ewQuadropD2ra" });
    });

    it("lets a proven upgrade to a higher tier replace the earlier subscription", async () => {
      const scoutProof = await checkoutProof(WORKSPACE, "pdt_test_scout");
      await deliver(
        signedRequest(
          "evt_scout",
          eventBody({
            data: {
              subscription_id: "sub_scout",
              product_id: "pdt_test_scout",
              metadata: { workspace_id: WORKSPACE, plan: "scout", proof: scoutProof },
            },
          }),
        ),
      );

      await deliver(signedRequest("evt_upgrade", eventBody({ timestamp: "2026-10-01T00:00:00Z" })));

      expect(await planRow()).toMatchObject({ tier: "starter", provider_subscription_id: "sub_7EeHq2ewQuadropD2ra" });
    });
  });
});
