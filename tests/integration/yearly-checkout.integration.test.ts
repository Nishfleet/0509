import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import checkoutSession from "../fixtures/dodo/checkout-session-created.json";

const session = vi.hoisted(() => ({
  user: { id: "user-yearly", email: "yearly@example.com", emailVerified: true },
}));

vi.mock("../../app/lib/require-session.server", () => ({
  requireFreshSession: async () => session,
}));

import { checkoutProof } from "../../app/lib/billing/checkout-proof.server";
import { planIdForProduct } from "../../app/lib/billing/products.server";
import { action } from "../../app/routes/app.upgrade";

async function seedOwner(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES ('user-yearly', 'Yearly', 'yearly@example.com', 1, '2026-09-29T00:00:00Z', '2026-09-29T00:00:00Z')`,
  ).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES ('ws-user-yearly', 'Yearly', 'user-yearly', 'UTC', 1, 8, '2026-09-29T00:00:00Z')`,
  ).run();
}

function upgradeRequest(fields: Record<string, string>): Parameters<typeof action>[0] {
  const request = new Request("https://0509.io/app/upgrade", {
    method: "POST",
    body: new URLSearchParams(fields),
  });
  return { request, params: {}, context: {} } as unknown as Parameters<typeof action>[0];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("yearly checkout", () => {
  it("starts the yearly product with the trial and a proof for that product", async () => {
    await seedOwner();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(checkoutSession, { status: 200 }));

    const result = await action(upgradeRequest({ plan: "starter", interval: "yearly" }));

    expect((result as Response).status).toBe(302);
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      product_cart: [{ product_id: "pdt_test_starter_year", quantity: 1 }],
      subscription_data: { trial_period_days: 7 },
      metadata: {
        workspace_id: "ws-user-yearly",
        plan: "starter",
        proof: await checkoutProof("ws-user-yearly", "pdt_test_starter_year"),
      },
    });
  });

  it("keeps monthly as the default when no interval is sent", async () => {
    await seedOwner();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(checkoutSession, { status: 200 }));

    await action(upgradeRequest({ plan: "starter" }));

    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toMatchObject({
      product_cart: [{ product_id: "pdt_test_starter", quantity: 1 }],
    });
  });

  it("refuses a yearly checkout for a plan whose yearly product is not set, without calling Dodo", async () => {
    await seedOwner();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await action(upgradeRequest({ plan: "agency", interval: "yearly" }));

    expect(result).toMatchObject({ message: expect.stringContaining("isn't available") });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses an unknown interval", async () => {
    await seedOwner();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await action(upgradeRequest({ plan: "starter", interval: "weekly" }));

    expect(result).toMatchObject({ message: expect.stringContaining("isn't available") });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps a yearly product to its plan and leaves an unset one unmapped", () => {
    expect(planIdForProduct("pdt_test_scout_year")).toBe("scout");
    expect(planIdForProduct("pdt_test_starter_year")).toBe("starter");
    expect(planIdForProduct("")).toBeNull();
    expect(planIdForProduct("pdt_unknown")).toBeNull();
  });
});
