import { describe, expect, it } from "vitest";

import { subjectRedirect } from "../../app/lib/onboarding-subject";

describe("subjectRedirect", () => {
  it("passes a plain domain through", () => {
    expect(subjectRedirect("acme.com")).toBe("/onboarding/identity?subject=acme.com");
  });

  it("encodes the raw value without stripping the @", () => {
    expect(subjectRedirect("  @nike  ")).toBe("/onboarding/identity?subject=%40nike");
  });

  it("encodes a full URL without stripping the scheme", () => {
    expect(subjectRedirect("https://www.youtube.com/@mkbhd")).toBe(
      "/onboarding/identity?subject=" + encodeURIComponent("https://www.youtube.com/@mkbhd"),
    );
  });

  it("redirects nonsense; the not-found line lives on the card", () => {
    expect(subjectRedirect("qzxv wplk 9981")).toBe(
      "/onboarding/identity?subject=qzxv%20wplk%209981",
    );
  });

  it("returns null for empty, whitespace and missing input", () => {
    expect(subjectRedirect("")).toBeNull();
    expect(subjectRedirect("   ")).toBeNull();
    expect(subjectRedirect(null)).toBeNull();
  });
});
