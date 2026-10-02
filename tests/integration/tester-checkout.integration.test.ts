import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import checkoutSession from "../fixtures/dodo/checkout-session-created.json";

const session = vi.hoisted(() => ({ user: { id: "user-tester", email: "Tester@Example.com" } }));

vi.mock("../../app/lib/require-session.server", () => ({
  requireFreshSession: async () => session,
}));

import { checkoutProof } from "../../app/lib/billing/checkout-proof.server";
import { planIdForProduct } from "../../app/lib/billing/products.server";
import { loader } from "../../app/routes/app.tester";

async function seedOwner(id: string, email: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, 'Tester', ?, 1, '2026-09-29T00:00:00Z', '2026-09-29T00:00:00Z')`,
  )
    .bind(id, email)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'Tester', ?, 'UTC', 1, 8, '2026-09-29T00:00:00Z')`,
  )
    .bind(`ws-${id}`, id)
    .run();
}

function testerRequest(): Parameters<typeof loader>[0] {
  const request = new Request("https://0509.io/app/tester");
  return { request, params: {}, context: {} } as unknown as Parameters<typeof loader>[0];
}

afterEach(() => {
  vi.restoreAllMocks();
  session.user = { id: "user-tester", email: "Tester@Example.com" };
});

describe("tester checkout", () => {
  it("starts the unpriced tester product for an allowlisted email, with no trial", async () => {
    await seedOwner("user-tester", "tester@example.com");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(checkoutSession, { status: 200 }));

    const result = await loader(testerRequest());

    expect((result as Response).status).toBe(302);
    expect((result as Response).headers.get("Location")).toBe(checkoutSession.checkout_url);
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      product_cart: [{ product_id: "pdt_test_tester", quantity: 1 }],
      metadata: {
        workspace_id: "ws-user-tester",
        plan: "starter",
        proof: await checkoutProof("ws-user-tester", "pdt_test_tester"),
      },
    });
    expect(body).not.toHaveProperty("subscription_data");
  });

  it("answers 404 for anyone not on the list and never calls Dodo", async () => {
    session.user = { id: "user-other", email: "other@example.com" };
    await seedOwner("user-other", "other@example.com");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(loader(testerRequest())).rejects.toMatchObject({ status: 404 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a workspace that already has a paid plan and never calls Dodo", async () => {
    await seedOwner("user-tester", "tester@example.com");
    await env.DB.prepare(
      `INSERT OR REPLACE INTO plan (id, workspace_id, tier, status, provider_customer_id, provider_subscription_id, current_period_end, updated_at)
       VALUES ('plan-paid', 'ws-user-tester', 'agency', 'active', 'cus_paid', 'sub_paid', '2099-01-01T00:00:00Z', '2026-09-30T00:00:00Z')`,
    ).run();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(loader(testerRequest())).rejects.toMatchObject({ status: 409 });
    expect(fetchSpy).not.toHaveBeenCalled();
    await env.DB.prepare("DELETE FROM plan WHERE workspace_id = 'ws-user-tester'").run();
  });

  it("gives the tester product the Starter plan", () => {
    expect(planIdForProduct("pdt_test_tester")).toBe("starter");
  });
});
