import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import checkoutSession from "../fixtures/dodo/checkout-session-created.json";

vi.mock("../../app/lib/require-session.server", () => ({
  requireFreshSession: async () => ({ user: { id: "user-upgrade", email: "upgrade@example.com" } }),
}));

import { action } from "../../app/routes/app.upgrade";

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
  return { request, params: {}, context: {} } as unknown as Parameters<typeof action>[0];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("upgrade checkout (J13)", () => {
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
      metadata: { workspace_id: "ws-upgrade", plan: "starter" },
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
