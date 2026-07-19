import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AdAnglePill } from "~/components/ad-angle-pill";
import { classifyAdRecordAngle } from "~/lib/ad-display";

const discountAd = {
  hook: "Summer sale ends soon",
  body: "Up to 50% off everything sitewide with free shipping on all orders.",
  offer: "50% off",
  cta: "Shop now",
};

const weakAd = {
  hook: "Untitled",
  body: "",
  offer: "",
  cta: "",
};

describe("AdAnglePill", () => {
  it("renders the angle chip with the pill CSS family and a tooltip", () => {
    const markup = renderToString(<AdAnglePill ad={discountAd} />);

    expect(markup).toContain("f9-longevity-pill");
    expect(markup).toContain("f9-angle-pill");
    expect(markup).toContain("urgency");
    expect(markup).toContain("title=");
  });

  it("renders nothing when classification is null — no unknown chips", () => {
    expect(classifyAdRecordAngle(weakAd)).toBeNull();
    expect(renderToString(<AdAnglePill ad={weakAd} />)).toBe("");
  });

  it("marks the brand_lifestyle fallback chip as tentative", () => {
    const lifestyleAd = {
      hook: "Some mornings ask for nothing.",
      body: "Linen woven on the coast, made for the slow hours in between.",
      offer: "",
      cta: "Learn more",
    };

    const markup = renderToString(<AdAnglePill ad={lifestyleAd} />);
    expect(markup).toContain("is-tentative");
    expect(markup).toContain("lifestyle");
  });
});
