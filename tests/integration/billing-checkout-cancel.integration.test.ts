import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { claimDodoPlanCheckout, clearDodoPlanCheckout } from "~/lib/data.server";

import { appEnv, db, seedUser } from "./fixtures";

/**
 * Issue #2259 — a free user who clicks Subscribe, gets sent to Dodo's hosted
 * checkout, then backs out never triggers a payment.failed/subscription.failed
 * webhook (those are the only paths that call clearDodoPlanCheckout). The
 * cancel loader only redirected, so the checkout_pending lock survived and the
 * user was pinned out of a new checkout for 24h (DODO_PLAN_CHECKOUT_LOCK_MINUTES).
 *
 * This runs the REAL cancel loader against the REAL D1 (built by applying the
 * repo's real migrations — no mocked binding). Auth is mocked so the loader
 * sees the seeded user; the loader's clearDodoPlanCheckout call hits the real
 * data layer, whose WHERE clause keeps it scoped to dodo_status='checkout_pending'
 * on a free plan.
 */
let seededUserId: string;

function loaderContext() {
  return { cloudflare: { env: { ...appEnv } } };
}

async function callCancelLoader(
  url = "http://localhost/api/billing/dodo/cancel?checkout_id=c1&plan=starter&cycle=monthly",
) {
  const { loader } = await import("~/routes/api.billing.dodo.cancel");
  try {
    await loader({
      context: loaderContext(),
      params: {},
      request: new Request(url),
    } as never);
    throw new Error("expected redirect");
  } catch (error) {
    return error as Response;
  }
}

describe("Dodo hosted-checkout cancel clears checkout_pending (issue #2259)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("~/lib/auth.server", async () => {
      const actual = await vi.importActual<typeof import("~/lib/auth.server")>("~/lib/auth.server");
      return {
        ...actual,
        requireSession: async () => ({
          user: { id: seededUserId, email: `${seededUserId}@example.test`, name: "Fixture" },
          expires: new Date(Date.now() + 3600_000).toISOString(),
        }),
      };
    });
  });

  afterEach(() => {
    vi.doUnmock("~/lib/auth.server");
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("lets a user who cancels hosted checkout immediately start a new checkout", async () => {
    seededUserId = await seedUser();

    // First checkout claim succeeds.
    expect(await claimDodoPlanCheckout(appEnv, { userId: seededUserId, checkoutId: "c1" })).toBe(
      true,
    );

    // A second claim while the first is still pending is refused (the lock).
    expect(await claimDodoPlanCheckout(appEnv, { userId: seededUserId, checkoutId: "c2" })).toBe(
      false,
    );

    // The user backs out on Dodo's hosted page and hits the cancel loader.
    const response = await callCancelLoader();
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toContain("checkout=cancelled");

    // The lock is cleared, so a fresh checkout can start immediately.
    expect(await claimDodoPlanCheckout(appEnv, { userId: seededUserId, checkoutId: "c2" })).toBe(
      true,
    );
  });

  it("leaves a user whose dodo_status is not checkout_pending untouched by the cancel loader", async () => {
    seededUserId = await seedUser();

    // Seed a non-pending status directly (e.g. an active subscription).
    await db()
      .prepare(
        `INSERT INTO user_plan (user_id, plan, dodo_status, plan_updated_at)
       VALUES (?, 'starter', 'active', ?)`,
      )
      .bind(seededUserId, "2026-01-01T00:00:00.000Z") // fixed-date: historical fixture (issue #3215 sweep)
      .run();

    const response = await callCancelLoader();
    expect(response.status).toBe(303);

    // The clear is scoped to dodo_status='checkout_pending', so the active
    // subscription's status is untouched.
    const row = await db()
      .prepare("SELECT dodo_status FROM user_plan WHERE user_id = ?")
      .bind(seededUserId)
      .first<{ dodo_status: string | null }>();
    expect(row?.dodo_status).toBe("active");
  });

  it("clears only the session user's checkout_pending, never another user's", async () => {
    const otherUserId = await seedUser();
    seededUserId = await seedUser();

    // The other user has a pending checkout that must survive.
    expect(await claimDodoPlanCheckout(appEnv, { userId: otherUserId, checkoutId: "other" })).toBe(
      true,
    );

    const response = await callCancelLoader();
    expect(response.status).toBe(303);

    // The session user's cancel must not clear the other user's claim.
    expect(await claimDodoPlanCheckout(appEnv, { userId: otherUserId, checkoutId: "other2" })).toBe(
      false,
    );
  });
});
