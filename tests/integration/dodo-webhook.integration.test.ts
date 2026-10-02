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

    const scoutMetadata = async () => ({
      workspace_id: WORKSPACE,
      plan: "scout",
      proof: await checkoutProof(WORKSPACE, "pdt_test_scout"),
    });

    it("ignores the end or renewal of an earlier subscription once another one is current", async () => {
      await deliver(signedRequest("evt_first", eventBody({})));
      const earlier = async (type: string, status: string) =>
        eventBody({
          type,
          timestamp: "2026-10-01T00:00:00Z",
          data: {
            subscription_id: "sub_old_scout",
            product_id: "pdt_test_scout",
            status,
            cancel_at_next_billing_date: false,
            metadata: await scoutMetadata(),
          },
        });

      await deliver(signedRequest("evt_old_cancel", await earlier("subscription.cancelled", "cancelled")));
      await deliver(signedRequest("evt_old_renew", await earlier("subscription.renewed", "active")));

      expect(await planRow()).toMatchObject({ tier: "starter", provider_subscription_id: "sub_7EeHq2ewQuadropD2ra" });
    });

    it("ignores the end of an older subscription after a deliberate downgrade to scout", async () => {
      await deliver(signedRequest("evt_starter", eventBody({})));
      await deliver(
        signedRequest(
          "evt_downgrade",
          eventBody({
            timestamp: "2026-10-01T00:00:00Z",
            data: { subscription_id: "sub_scout", product_id: "pdt_test_scout", metadata: await scoutMetadata() },
          }),
        ),
      );

      await deliver(
        signedRequest(
          "evt_old_end",
          eventBody({
            type: "subscription.cancelled",
            timestamp: "2026-10-02T00:00:00Z",
            data: { status: "cancelled", cancel_at_next_billing_date: false },
          }),
        ),
      );

      expect(await planRow()).toMatchObject({ tier: "scout", provider_subscription_id: "sub_scout" });
    });

    it("ignores a delayed subscription.active for an older subscription", async () => {
      await deliver(
        signedRequest(
          "evt_scout",
          eventBody({
            timestamp: "2026-10-01T00:00:00Z",
            data: { subscription_id: "sub_scout", product_id: "pdt_test_scout", metadata: await scoutMetadata() },
          }),
        ),
      );

      await deliver(signedRequest("evt_replay", eventBody({ timestamp: "2026-09-30T00:00:00Z" })));
      await deliver(signedRequest("evt_replay_same", eventBody({ timestamp: "2026-10-01T00:00:00Z" })));

      expect(await planRow()).toMatchObject({ tier: "scout", provider_subscription_id: "sub_scout" });
    });

    it.each([
      ["missing", ""],
      ["unreadable", "not a time"],
      ["in the future", "2099-01-01T00:00:00Z"],
    ])("still lets a newer proven active replace a current row whose time is %s", async (_label, stored) => {
      await deliver(
        signedRequest(
          "evt_scout",
          eventBody({
            data: { subscription_id: "sub_scout", product_id: "pdt_test_scout", metadata: await scoutMetadata() },
          }),
        ),
      );
      await env.DB.prepare("UPDATE plan SET updated_at = ? WHERE workspace_id = ?").bind(stored, WORKSPACE).run();

      await deliver(signedRequest("evt_upgrade", eventBody({ timestamp: "2026-10-01T00:00:00Z" })));

      expect(await planRow()).toMatchObject({ tier: "starter", provider_subscription_id: "sub_7EeHq2ewQuadropD2ra" });
    });

    describe("the tester product", () => {
      const TESTER = "pdt_test_tester";
      const testerEvent = async (
        overrides: { type?: string; timestamp?: string; proof?: string } = {},
      ): Promise<string> =>
        eventBody({
          ...(overrides.type === undefined ? {} : { type: overrides.type }),
          ...(overrides.timestamp === undefined ? {} : { timestamp: overrides.timestamp }),
          data: {
            subscription_id: "sub_tester",
            product_id: TESTER,
            metadata: {
              workspace_id: WORKSPACE,
              plan: "starter",
              proof: overrides.proof ?? (await checkoutProof(WORKSPACE, TESTER)),
            },
          },
        });
      const agencyActive = async (timestamp: string) =>
        eventBody({
          timestamp,
          data: {
            subscription_id: "sub_agency",
            product_id: "pdt_test_agency",
            metadata: {
              workspace_id: WORKSPACE,
              plan: "agency",
              proof: await checkoutProof(WORKSPACE, "pdt_test_agency"),
            },
          },
        });

      it("gives a proven tester subscription the Starter plan", async () => {
        await deliver(signedRequest("evt_tester", await testerEvent()));

        expect(await planRow()).toMatchObject({ tier: "starter", provider_subscription_id: "sub_tester" });
      });

      it("ignores a tester event whose proof was made for another product or workspace", async () => {
        const forged = await checkoutProof(WORKSPACE, "pdt_test_starter");
        const other = await checkoutProof("ws-elsewhere", TESTER);

        await deliver(signedRequest("evt_forged_product", await testerEvent({ proof: forged })));
        await deliver(signedRequest("evt_forged_workspace", await testerEvent({ proof: other })));

        expect(await planRow()).toBeNull();
      });

      it("never lets a tester checkout finished after buying a paid plan downgrade the workspace", async () => {
        await deliver(signedRequest("evt_agency", await agencyActive("2026-10-01T00:00:00Z")));

        await deliver(signedRequest("evt_tester_late", await testerEvent({ timestamp: "2026-10-02T00:00:00Z" })));

        expect(await planRow()).toMatchObject({ tier: "agency", provider_subscription_id: "sub_agency" });

        await deliver(
          signedRequest(
            "evt_agency_renewed",
            eventBody({
              type: "subscription.renewed",
              timestamp: "2026-10-03T00:00:00Z",
              data: { subscription_id: "sub_agency", product_id: "pdt_test_agency", status: "active" },
            }),
          ),
        );
        expect(await planRow()).toMatchObject({ tier: "agency", provider_subscription_id: "sub_agency" });
      });

      it("ignores a replayed older tester active once a newer subscription is current", async () => {
        await deliver(signedRequest("evt_agency", await agencyActive("2026-10-01T00:00:00Z")));
        await env.DB.prepare("UPDATE plan SET status = 'cancelled', current_period_end = NULL WHERE workspace_id = ?")
          .bind(WORKSPACE)
          .run();

        await deliver(signedRequest("evt_tester_old", await testerEvent({ timestamp: "2026-09-30T00:00:00Z" })));

        expect(await planRow()).toMatchObject({ tier: "agency", provider_subscription_id: "sub_agency" });
      });

      it("lets a tester subscription replace one that has ended", async () => {
        await deliver(signedRequest("evt_agency", await agencyActive("2026-10-01T00:00:00Z")));
        await env.DB.prepare("UPDATE plan SET status = 'cancelled', current_period_end = NULL WHERE workspace_id = ?")
          .bind(WORKSPACE)
          .run();

        await deliver(signedRequest("evt_tester", await testerEvent({ timestamp: "2026-10-02T00:00:00Z" })));

        expect(await planRow()).toMatchObject({ tier: "starter", provider_subscription_id: "sub_tester" });
      });
    });

    it("ignores an unproven active for another subscription on a workspace that already has one", async () => {
      await deliver(signedRequest("evt_first", eventBody({})));

      await deliver(
        signedRequest(
          "evt_takeover",
          eventBody({
            timestamp: "2026-10-02T00:00:00Z",
            data: {
              subscription_id: "sub_attacker",
              product_id: "pdt_test_scout",
              metadata: { workspace_id: WORKSPACE, plan: "scout", proof: "00" },
            },
          }),
        ),
      );

      expect(await planRow()).toMatchObject({ tier: "starter", provider_subscription_id: "sub_7EeHq2ewQuadropD2ra" });
    });

    it("lets a proven upgrade replace the earlier subscription", async () => {
      await deliver(
        signedRequest(
          "evt_scout",
          eventBody({
            data: { subscription_id: "sub_scout", product_id: "pdt_test_scout", metadata: await scoutMetadata() },
          }),
        ),
      );
      expect(await planRow()).toMatchObject({ tier: "scout", provider_subscription_id: "sub_scout" });

      await deliver(signedRequest("evt_upgrade", eventBody({ timestamp: "2026-10-01T00:00:00Z" })));

      expect(await planRow()).toMatchObject({ tier: "starter", provider_subscription_id: "sub_7EeHq2ewQuadropD2ra" });
    });

    it("records a deliberate downgrade bought through a new proven checkout while the old plan is still paid", async () => {
      await deliver(
        signedRequest(
          "evt_starter",
          eventBody({
            data: { cancel_at_next_billing_date: true, status: "cancelled", next_billing_date: "2099-01-01T00:00:00Z" },
          }),
        ),
      );
      expect((await planRow())?.tier).toBe("starter");

      await deliver(
        signedRequest(
          "evt_downgrade",
          eventBody({
            timestamp: "2026-10-01T00:00:00Z",
            data: { subscription_id: "sub_scout", product_id: "pdt_test_scout", metadata: await scoutMetadata() },
          }),
        ),
      );

      expect(await planRow()).toMatchObject({ tier: "scout", provider_subscription_id: "sub_scout" });
    });
  });
});
