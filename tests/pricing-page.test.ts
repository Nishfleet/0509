import { describe, expect, it } from "vitest";

import { PLANS, TRIAL_TERMS } from "../app/lib/billing/plans";
import { pricingMeta, startSource } from "../app/lib/pricing-page";

describe("startSource", () => {
  it("accepts the three known sources", () => {
    for (const source of ["organic", "llms", "share"]) {
      expect(startSource(new URL(`https://0509.io/pricing?utm_source=${source}`))).toBe(source);
    }
  });

  it("drops an unknown, empty or missing source", () => {
    expect(startSource(new URL("https://0509.io/pricing?utm_source=x"))).toBeNull();
    expect(startSource(new URL("https://0509.io/pricing?utm_source="))).toBeNull();
    expect(startSource(new URL("https://0509.io/pricing"))).toBeNull();
  });
});

describe("pricingMeta", () => {
  const meta = pricingMeta();
  const named = (key: string, value: string) => meta.find((entry) => (entry as Record<string, unknown>)[key] === value);

  it("is indexable with its own canonical", () => {
    expect(named("name", "robots")).toMatchObject({ content: "index, follow" });
    expect(named("rel", "canonical")).toMatchObject({ href: "https://0509.io/pricing" });
  });

  it("states every plan price and the trial terms in the description", () => {
    const description = String((named("name", "description") as { content: string }).content);
    for (const plan of PLANS) {
      expect(description).toContain(`${plan.name} €${String(plan.monthlyPriceEur)}/month`);
    }
    expect(description).toContain(TRIAL_TERMS);
  });

  it("carries one offer per plan in the json-ld graph", () => {
    const graph = JSON.stringify(meta.find((entry) => "script:ld+json" in entry));
    for (const plan of PLANS) {
      expect(graph).toContain(`"price":"${plan.monthlyPriceEur.toFixed(2)}"`);
    }
  });
});
