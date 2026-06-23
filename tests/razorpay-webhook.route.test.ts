import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("Razorpay webhook route", () => {
  it("is hard-disabled and does not mutate billing state", async () => {
    const { action } = await import("~/routes/api.webhooks.razorpay");
    const response = await action({
      context: {},
      request: new Request("https://0509.io/api/webhooks/razorpay", {
        method: "POST",
        body: "{}",
      }),
    } as never);

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      disabled: true,
      reason: "razorpay_retired",
    });
  });
});
