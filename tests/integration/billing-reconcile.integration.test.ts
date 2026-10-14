import { env } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { checkoutProof } from "../../app/lib/billing/checkout-proof.server";
import {
  reconcileCandidates,
  reconcileCheckoutReturn,
  reconcileSubscription,
} from "../../app/lib/billing/reconcile.server";
import subscriptionActive from "../fixtures/dodo/subscription-active.json";

const WORKSPACE = "ws-reconcile";
const NOW = new Date("2026-10-14T03:00:00Z");
let proof = "";

beforeAll(async () => {
  proof = await checkoutProof(WORKSPACE, "pdt_test_starter");
});

function dodoSubscription(overrides: Record<string, unknown> = {}) {
  return {
    ...subscriptionActive.data,
    created_at: "2026-10-13T10:00:00Z",
    metadata: { workspace_id: WORKSPACE, plan: "starter", proof },
    ...overrides,
  };
}

function dodoAnswers(sub: ReturnType<typeof dodoSubscription>) {
  const calls: { method: string; url: string }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push({ method: init?.method ?? "GET", url: `${url.pathname}${url.search}` });
    if (url.pathname === "/subscriptions") return Response.json({ items: [sub] });
    if (url.pathname === "/customers") return Response.json({ items: [{ customer_id: sub.customer.customer_id }] });
    return Response.json(sub);
  });
  return calls;
}

async function reconcileBilling(now: Date): Promise<void> {
  for (const id of await reconcileCandidates(now)) await reconcileSubscription(id);
}

const plan = () =>
  env.DB.prepare("SELECT tier, status FROM plan WHERE workspace_id = ?")
    .bind(WORKSPACE)
    .first<{ tier: string; status: string }>();

async function seedPlan(status: string, updatedAt = "2026-10-01T00:00:00Z"): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO plan (id, workspace_id, tier, status, provider_customer_id, provider_subscription_id, current_period_end, trialing, updated_at)
     VALUES ('plan-reconcile', ?1, 'starter', ?2, 'cus_8VbC6JDZzPEqfBPUdpj0K', 'sub_7EeHq2ewQuadropD2ra', '2026-10-06T10:00:00.125145Z', 0, ?3)`,
  )
    .bind(WORKSPACE, status, updatedAt)
    .run();
}

let logged: ReturnType<typeof vi.spyOn>;

describe("billing reconcile", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM plan").run();
    await env.DB.prepare("DELETE FROM workspace").run();
    await env.DB.prepare('DELETE FROM "user"').run();
    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES ('user-reconcile', 'Reconcile', 'reconcile@example.com', 1, '2026-09-29T00:00:00Z', '2026-09-29T00:00:00Z')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES (?, 'Reconcile', 'user-reconcile', 'UTC', 1, 8, '2026-09-29T00:00:00Z')`,
    )
      .bind(WORKSPACE)
      .run();
    logged = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("grants the plan when the active webhook never arrived", async () => {
    const calls = dodoAnswers(dodoSubscription());

    await reconcileBilling(NOW);

    expect(await plan()).toEqual({ tier: "starter", status: "active" });
    expect(JSON.stringify(logged.mock.calls)).toContain("billing.reconcile_corrected");
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("ends access when the on_hold webhook never arrived", async () => {
    await seedPlan("active");
    dodoAnswers(dodoSubscription({ status: "on_hold" }));

    await reconcileBilling(NOW);

    expect((await plan())?.status).toBe("on_hold");
  });

  it("restores access when the re-activation webhook never arrived", async () => {
    await seedPlan("on_hold");
    dodoAnswers(dodoSubscription());

    await reconcileBilling(NOW);

    expect((await plan())?.status).toBe("active");
  });

  it("changes nothing and stays quiet when the plan already matches Dodo", async () => {
    await seedPlan("active");
    dodoAnswers(dodoSubscription());

    await reconcileBilling(NOW);

    expect(JSON.stringify(logged.mock.calls)).not.toContain("reconcile_corrected");
  });

  it("repairs a pending row whose active webhook was lost, even though the row is newer than the subscription", async () => {
    await seedPlan("pending", "2026-10-13T12:00:00Z");
    dodoAnswers(dodoSubscription());

    await reconcileCheckoutReturn(WORKSPACE, "reconcile@example.com");

    expect((await plan())?.status).toBe("active");
  });

  it("restores a recently cancelled plan that Dodo has reactivated", async () => {
    await seedPlan("cancelled", "2026-10-10T00:00:00Z");
    dodoAnswers(dodoSubscription());

    await reconcileBilling(NOW);

    expect((await plan())?.status).toBe("active");
  });

  it("leaves a plan that already matches Dodo untouched, so its timestamp never moves", async () => {
    await seedPlan("active", "2026-10-12T00:00:00Z");
    dodoAnswers(dodoSubscription());

    await reconcileBilling(NOW);

    const row = await env.DB.prepare("SELECT updated_at FROM plan WHERE workspace_id = ?")
      .bind(WORKSPACE)
      .first<{ updated_at: string }>();
    expect(row?.updated_at).toBe("2026-10-12T00:00:00Z");
  });

  it("finds a missed subscription from the customer's email on checkout return", async () => {
    dodoAnswers(dodoSubscription());

    await reconcileCheckoutReturn(WORKSPACE, "reconcile@example.com");

    expect(await plan()).toEqual({ tier: "starter", status: "active" });
  });

  it("does not call Dodo on checkout return when the workspace is already paid", async () => {
    await seedPlan("active");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await reconcileCheckoutReturn(WORKSPACE, "reconcile@example.com");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("asks Dodo at most five times a minute for one workspace", async () => {
    await seedPlan("failed");
    const calls = dodoAnswers(dodoSubscription({ status: "failed" }));

    for (let attempt = 0; attempt < 8; attempt += 1) await reconcileCheckoutReturn(WORKSPACE, "reconcile@example.com");

    const lookups = calls.filter((call) => call.url.startsWith("/customers")).length;
    expect(lookups).toBeGreaterThan(0);
    expect(lookups).toBeLessThanOrEqual(5);
  });

  it("raises no correction when a recent subscription is older than the plan the workspace already holds", async () => {
    await seedPlan("active", "2026-10-13T12:00:00Z");
    await env.DB.prepare("UPDATE plan SET provider_subscription_id = 'sub_current' WHERE workspace_id = ?")
      .bind(WORKSPACE)
      .run();
    dodoAnswers(dodoSubscription());

    await reconcileBilling(NOW);

    expect(JSON.stringify(logged.mock.calls)).not.toContain("reconcile_corrected");
    const row = await env.DB.prepare("SELECT provider_subscription_id AS id FROM plan WHERE workspace_id = ?")
      .bind(WORKSPACE)
      .first<{ id: string }>();
    expect(row?.id).toBe("sub_current");
  });

  it("corrects a known plan without moving its timestamp, so a later webhook for another subscription still wins", async () => {
    await seedPlan("active");
    dodoAnswers(dodoSubscription({ status: "on_hold" }));

    await reconcileBilling(NOW);

    const row = await env.DB.prepare("SELECT status, updated_at AS at FROM plan WHERE workspace_id = ?")
      .bind(WORKSPACE)
      .first<{ status: string; at: string }>();
    expect(row).toEqual({ status: "on_hold", at: "2026-10-01T00:00:00Z" });
  });

  it("leaves a plan alone when a webhook updated it while Dodo was being asked", async () => {
    await seedPlan("active");
    const sub = dodoSubscription({ status: "on_hold" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/subscriptions") return Response.json({ items: [sub] });
      await env.DB.prepare("UPDATE plan SET updated_at = '2026-10-14T02:59:00Z' WHERE workspace_id = ?")
        .bind(WORKSPACE)
        .run();
      return Response.json(sub);
    });

    await reconcileBilling(NOW);

    const row = await env.DB.prepare("SELECT status, updated_at AS at FROM plan WHERE workspace_id = ?")
      .bind(WORKSPACE)
      .first<{ status: string; at: string }>();
    expect(row).toEqual({ status: "active", at: "2026-10-14T02:59:00Z" });
  });

  it("still corrects a known plan when Dodo returns no metadata", async () => {
    await seedPlan("active");
    dodoAnswers(dodoSubscription({ status: "on_hold", metadata: null }));

    await reconcileBilling(NOW);

    expect((await plan())?.status).toBe("on_hold");
  });

  it("ignores a subscription whose proof was not made for this workspace", async () => {
    dodoAnswers(dodoSubscription({ metadata: { workspace_id: WORKSPACE, plan: "starter", proof: "forged" } }));

    await reconcileBilling(NOW);

    expect(await plan()).toBeNull();
  });

  it("raises, and leaves the plan alone, when every call to Dodo fails", async () => {
    await seedPlan("active");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ message: "down" }, { status: 500 }));

    await expect(reconcileBilling(NOW)).rejects.toThrow();
    expect((await plan())?.status).toBe("active");
  });
});
