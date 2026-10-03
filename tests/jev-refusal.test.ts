import { describe, expect, it } from "vitest";

import { isBillingRefusal } from "../app/lib/jev/refusal";

describe("isBillingRefusal", () => {
  it("matches a Jev payment error code", () => {
    expect(isBillingRefusal(new Error("jev unavailable: 2021: Payment error"))).toBe(true);
  });

  it("matches an HTTP 402", () => {
    expect(isBillingRefusal(new Error("HTTP 402"))).toBe(true);
  });

  it("matches an insufficient funds string", () => {
    expect(isBillingRefusal("insufficient funds")).toBe(true);
  });

  it("matches an AI Gateway credit exhaustion", () => {
    expect(isBillingRefusal("AI Gateway credits exhausted")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(isBillingRefusal("PAYMENT required")).toBe(true);
  });

  it("does not match an HTTP code with a trailing digit", () => {
    expect(isBillingRefusal("HTTP 4021")).toBe(false);
  });

  it("does not match a code embedded in a longer number", () => {
    expect(isBillingRefusal("HTTP 12021")).toBe(false);
  });

  it("does not match a timeout", () => {
    expect(isBillingRefusal(new Error("timed out"))).toBe(false);
  });

  it("does not match undefined", () => {
    expect(isBillingRefusal(undefined)).toBe(false);
  });
});
