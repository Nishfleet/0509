import { describe, expect, it } from "vitest";

import {
  PRICING_COPY,
  PRICING_REGION_COOKIE,
  detectPricingRegion,
  pricingPlansForRegion,
  pricingRegionCookieHeader,
  readPricingRegionCookie,
} from "~/lib/pricing";

describe("detectPricingRegion", () => {
  it("returns 'india' for 'IN'", () => {
    expect(detectPricingRegion("IN")).toBe("india");
  });

  it("returns 'india' for lowercase 'in'", () => {
    expect(detectPricingRegion("in")).toBe("india");
  });

  it("returns 'india' for mixed-case 'iN'", () => {
    expect(detectPricingRegion("iN")).toBe("india");
  });

  it("returns 'rest_of_world' for 'IN ' with trailing space", () => {
    expect(detectPricingRegion("IN ")).toBe("rest_of_world");
  });

  it("returns 'rest_of_world' for null", () => {
    expect(detectPricingRegion(null)).toBe("rest_of_world");
  });

  it("returns 'rest_of_world' for undefined", () => {
    expect(detectPricingRegion(undefined)).toBe("rest_of_world");
  });

  it("returns 'rest_of_world' for empty string", () => {
    expect(detectPricingRegion("")).toBe("rest_of_world");
  });

  it("returns 'rest_of_world' for 'US'", () => {
    expect(detectPricingRegion("US")).toBe("rest_of_world");
  });
});

describe("pricingPlansForRegion", () => {
  describe("india", () => {
    const plans = pricingPlansForRegion("india");

    it("returns an array with exactly 2 plans", () => {
      expect(plans).toHaveLength(2);
    });

    it("first plan is named 'Starter'", () => {
      expect(plans[0].name).toBe("Starter");
    });

    it("second plan is named 'Agency'", () => {
      expect(plans[1].name).toBe("Agency");
    });

    it("monthlyLabel contains 'Rs ' for both plans", () => {
      expect(plans[0].monthlyLabel).toContain("Rs ");
      expect(plans[1].monthlyLabel).toContain("Rs ");
    });

    it("monthlyLabel does not contain '$' for either plan", () => {
      expect(plans[0].monthlyLabel).not.toContain("$");
      expect(plans[1].monthlyLabel).not.toContain("$");
    });
  });

  describe("rest_of_world", () => {
    const plans = pricingPlansForRegion("rest_of_world");

    it("returns an array with exactly 2 plans", () => {
      expect(plans).toHaveLength(2);
    });

    it("first plan is named 'Starter'", () => {
      expect(plans[0].name).toBe("Starter");
    });

    it("second plan is named 'Agency'", () => {
      expect(plans[1].name).toBe("Agency");
    });

    it("monthlyLabel contains '$' for both plans", () => {
      expect(plans[0].monthlyLabel).toContain("$");
      expect(plans[1].monthlyLabel).toContain("$");
    });
  });
});

describe("readPricingRegionCookie", () => {
  it("returns 'india' when cookie is 'pricing_region=india'", () => {
    const request = new Request("https://example.com", {
      headers: { cookie: "pricing_region=india" },
    });
    expect(readPricingRegionCookie(request)).toBe("india");
  });

  it("returns 'rest_of_world' when cookie is 'pricing_region=rest_of_world'", () => {
    const request = new Request("https://example.com", {
      headers: { cookie: "pricing_region=rest_of_world" },
    });
    expect(readPricingRegionCookie(request)).toBe("rest_of_world");
  });

  it("returns 'india' when cookie contains pricing_region before other cookies", () => {
    const request = new Request("https://example.com", {
      headers: { cookie: "pricing_region=india; other_cookie=foo" },
    });
    expect(readPricingRegionCookie(request)).toBe("india");
  });

  it("returns 'rest_of_world' when cookie contains pricing_region after other cookies", () => {
    const request = new Request("https://example.com", {
      headers: { cookie: "other=bar; pricing_region=rest_of_world" },
    });
    expect(readPricingRegionCookie(request)).toBe("rest_of_world");
  });

  it("returns 'india' for 'pricing_region=india=extra' (split[1] = 'india')", () => {
    const request = new Request("https://example.com", {
      headers: { cookie: "pricing_region=india=extra" },
    });
    expect(readPricingRegionCookie(request)).toBe("india");
  });

  it("returns null when cookie header is missing", () => {
    const request = new Request("https://example.com", { headers: new Headers() });
    expect(readPricingRegionCookie(request)).toBe(null);
  });

  it("returns null when cookie header is empty string", () => {
    const request = new Request("https://example.com", {
      headers: { cookie: "" },
    });
    expect(readPricingRegionCookie(request)).toBe(null);
  });

  it("returns null for unknown value 'pricing_region=usa'", () => {
    const request = new Request("https://example.com", {
      headers: { cookie: "pricing_region=usa" },
    });
    expect(readPricingRegionCookie(request)).toBe(null);
  });

  it("returns null when no cookie matches the key", () => {
    const request = new Request("https://example.com", {
      headers: { cookie: "foo=bar; baz=qux" },
    });
    expect(readPricingRegionCookie(request)).toBe(null);
  });
});

describe("pricingRegionCookieHeader", () => {
  it("returns correct Set-Cookie string for 'india'", () => {
    const header = pricingRegionCookieHeader("india");
    expect(header).toBe(
      "pricing_region=india; Path=/; Max-Age=31536000; SameSite=Lax",
    );
  });

  it("returns correct Set-Cookie string for 'rest_of_world'", () => {
    const header = pricingRegionCookieHeader("rest_of_world");
    expect(header).toBe(
      "pricing_region=rest_of_world; Path=/; Max-Age=31536000; SameSite=Lax",
    );
  });
});

describe("PRICING_COPY", () => {
  it("maps 'india' to label 'India pricing' and currency 'INR'", () => {
    expect(PRICING_COPY.india.label).toBe("India pricing");
    expect(PRICING_COPY.india.currency).toBe("INR");
  });

  it("maps 'rest_of_world' to label 'Global pricing' and currency 'USD'", () => {
    expect(PRICING_COPY.rest_of_world.label).toBe("Global pricing");
    expect(PRICING_COPY.rest_of_world.currency).toBe("USD");
  });
});

describe("PRICING_REGION_COOKIE", () => {
  it("equals 'pricing_region'", () => {
    expect(PRICING_REGION_COOKIE).toBe("pricing_region");
  });
});