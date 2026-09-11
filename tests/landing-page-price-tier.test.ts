import { describe, it, expect } from "vitest";
import { extractPriceTier, parsePriceToEur } from "~/lib/landing-page-price-tier.server";

describe("landing-page-price-tier", () => {
  describe("unrecognised-currency markers (case-insensitive)", () => {
    it("does not treat a lowercase-coded foreign price as EUR", () => {
      // "Rs 1,999" / "INR 499" must not fall through to the assume-EUR branch.
      expect(extractPriceTier("Rs 1,999")).toBe("unknown");
      expect(extractPriceTier("INR 499")).toBe("unknown");
    });

    it.each([
      ["$199", "100_to_250"],
      ["USD 199", "100_to_250"],
      ["EUR 199", "100_to_250"],
      ["\u20ac199", "100_to_250"],
      ["GBP 199", "100_to_250"],
      ["\u00a3199", "100_to_250"],
      ["199", "100_to_250"],
      ["", "unknown"],
      ["free", "unknown"],
      ["\u20b91999", "unknown"],
      ["\u00a51999", "unknown"],
      ["Rs.1999", "unknown"],
      ["Rs 1999", "unknown"],
      ["RS 1999", "unknown"],
      ["JPY 1999", "unknown"],
      ["CNY 1999", "unknown"],
      ["AUD 1999", "unknown"],
      ["CAD 1999", "unknown"],
      ["CHF 1999", "unknown"],
      ["SEK 1999", "unknown"],
      ["NOK 1999", "unknown"],
      ["DKK 1999", "unknown"],
      ["RUB 1999", "unknown"],
      ["KRW 1999", "unknown"],
      ["inr 1999", "unknown"],
      ["jpy 1999", "unknown"],
      ["cny 1999", "unknown"],
      ["aud 1999", "unknown"],
      ["cad 1999", "unknown"],
      ["chf 1999", "unknown"],
      ["sek 1999", "unknown"],
      ["nok 1999", "unknown"],
      ["dkk 1999", "unknown"],
      ["rub 1999", "unknown"],
      ["krw 1999", "unknown"],
      ["rs.1999", "unknown"],
      ["rs 1999", "unknown"],
    ])("classifies %j as %s", (input, expected) => {
      expect(extractPriceTier(input)).toBe(expected);
    });

    it("rejects every unrecognised marker in any case", () => {
      const markers = [
        "₹",
        "rs.",
        "rs ",
        "inr",
        "¥",
        "jpy",
        "cny",
        "aud",
        "cad",
        "chf",
        "sek",
        "nok",
        "dkk",
        "rub",
        "krw",
      ];
      for (const marker of markers) {
        expect(parsePriceToEur(`${marker}1999`)).toBeNull();
        expect(parsePriceToEur(`${marker.toUpperCase()}1999`)).toBeNull();
      }
    });
  });

  describe("recognised currencies still resolve", () => {
    it("converts USD and GBP with the documented fixed rates", () => {
      expect(parsePriceToEur("$199")).toBeCloseTo(183.08, 2);
      expect(parsePriceToEur("£250")).toBeCloseTo(292.5, 2);
    });

    it("assumes EUR when no marker is present", () => {
      expect(parsePriceToEur("199")).toBe(199);
      expect(extractPriceTier("199")).toBe("100_to_250");
    });

    it("keeps the documented band boundaries", () => {
      expect(extractPriceTier("€30")).toBe("30_to_100");
      expect(extractPriceTier("€250")).toBe("over_250");
      expect(extractPriceTier("from $9.99")).toBe("under_30");
      expect(extractPriceTier("£250")).toBe("over_250");
    });
  });
});
