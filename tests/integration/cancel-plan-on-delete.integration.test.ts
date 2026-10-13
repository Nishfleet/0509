import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cancelPlanForDelete } from "../../app/lib/billing/cancel.server";
import { upsertSubscriptionPlan } from "../../app/lib/data/plan.server";

async function seedWorkspace(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, 'Leaver', ?, 1, '2026-10-13T00:00:00Z', '2026-10-13T00:00:00Z')`,
  )
    .bind(`user-${id}`, `${id}@example.com`)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'Leaver', ?, 'UTC', 1, 8, '2026-10-13T00:00:00Z')`,
  )
    .bind(id, `user-${id}`)
    .run();
}

async function seedPlan(workspaceId: string, status: string): Promise<void> {
  await seedWorkspace(workspaceId);
  await upsertSubscriptionPlan({
    workspaceId,
    tier: "starter",
    status,
    customerId: `cus_${workspaceId}`,
    subscriptionId: `sub_${workspaceId}`,
    currentPeriodEnd: "2026-11-13T00:00:00Z",
    trialing: false,
    updatedAt: "2026-10-13T00:00:00Z",
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cancelling the plan when an account is deleted", () => {
  it("asks Dodo to cancel a live subscription and lets the delete go ahead", async () => {
    await seedPlan("ws-leave-live", "active");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({}, { status: 200 }));

    expect(await cancelPlanForDelete("ws-leave-live")).toBe(true);

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://test.dodopayments.com/subscriptions/sub_ws-leave-live");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toMatchObject({ status: "cancelled" });
  });

  it("stops the delete when Dodo refuses, so the customer is never left paying for nothing", async () => {
    await seedPlan("ws-leave-refused", "active");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ message: "no" }, { status: 500 }));

    expect(await cancelPlanForDelete("ws-leave-refused")).toBe(false);
  });

  it("does not call Dodo for a plan that already ended or a workspace that never paid", async () => {
    await seedPlan("ws-leave-ended", "cancelled");
    await seedWorkspace("ws-leave-free");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(await cancelPlanForDelete("ws-leave-ended")).toBe(true);
    expect(await cancelPlanForDelete("ws-leave-free")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
