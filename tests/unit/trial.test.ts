import { describe, expect, it } from "vitest";

import { isTrialing } from "../../app/lib/billing/trial";

const created = "2026-09-29T10:00:00.000Z";

describe("isTrialing", () => {
  it("is true while the next billing date is the end of the trial", () => {
    expect(isTrialing({ createdAt: created, nextBillingDate: "2026-10-06T10:00:00.000Z", trialDays: 7 })).toBe(true);
  });

  it("is false once the next billing date is a later cycle", () => {
    expect(isTrialing({ createdAt: created, nextBillingDate: "2026-11-06T10:00:00.000Z", trialDays: 7 })).toBe(false);
  });

  it("is false without a trial or without dates", () => {
    expect(isTrialing({ createdAt: created, nextBillingDate: "2026-10-06T10:00:00.000Z", trialDays: 0 })).toBe(false);
    expect(isTrialing({ createdAt: created, nextBillingDate: "2026-10-06T10:00:00.000Z", trialDays: undefined })).toBe(
      false,
    );
    expect(isTrialing({ createdAt: undefined, nextBillingDate: "2026-10-06T10:00:00.000Z", trialDays: 7 })).toBe(false);
    expect(isTrialing({ createdAt: created, nextBillingDate: null, trialDays: 7 })).toBe(false);
  });
});
