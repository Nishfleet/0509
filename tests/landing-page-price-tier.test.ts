import { describe, it, expect } from "vitest";
import { extractPriceTier, parsePriceToEur } from "../app/lib/landing-page-price-tier.server";

describe("landing-page-price-tier", () => {
  describe("unrecognised-currency markers (case-insensitive)", () => {
    it("does not treat a lowercase-coded foreign price as EUR", () => {
      // "Rs 1,999" / "INR 499" must not fall through to the assume-EUR branch.
      expect(extractPriceTier("Rs 1,999")).toBe("unknown");
      expect(extractPriceTier("INR 499")).toBe("unknown");
    });

    it.each([
      "$199",
      "USD 199",
      "EUR 199",
      "€199",
      "GBP 199",
      "£199",
      "199",
      "",
      "free",
      "₹1999",
      "¥1999",
      "Rs.1999",
      "Rs 1999",
      "RS 1999",
      "JPY 1999",
      "CNY 1999",
      "AUD 1999",
      "CAD 1999",
      "CHF 1999",
      "SEK 1999",
      "NOK 1999",
      "DKK 1999",
      "RUB 1999",
      "KRW 1999",
      "inr 1999",
      "jpy 1999",
    ])("classifies %j without assuming EUR for foreign codes", (input) => {
      const tier = extractPriceTier(input);
      const eur = parsePriceToEur(input);
      if (eur === null) {
        expect(tier).toBe("unknown");
      } else {
        expect(tier).not.toBe("unknown");
      }
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
      expect(extractPriceTier("$199")).toBe("100_to_250");
    });
  });
});
