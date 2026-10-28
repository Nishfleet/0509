import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";

import { checkoutProof } from "../../app/lib/billing/checkout-proof.server";
import checkoutSession from "../fixtures/dodo/checkout-session-created.json";
import { onboardedContext } from "../../app/lib/require-onboarded.server";
import { action, loader } from "../../app/routes/app.upgrade";

async function seedOwner(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES ('user-upgrade', 'Upgrade', 'upgrade@example.com', 1, '2026-09-29T00:00:00Z', '2026-09-29T00:00:00Z')`,
  ).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES ('ws-upgrade', 'Upgrade', 'user-upgrade', 'UTC', 1, 8, '2026-09-29T00:00:00Z')`,
  ).run();
}

function upgradeRequest(plan: string): Parameters<typeof action>[0] {
  const body = new URLSearchParams({ plan });
  const request = new Request("https://0509.io/app/upgrade", { method: "POST", body });
  const context = new RouterContextProvider();
  context.set(onboardedContext, {
    session: { user: { id: "user-upgrade", email: "upgrade@example.com" } },
    workspaceId: "ws-upgrade",
  } as never);
  return { request, params: {}, context } as unknown as Parameters<typeof action>[0];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("upgrade checkout (J13)", () => {
  it("sends a plain visit to the upgrade link back to Settings", () => {
    const result = loader();

    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("/app/settings");
  });

  it("creates a Dodo test-mode checkout session for the plan and redirects to its url", async () => {
    await seedOwner();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(checkoutSession, { status: 200 }));

    const result = await action(upgradeRequest("starter"));

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(302);
    expect((result as Response).headers.get("Location")).toBe(checkoutSession.checkout_url);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://test.dodopayments.com/checkouts");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key-not-a-dodo-key");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      product_cart: [{ product_id: "pdt_test_starter", quantity: 1 }],
      customer: { email: "upgrade@example.com" },
      subscription_data: { trial_period_days: 7 },
      metadata: {
        workspace_id: "ws-upgrade",
        plan: "starter",
        proof: await checkoutProof("ws-upgrade", "pdt_test_starter"),
      },
      return_url: "https://0509.io/app/competitors?upgraded=starter",
    });
  });

  it("refuses a plan that is not in the ledger without calling Dodo", async () => {
    await seedOwner();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await action(upgradeRequest("platinum"));

    expect(result).toMatchObject({ message: expect.stringContaining("isn't available") });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("upgrade checkout when Dodo refuses (J13)", () => {
  it("answers the friendly line and never the raw error", async () => {
    await seedOwner();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ message: "invalid key for upgrade@example.com" }, { status: 401 }),
    );

    const result = await action(upgradeRequest("starter"));

    expect(result).toEqual({ message: "Upgrading isn't available right now. Try again in a few minutes." });
    expect(JSON.stringify(logged.mock.calls)).not.toContain("upgrade@example.com");
  });
});

describe("upgrade checkout when the workspace already has a plan (#7228)", () => {
  async function seedPlan(status: string, periodEnd: string | null): Promise<void> {
    await seedOwner();
    await env.DB.prepare("DELETE FROM plan WHERE workspace_id = 'ws-upgrade'").run();
    await env.DB.prepare(
      `INSERT INTO plan (id, workspace_id, tier, status, current_period_end, updated_at)
       VALUES ('plan-upgrade', 'ws-upgrade', 'scout', ?1, ?2, '2026-09-29T00:00:00Z')`,
    )
      .bind(status, periodEnd)
      .run();
  }

  it("starts no second checkout for an active plan", async () => {
    await seedPlan("active", "2099-01-01T00:00:00Z");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await action(upgradeRequest("starter"));

    expect(result).toEqual({
      message: "You can't switch plans right now. Use Manage or cancel plan on this page.",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("tells a customer who posts the plan they are on that they already have it", async () => {
    await seedPlan("active", "2099-01-01T00:00:00Z");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await action(upgradeRequest("scout"));

    expect(result).toEqual({ message: "You are already on this plan." });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still checks out for a cancelled plan past its period end", async () => {
    await seedPlan("cancelled", "2020-01-01T00:00:00Z");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(checkoutSession, { status: 200 }));

    const result = await action(upgradeRequest("starter"));

    expect((result as Response).headers.get("Location")).toBe(checkoutSession.checkout_url);
  });

  async function checkoutBodyAfterLookup(
    status: string,
    productOnFile: string | null | 404,
  ): Promise<Record<string, unknown> | undefined> {
    await seedPlan(status, "2020-01-01T00:00:00Z");
    await env.DB.prepare(
      "UPDATE plan SET provider_subscription_id = 'sub_before' WHERE workspace_id = 'ws-upgrade'",
    ).run();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input) =>
        Promise.resolve(
          String(input).includes("/subscriptions/")
            ? productOnFile === null
              ? new Response("boom", { status: 500 })
              : productOnFile === 404
                ? new Response("gone", { status: 404 })
                : Response.json({ product_id: productOnFile })
            : Response.json(checkoutSession, { status: 200 }),
        ),
      );
    await action(upgradeRequest("starter"));
    const call = fetchSpy.mock.calls.find(([url]) => String(url).endsWith("/checkouts"));
    return call === undefined ? undefined : (JSON.parse(String(call[1]?.body)) as Record<string, unknown>);
  }

  it("gives a returning customer no second free trial", async () => {
    expect(await checkoutBodyAfterLookup("cancelled", "pdt_test_starter")).not.toHaveProperty("subscription_data");
  });

  it("still gives the trial to a workspace whose only subscription was the free Tester one", async () => {
    expect(await checkoutBodyAfterLookup("cancelled", env.DODO_PRODUCT_TESTER)).toMatchObject({
      subscription_data: { trial_period_days: 7 },
    });
  });

  it("still gives the trial when the first checkout failed before it began", async () => {
    expect(await checkoutBodyAfterLookup("failed", "pdt_test_starter")).toMatchObject({
      subscription_data: { trial_period_days: 7 },
    });
  });

  it("starts no checkout when Dodo cannot say whether the customer paid before", async () => {
    expect(await checkoutBodyAfterLookup("cancelled", null)).toBeUndefined();
  });

  it("treats a subscription Dodo no longer has as a paid one, so the customer is not stuck", async () => {
    expect(await checkoutBodyAfterLookup("cancelled", 404)).not.toHaveProperty("subscription_data");
  });
});

describe("switching plans for a paying customer", () => {
  async function seedBilled(overrides: { tier?: string; status?: string; trialing?: number } = {}): Promise<void> {
    await seedOwner();
    await env.DB.prepare("DELETE FROM plan WHERE workspace_id = 'ws-upgrade'").run();
    await env.DB.prepare(
      `INSERT INTO plan (id, workspace_id, tier, status, current_period_end, trialing, provider_customer_id, provider_subscription_id, updated_at)
       VALUES ('plan-upgrade', 'ws-upgrade', ?1, ?2, '2099-01-01T00:00:00Z', ?3, 'cus_switch', 'sub_switch', '2026-09-29T00:00:00Z')`,
    )
      .bind(overrides.tier ?? "scout", overrides.status ?? "active", overrides.trialing ?? 0)
      .run();
  }

  it("asks Dodo to change the subscription now, charging the difference, and sends the customer to the plan check", async () => {
    await seedBilled();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({}, { status: 200 }));

    const result = await action(upgradeRequest("starter"));

    expect((result as Response).status).toBe(302);
    expect((result as Response).headers.get("Location")).toBe("/app/competitors?upgraded=starter");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://test.dodopayments.com/subscriptions/sub_switch/change-plan");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      product_id: "pdt_test_starter",
      quantity: 1,
      proration_billing_mode: "prorated_immediately",
      effective_at: "immediately",
      on_payment_failure: "prevent_change",
    });
  });

  it("changes nothing and says so when Dodo refuses, without leaking the raw error", async () => {
    await seedBilled();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ message: "card declined for upgrade@example.com" }, { status: 422 }),
    );

    const result = await action(upgradeRequest("starter"));

    expect(result).toEqual({
      message: "We couldn't confirm your plan change. Check your plan here in a few minutes before trying again.",
    });
    expect(JSON.stringify(logged.mock.calls)).not.toContain("upgrade@example.com");
    expect(JSON.stringify(logged.mock.calls)).toContain("billing.change_plan_failed");
    const plan = await env.DB.prepare("SELECT tier FROM plan WHERE workspace_id = 'ws-upgrade'").first<{
      tier: string;
    }>();
    expect(plan?.tier).toBe("scout");
  });

  it.each([
    ["a plan on a free trial", { trialing: 1 }, "starter"],
    ["a downgrade", { tier: "starter" }, "scout"],
    ["a payment that is overdue", { status: "past_due" }, "starter"],
  ])("never calls Dodo for %s", async (_label, overrides, target) => {
    await seedBilled(overrides);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await action(upgradeRequest(target));

    expect(result).toMatchObject({ message: expect.stringContaining("can't switch") });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
