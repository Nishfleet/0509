import { describe, expect, it } from "vitest";

import { pricingPathFor } from "../../app/lib/signup-redirect";

describe("/signup", () => {
  it("sends the visitor to the pricing page, where every plan has its own start link", () => {
    expect(pricingPathFor("https://0509.io/signup")).toBe("/pricing");
  });

  it("keeps the campaign tags the visitor arrived with", () => {
    expect(pricingPathFor("https://0509.io/signup?utm_source=newsletter&utm_medium=email")).toBe(
      "/pricing?utm_source=newsletter&utm_medium=email",
    );
  });
});
