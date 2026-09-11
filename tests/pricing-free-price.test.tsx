import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
// @ts-expect-error -- vitest greenlight
import { freePlanPriceDisplay } from "~/components/pricing-section";

describe("freePlanPriceDisplay (#2957)", () => {
  it("falls back to the published USD anchor currency when no preview resolved", () => {
    expect(freePlanPriceDisplay(null)).toBe("$0/mo");
    expect(freePlanPriceDisplay({ available: false })).toBe("$0/mo");
  });

  it("derives a zero amount in the preview currency, matching the localized paid cards", () => {
    expect(
      freePlanPriceDisplay({
        available: true,
        prices: {
          scout: { monthly: { display: "€10", amount: 1000, currency: "EUR" } },
        },
      }),
    ).toBe("€0");
  });
});
