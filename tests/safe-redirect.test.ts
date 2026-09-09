import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "~/lib/safe-redirect";

const FALLBACK = "/fallback";

describe("safeRedirectPath", () => {
  it("keeps a same-origin path", () => {
    expect(safeRedirectPath("/dashboard", FALLBACK)).toBe("/dashboard");
  });

  it("rejects scheme-relative, backslash, and absolute URLs", () => {
    expect(safeRedirectPath("//evil.com", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("/\\evil.com", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("https://evil.com", FALLBACK)).toBe(FALLBACK);
  });

  it("rejects ASCII control characters that browsers strip into //host", () => {
    expect(safeRedirectPath("/\t/evil.com", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("/\n/evil.com", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("/\r/evil.com", FALLBACK)).toBe(FALLBACK);
  });
});
