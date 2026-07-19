import { describe, expect, it } from "vitest";

import {
  billingCanaryLockBelongsToUser,
  billingCanaryLockPrefixForUser,
  buildBillingCanaryLockId,
} from "~/lib/billing-canary-lock";

describe("billing canary lock identity", () => {
  it("normalizes one shared user-scoped lock contract", () => {
    expect(billingCanaryLockPrefixForUser(" User_1 ")).toBe("billing-canary-lock:user-1:");
    expect(buildBillingCanaryLockId(" User_1 ", "ABC/123")).toBe(
      "billing-canary-lock:user-1:abc-123",
    );
    expect(buildBillingCanaryLockId("", "")).toBe("billing-canary-lock:unknown:unknown");
  });

  it("rejects missing and foreign-user lock identities", () => {
    expect(billingCanaryLockBelongsToUser("billing-canary-lock:user-1:nonce", "user-1"))
      .toBe(true);
    expect(billingCanaryLockBelongsToUser("billing-canary-lock:user-10:nonce", "user-1"))
      .toBe(false);
    expect(billingCanaryLockBelongsToUser(null, "user-1")).toBe(false);
  });
});
