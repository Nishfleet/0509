import { describe, expect, it } from "vitest";
import { extractLandingPageSignals } from "~/lib/landing-page-signals.server";

describe("CTA anchor probe", () => {
  it("extracts anchor text as CTA", () => {
    const html = '<a href="/signup">Start free trial</a>';
    const { ctaText } = extractLandingPageSignals(html);
    console.log("anchor cta:", ctaText);
    expect(ctaText).toBe("Start free trial");
  });
  it("extracts button text as CTA fallback", () => {
    const html = '<button>Generate my report</button>';
    const { ctaText } = extractLandingPageSignals(html);
    console.log("button cta:", ctaText);
    expect(ctaText).toBe("Generate my report");
  });
  it("extracts generic anchor as CTA fallback", () => {
    const html = '<a href="/learn">Learn more</a>';
    const { ctaText } = extractLandingPageSignals(html);
    console.log("generic anchor cta:", ctaText);
    expect(ctaText).toBe("Learn more");
  });
});
