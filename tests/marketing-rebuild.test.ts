import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const marketingRoute = readFileSync("app/routes/marketing.tsx", "utf8");
const brandWordmark = readFileSync("app/components/brand-wordmark.tsx", "utf8");
const appCss = readFileSync("app/app.css", "utf8");
const rootRoute = readFileSync("app/root.tsx", "utf8");
const routes = readFileSync("app/routes.ts", "utf8");
const publicMarkdown = readFileSync("app/lib/public-markdown.ts", "utf8");
const readme = readFileSync("README.md", "utf8");
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

  it("labels live search and keeps preview read-only before account", () => {
    expect(marketingRoute).toContain("Live search");
    expect(marketingRoute).not.toContain("Early access");
    expect(marketingRoute).toContain("Honest by design.");
    expect(marketingRoute).not.toContain("provider canaries");
    expect(marketingRoute).not.toContain("Readiness-gated");
    expect(marketingRoute).toContain("Preview live search before creating an account");
    expect(marketingRoute).toContain("Try live search");
    expect(marketingRoute).toContain("/search?website=https%3A%2F%2Fnykaa.com");
    expect(marketingRoute).toContain('id="demo"');
    expect(marketingRoute).toContain('aria-label="Sample proof before signup"');
    expect(marketingRoute).toContain("Review sample proof loop");
    expect(marketingRoute).toContain("Open markdown proof");
    expect(marketingRoute).toContain("See the proof shape before creating an account.");
    expect(marketingRoute).toContain("/api/demo-proof");
    expect(marketingRoute).not.toContain("Account search");
    expect(marketingRoute).not.toContain('to={rootData.session ? "/search" : "/auth/signup"}');
    expect(marketingRoute).not.toContain('className="f9-announcement" to="/search"');
  });

  it("keeps README route truth aligned with public read-only search", () => {
    expect(readme).toContain("/api/demo-proof");
    expect(readme).toContain("/search` public read-only live search trial");
    expect(readme).toContain("save, track, collections, and deeper proof enrichment require an account");
    expect(readme).not.toContain("/search` account-gated analysis flow");
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
    expect(marketingRoute).toContain("Weekly change briefs");
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

  it("keeps Slack out of the public GA offer", () => {
    expect(marketingRoute).not.toContain("Slack delivery");
    expect(marketingRoute).not.toContain("Slack-ready");
    expect(marketingRoute).toContain("Brief export");
  });

  it("gates Agency checkout on the pricing page until fan-out is proven", () => {
    expect(marketingRoute).toContain("summarizeCommercialLaunch");
    expect(marketingRoute).toContain("Held for capacity proof");
    expect(marketingRoute).toContain("Common billing questions");
    expect(marketingRoute).toContain("Why is Agency held?");
  });

  it("has incinerated the stale lower-page system", () => {
    expect(marketingRoute).not.toMatch(
      /f9-market-row|f9-platform|f9-proof-section|f9-proof-layout|f9-proof-steps|f9-proof-token|f9-pricing(?!-receipt)|f9-trust|Example watches|Pricing for teams|Built for proof|One proof layer|Every alert|Proof-backed search|proof-ready/i,
    );
    expect(appCss).not.toMatch(
      /f9-market-row|f9-platform|f9-proof-section|f9-proof-layout|f9-proof-steps|f9-pricing(?!-receipt)|f9-region-form|f9-billing-actions|f9-trust|f9-revenue-strip|f9-intelligence|f9-command|f9-final/i,
    );
  });

  it("uses the caught-in-the-act typography and motion primitives", () => {
    expect(rootRoute).toContain("family=Inter");
    expect(appCss).toContain('--f9-font: "Inter"');
    expect(rootRoute).toContain("Bricolage+Grotesque");
    expect(rootRoute).toContain("IBM+Plex+Mono");
    expect(marketingRoute).toContain('className="ld-ticker"');
    expect(marketingRoute).toContain('className="ld-wall"');
    expect(marketingRoute).toContain("Sample case file");
    expect(marketingRoute).toContain('action="/search"');
    expect(marketingRoute).toContain("Catch them in the act");
    expect(appCss).toContain('--ld-display: "Bricolage Grotesque"');
    expect(appCss).toContain("@keyframes ld-roll");
    expect(appCss).toContain("@keyframes ld-blink");
    expect(appCss).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
