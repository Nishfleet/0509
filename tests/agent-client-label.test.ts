import { describe, expect, it } from "vitest";

import { claimedNameFor } from "../app/lib/agent/client-label";

describe("the name an app calls itself", () => {
  it("keeps a plain name", () => {
    expect(claimedNameFor("  Claude  ")).toBe("Claude");
  });

  it.each([undefined, "", "   ", "\u0000​\n"])("has no name for %j", (input) => {
    expect(claimedNameFor(input)).toBeNull();
  });

  it("flattens line breaks and control characters", () => {
    expect(claimedNameFor("Five\nto‮Nine")).toBe("Five to Nine");
  });

  it("cuts a long name to 40 characters", () => {
    const cut = claimedNameFor("a".repeat(200));
    expect(Array.from(new Intl.Segmenter().segment(cut ?? ""))).toHaveLength(40);
    expect(cut?.endsWith("…")).toBe(true);
  });
});
