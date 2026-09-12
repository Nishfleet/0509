// Unit tests for the Dodo in-app cancel helper (issue #3168).
// Asserts that:
//   * A subscription that already carries cancel_at_next_billing_date=true
//     reports already_scheduled without a duplicate /cancel call.
//   * A live subscription triggers the dedicated /cancel endpoint with
//     `cancel_at_next_billing_date: true`.
//   * The fallback PATCH path kicks in when Dodo returns 404 / 405 on the
//     dedicated endpoint (the test simulates that to prove the resilience).
//   * A read failure becomes source='error' so the route can render a
//     friendly retry notice.
//
// The integration sweep test covers the DB side; this file covers the
// network-shape contract the in-app cancel depends on.

import { describe, expect, it, vi } from "vitest";

import { scheduleDodoSubscriptionCancellationImpl } from "~/lib/dodo-billing.server";

type AppEnv = Parameters<typeof scheduleDodoSubscriptionCancellationImpl>[0];

function envWithKey(): AppEnv {
  return {
    DODO_PAYMENTS_API_KEY: "test_dodo_key",
    DODO_0509_ENVIRONMENT: "test",
  } as never;
}

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("scheduleDodoSubscriptionCancellationImpl", () => {
  it("returns already_scheduled when the subscription already has cancel_at_next_billing_date=true", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input : (input as Request).url;
      if (url.toString().includes("/subscriptions/sub_123") && !url.toString().endsWith("/cancel")) {
        return makeResponse({
          subscription_id: "sub_123",
          product_id: "prod_abc",
          status: "subscription.active",
          cancel_at_next_billing_date: true,
        });
      }
      // The dedicated /cancel endpoint should NOT be called for an
      // already-scheduled subscription.
      throw new Error(`Unexpected call: ${url}`);
    });

    const outcome = await scheduleDodoSubscriptionCancellationImpl(envWithKey(), {
      fetcher: fetchMock as unknown as typeof fetch,
      subscriptionId: "sub_123",
    });

    expect(outcome.cancellationScheduled).toBe(true);
    expect(outcome.source).toBe("already_scheduled");
    expect(outcome.dodoStatus).toBe("subscription.active");
    // The fetch mock would have thrown for any unexpected URL — passes
    // only because we never reached a second call.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("calls the dedicated /cancel endpoint with cancel_at_next_billing_date=true", async () => {
    let cancelBody: unknown;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input : (input as Request).url;
      if (url.toString().includes("/subscriptions/sub_456") && !url.toString().endsWith("/cancel")) {
        return makeResponse({
          subscription_id: "sub_456",
          product_id: "prod_abc",
          status: "subscription.active",
          cancel_at_next_billing_date: false,
        });
      }
      if (url.toString().endsWith("/cancel")) {
        cancelBody = init?.body ? JSON.parse(String(init.body)) : null;
        return makeResponse({ ok: true });
      }
      throw new Error(`Unexpected call: ${url}`);
    });

    const outcome = await scheduleDodoSubscriptionCancellationImpl(envWithKey(), {
      fetcher: fetchMock as unknown as typeof fetch,
      subscriptionId: "sub_456",
    });

    expect(outcome.cancellationScheduled).toBe(true);
    expect(outcome.source).toBe("dodo_api");
    expect(outcome.dodoStatus).toBe("subscription.active");
    expect(cancelBody).toEqual({ cancel_at_next_billing_date: true });
    // GET subscription + POST cancel.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to PATCH when the dedicated endpoint returns 404", async () => {
    let patchBody: unknown;
    let patchCalled = false;
    let getCalled = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input : (input as Request).url;
      // Same URL serves GET (initial state) and PATCH (fallback).
      if (url.toString().endsWith("/subscriptions/sub_789") && init?.method === "GET") {
        getCalled = true;
        return makeResponse({
          subscription_id: "sub_789",
          product_id: "prod_abc",
          status: "subscription.active",
          cancel_at_next_billing_date: false,
        });
      }
      if (url.toString().endsWith("/cancel")) {
        return makeResponse({ error: "not found" }, 404);
      }
      if (url.toString().endsWith("/subscriptions/sub_789") && init?.method === "PATCH") {
        patchCalled = true;
        patchBody = init?.body ? JSON.parse(String(init.body)) : null;
        return makeResponse({ ok: true });
      }
      throw new Error(`Unexpected call: ${url} method=${init?.method ?? "<none>"}`);
    });

    const outcome = await scheduleDodoSubscriptionCancellationImpl(envWithKey(), {
      fetcher: fetchMock as unknown as typeof fetch,
      subscriptionId: "sub_789",
    });

    expect(outcome.cancellationScheduled).toBe(true);
    expect(outcome.source).toBe("dodo_api");
    expect(getCalled).toBe(true);
    expect(patchCalled).toBe(true);
    expect(patchBody).toEqual({ cancel_at_next_billing_date: true });
  });

  it("returns source=error on a non-404 / 5xx GET", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return makeResponse({ error: "boom" }, 502);
    });

    const outcome = await scheduleDodoSubscriptionCancellationImpl(envWithKey(), {
      fetcher: fetchMock as unknown as typeof fetch,
      subscriptionId: "sub_000",
    });

    expect(outcome.cancellationScheduled).toBe(false);
    expect(outcome.source).toBe("error");
    expect(outcome.message).toMatch(/502/);
  });

  it("returns no_active_subscription for a blank subscription id", async () => {
    const outcome = await scheduleDodoSubscriptionCancellationImpl(envWithKey(), {
      fetcher: vi.fn() as unknown as typeof fetch,
      subscriptionId: "  ",
    });

    expect(outcome.source).toBe("no_active_subscription");
    expect(outcome.cancellationScheduled).toBe(false);
  });

  it("returns source=error when DODO_PAYMENTS_API_KEY is missing", async () => {
    const outcome = await scheduleDodoSubscriptionCancellationImpl(
      { DODO_0509_ENVIRONMENT: "test" } as never,
      { fetcher: vi.fn() as unknown as typeof fetch, subscriptionId: "sub_x" },
    );

    expect(outcome.source).toBe("error");
    expect(outcome.message).toMatch(/key/i);
  });
});