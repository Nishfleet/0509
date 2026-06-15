import { describe, expect, it } from "vitest";

import { normalizeCompetitorWebsiteInput } from "~/lib/competitor-website";

describe("normalizeCompetitorWebsiteInput", () => {
  it("accepts internationalized domains after URL punycode normalization", () => {
    const normalized = normalizeCompetitorWebsiteInput("https://пример.рф");

    expect(normalized.error).toBeNull();
    expect(normalized.host).toBe("xn--e1afmkfd.xn--p1ai");
    expect(normalized.normalizedUrl).toBe("https://xn--e1afmkfd.xn--p1ai");
  });

  it("still rejects incomplete website names without a public suffix", () => {
    const normalized = normalizeCompetitorWebsiteInput("seoitis");

    expect(normalized.error).toBe("That website looks incomplete. Add the full domain, like seoitis.com.");
    expect(normalized.normalizedUrl).toBeNull();
  });
});
