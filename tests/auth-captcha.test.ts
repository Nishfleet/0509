import { describe, expect, it } from "vitest";

import { captchaApplies } from "../app/lib/auth-captcha";

describe("captchaApplies", () => {
  it("skips the Turnstile verify only on the exact value the offline local lane sets", () => {
    expect(captchaApplies("off")).toBe(false);
  });

  it("keeps the verify on for every other value, unset and blank included", () => {
    expect(captchaApplies("on")).toBe(true);
    expect(captchaApplies(undefined)).toBe(true);
    expect(captchaApplies("")).toBe(true);
    expect(captchaApplies("OFF")).toBe(true);
    expect(captchaApplies(false)).toBe(true);
  });
});
