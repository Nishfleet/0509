import { describe, expect, it } from "vitest";

import { evaluateSneakerResaleRecall, seedListDomains } from "~/lib/sneaker-resale-recall.server";

describe("sneaker-resale seed-list recall (issue #1945, app-side)", () => {
  it("reads every seed-list domain once, canonicalized", () => {
    const domains = seedListDomains();
    expect(domains.length).toBeGreaterThan(20);
    expect(new Set(domains).size).toBe(domains.length);
    expect(domains).toContain("nike.com");
  });

  it("counts a brand as covered only with a verified or likely row", () => {
    const tiers = new Map([
      ["nike.com", { verifiedCount: 2, likelyCount: 0 }],
      ["adidas.com", { verifiedCount: 0, likelyCount: 1 }],
      ["puma.com", { verifiedCount: 0, likelyCount: 0 }],
    ]);
    const result = evaluateSneakerResaleRecall(["nike.com", "adidas.com", "puma.com", "asics.com"], tiers);
    expect(result).toEqual({ checked: 4, covered: ["nike.com", "adidas.com"], missing: ["puma.com", "asics.com"] });
  });
});
