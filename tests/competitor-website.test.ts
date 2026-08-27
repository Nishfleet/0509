import { describe, expect, it } from "vitest";

import { normalizeCompetitorWebsiteInput } from "~/lib/competitor-website";

describe("normalizeCompetitorWebsiteInput", () => {
  it("uses explicit public brand names for stylised domains", () => {
    const cases = [
      { input: "hm.com", displayName: "H&M", bad: "Hm" },
      { input: "ouraring.com", displayName: "Oura", bad: "Ouraring" },
      { input: "bombayshavingcompany.com", displayName: "Bombay Shaving Company", bad: "Bombayshavingcompany" },
      { input: "mcaffeine.com", displayName: "mCaffeine", bad: "Mcaffeine" },
      { input: "sugarcosmetics.com", displayName: "Sugar Cosmetics", bad: "Sugarcosmetics" },
      { input: "asos.com", displayName: "ASOS", bad: "Asos" },
      { input: "hubspot.com", displayName: "HubSpot", bad: "Hubspot" },
      { input: "ridgewallet.com", displayName: "Ridge Wallet", bad: "Ridgewallet" },
    ];

    for (const { input, displayName, bad } of cases) {
      const result = normalizeCompetitorWebsiteInput(input);
      expect(result.displayName).toBe(displayName);
      expect(result.displayName).not.toBe(bad);
      expect(result.host).toBe(input);
    }
  });

  it("accepts internationalized domains after URL punycode normalization", () => {
    const normalized = normalizeCompetitorWebsiteInput("https://пример.рф");

    expect(normalized.error).toBeNull();
    expect(normalized.host).toBe("xn--e1afmkfd.xn--p1ai");
    expect(normalized.normalizedUrl).toBe("https://xn--e1afmkfd.xn--p1ai");
  });

  it("still rejects incomplete website names without a public suffix", () => {
    const normalized = normalizeCompetitorWebsiteInput("samplebrand");

    expect(normalized.error).toBe("That website looks incomplete. Add the full domain, like brand.com.");
    expect(normalized.normalizedUrl).toBeNull();
  });
});
