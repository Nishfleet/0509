import { describe, expect, it } from "vitest";

import { subjectRedirect } from "../../app/lib/onboarding-subject";

describe("subjectRedirect", () => {
  it("maps a plain domain to the identity card URL", () => {
    expect(subjectRedirect("acme.com")).toBe("/onboarding/identity?subject=acme.com");
  });

  it("passes a handle through with its surrounding whitespace trimmed", () => {
    expect(subjectRedirect("  @nike  ")).toBe("/onboarding/identity?subject=%40nike");
  });

  it("encodes a full URL without normalising it", () => {
    expect(subjectRedirect("https://www.youtube.com/@mkbhd")).toBe(
      "/onboarding/identity?subject=" + encodeURIComponent("https://www.youtube.com/@mkbhd"),
    );
  });

  it("redirects nonsense onward; the not-found line lives on the card", () => {
    expect(subjectRedirect("qzxv wplk 9981")).toBe("/onboarding/identity?subject=qzxv%20wplk%209981");
  });

  it("returns null for empty, whitespace-only and null input", () => {
    expect(subjectRedirect("")).toBeNull();
    expect(subjectRedirect("   ")).toBeNull();
    expect(subjectRedirect(null)).toBeNull();
  });
});
