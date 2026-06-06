import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const marketingRoute = readFileSync("app/routes/marketing.tsx", "utf8");
const brandWordmark = readFileSync("app/components/brand-wordmark.tsx", "utf8");
const appCss = readFileSync("app/app.css", "utf8");
const rootRoute = readFileSync("app/root.tsx", "utf8");
const routes = readFileSync("app/routes.ts", "utf8");
const publicMarkdown = readFileSync("app/lib/public-markdown.ts", "utf8");
const publicHomeSource = [marketingRoute, brandWordmark, appCss, rootRoute, routes, publicMarkdown].join("\n");
const marketingClasses = Array.from(marketingRoute.matchAll(/className="([^"]+)"/g)).flatMap((match) =>
  match[1].split(/\s+/),
);

describe("marketing rebuild", () => {
  it("uses the fresh public-home surface instead of the legacy landing system", () => {
    expect(marketingRoute).toContain('className="f9-home"');
    expect(marketingClasses).not.toEqual(
      expect.arrayContaining([
        "site-shell",
        "site-header",
        "hero-section",
        "hero-copy",
        "button-primary",
        "button-secondary",
        "pricing-card",
        "section-label",
        "eyebrow",
        "muted-text",
      ]),
    );
    expect(marketingClasses.some((className) => className.startsWith("stripe-"))).toBe(false);
  });

  it("keeps stale launch framing out of the landing page", () => {
    expect(marketingRoute).not.toMatch(/pilot|manual|fit review|self-serve|not live/i);
  });

  it("blocks the old public home from coming back", () => {
    const deadSignals = [
      "The market moves after you log off",
      "After-hours market intelligence",
      "Enter pilot",
      "Intelligence room",
      "pricing-region",
      "Fraunces",
      "Manrope",
      "Rs 2,500",
      "Rs 7,500",
      "Dodo preview",
      "Buyer currency is served from checkout preview.",
      "Prices are loaded from Dodo",
      "Meta beta access",
      "source states separated",
      "source trail per move",
    ];

    for (const signal of deadSignals) {
      expect(publicHomeSource).not.toContain(signal);
    }
  });

  it("uses the Five to Nine wordmark and icon-style CTA arrows", () => {
    expect(marketingRoute).toContain("<BrandWordmark />");
    expect(brandWordmark).toContain("<span>five</span>");
    expect(brandWordmark).toContain('className="f9-wordmark-bridge">to</span>');
    expect(brandWordmark).toContain("<span>nine</span>");
    expect(marketingRoute).not.toContain("&gt;");
    expect(marketingRoute).toContain('className="f9-link-arrow"');
  });

  it("keeps the public homepage focused on the customer pain", () => {
    expect(marketingRoute).toContain("Know when competitors change the offer.");
    expect(marketingRoute).toContain("Stop finding out after the sales call.");
    expect(marketingRoute).toContain("Sample brief");
    expect(marketingRoute).toContain("Visible offer text changed");
    expect(marketingRoute).toContain("CTA changed on the destination page");
    expect(marketingRoute).toContain("Recommended launch plan");
    expect(marketingRoute).toContain("Start with Starter");
    expect(marketingRoute).toContain("Weekly proof briefs");
    expect(marketingRoute).toContain('className={`f9-commerce-card${plan.slug === "starter" ? " is-recommended" : ""}`}');
    expect(marketingRoute).toContain('className="f9-plan-badge">Recommended</em>');
    expect(marketingRoute).not.toContain("Proof-first monitoring");
    expect(marketingRoute).not.toContain("Start with Scout");
    expect(marketingRoute).not.toContain("Dodo price syncing");
    expect(marketingRoute).not.toContain("No unlimited claims");
    expect(marketingRoute).not.toContain("3 offer changes ready");
    expect(marketingRoute).not.toContain("Nykaa changed onboarding bundle");
    expect(marketingRoute).not.toContain("boAt removed COD offer");
    expect(marketingRoute).not.toContain("Meesho added discount hook");
  });

  it("has incinerated the stale lower-page system", () => {
    expect(marketingRoute).not.toMatch(
      /f9-market-row|f9-platform|f9-proof-section|f9-proof-layout|f9-proof-steps|f9-proof-token|f9-pricing(?!-receipt)|f9-trust|Example watches|Pricing for teams|Built for proof|One proof layer|Every alert|Proof-backed search|proof-ready/i,
    );
    expect(appCss).not.toMatch(
      /f9-market-row|f9-platform|f9-proof-section|f9-proof-layout|f9-proof-steps|f9-pricing(?!-receipt)|f9-region-form|f9-billing-actions|f9-trust|f9-revenue-strip|f9-intelligence|f9-command|f9-final/i,
    );
  });

  it("uses Stripe-grade typography and motion primitives", () => {
    expect(rootRoute).toContain("family=Inter");
    expect(appCss).toContain('--f9-font: "Inter"');
    expect(marketingRoute).toContain("signalRays");
    expect(marketingRoute).toContain('className="f9-backbone-section"');
    expect(appCss).toContain("@keyframes f9-burst-drift");
    expect(appCss).toContain("@keyframes f9-wave-drift");
    expect(appCss).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
