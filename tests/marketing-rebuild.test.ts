import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const marketingRoute = readFileSync("app/routes/marketing.tsx", "utf8");
const brandWordmark = readFileSync("app/components/brand-wordmark.tsx", "utf8");
const appCss = readFileSync("app/app.css", "utf8");
const rootRoute = readFileSync("app/root.tsx", "utf8");
const routes = readFileSync("app/routes.ts", "utf8");
const publicMarkdown = readFileSync("app/lib/public-markdown.ts", "utf8");
const demoProofSource = readFileSync("app/lib/demo-proof.ts", "utf8");
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

  it("keeps generic annual validation blockers out of the pricing cards", () => {
    expect(marketingRoute).not.toContain("Annual pricing needs validation");
    expect(marketingRoute).not.toContain("Annual checkout unavailable until pricing validates");
  });

  it("highlights the annual savings offer", () => {
    expect(marketingRoute).toContain("annualSavingsValidated");
    expect(marketingRoute).toContain("DODO_ANNUAL_SAVINGS_LABEL");
    expect(marketingRoute).toContain('className="f9-toggle-savings"');
    expect(marketingRoute).toContain('className="f9-annual-status"');
    expect(appCss).toContain(".f9-home .f9-toggle-savings");
    expect(appCss).toContain(".f9-home .f9-annual-status strong");
  });

  it("labels live search and keeps preview read-only before account", () => {
    expect(marketingRoute).toContain("Live search");
    expect(marketingRoute).not.toContain("Early access");
    expect(marketingRoute).toContain("Built for the morning meeting.");
    expect(marketingRoute).not.toContain("provider canaries");
    expect(marketingRoute).not.toContain("Readiness-gated");
    expect(marketingRoute).toContain("See what changed before you sign up");
    expect(marketingRoute).toContain("Try live search");
    expect(marketingRoute).toContain("/search?website=https%3A%2F%2Fnykaa.com");
    expect(marketingRoute).toContain('id="demo"');
    expect(marketingRoute).toContain('aria-label="Sample brief before signup"');
    expect(marketingRoute).toContain("Review sample brief");
    expect(marketingRoute).toContain("Preview the morning brief before creating an account.");
    expect(marketingRoute).toContain("See plans");
    expect(marketingRoute).not.toContain("buyer moment");
    expect(marketingRoute).not.toContain("not the live search result");
    expect(marketingRoute).not.toContain("View JSON");
    expect(marketingRoute).not.toContain("Markdown brief");
    expect(marketingRoute).not.toContain("/api/demo-proof");
    expect(marketingRoute).not.toContain("sample watch");
    expect(marketingRoute).not.toContain("Sample watch");
    expect(marketingRoute).not.toContain("Account search");
    expect(marketingRoute).not.toContain('to={rootData.session ? "/search" : "/auth/signup"}');
    expect(marketingRoute).not.toContain('className="f9-announcement" to="/search"');
  });

  it("leads with the counter-move outcome instead of clever price-drop copy", () => {
    expect(marketingRoute).toContain("Paste your competitors. Wake up to the proof-backed counter-move brief.");
    expect(marketingRoute).toContain(
      "Five to Nine watches competitor ads, pages, and public website moves, then shows the proof and next action.",
    );
    expect(marketingRoute).toContain("start from the brands you already track");
    expect(marketingRoute).toContain("scheduled monitoring is included with your plan");
    expect(marketingRoute).toContain("no proof, no claim");
    expect(marketingRoute).toContain("what changed, why it matters, what to do next");
    expect(marketingRoute).not.toContain("turns into a watchlist");
    expect(marketingRoute).not.toContain("daily on Starter & Agency plans");
    expect(marketingRoute).not.toContain("They cut");
    expect(marketingRoute).not.toContain("₹2,400");
    expect(marketingRoute).not.toContain("₹1,999");
    expect(marketingRoute).not.toContain("Diff: −₹401");
  });

  it("keeps README route truth aligned with public read-only search", () => {
    expect(readme).toContain("/api/demo-proof");
    expect(readme).toContain("/search` public read-only live search trial");
    expect(readme).toContain("save, track, collections, and deeper evidence enrichment require an account");
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
    expect(marketingRoute).toContain("Sample Market Desk Brief");
    expect(marketingRoute).toContain("Decision summary");
    expect(marketingRoute).toContain("Client-ready view");
    expect(marketingRoute).toContain("What changed");
    expect(marketingRoute).toContain("Why it matters");
    expect(marketingRoute).toContain("Proof status");
    expect(marketingRoute).toContain("Freshness");
    expect(marketingRoute).toContain("Next action");
    expect(marketingRoute).toContain("Morning brief — 3 moves to beat");
    expect(marketingRoute).toContain("Price drop spotted before breakfast");
    expect(marketingRoute).toContain("New CTA pushing buyers to book");
    expect(marketingRoute).toContain("Screenshots saved. Next move ready by 05:09.");
    expect(marketingRoute).not.toContain("Visible offer text changed");
    expect(marketingRoute).not.toContain("CTA changed on the destination page");
    expect(marketingRoute).not.toContain("Evidence on file. No screenshots, no claim.");
    expect(marketingRoute).not.toContain("evidence on file");
    expect(marketingRoute).toContain("Recommended launch plan");
    expect(marketingRoute).toContain("Start with Starter");
    expect(marketingRoute).toContain("Daily competitor monitoring");
    expect(marketingRoute).toContain("valueMathLabel");
    expect(marketingRoute).toContain("Check packs");
    expect(marketingRoute).toContain('className={`f9-commerce-card${plan.slug === "starter" ? " is-recommended" : ""}`}');
    expect(marketingRoute).toContain('className="f9-plan-badge">Recommended</em>');
    expect(marketingRoute).not.toContain("Proof-first monitoring");
    expect(marketingRoute).not.toContain("Start with Scout");
    expect(marketingRoute).not.toContain("Dodo price syncing");
    expect(marketingRoute).not.toContain("Extra check capacity");
    expect(marketingRoute).not.toContain("No unlimited claims");
    expect(marketingRoute).not.toContain("3 offer changes ready");
    expect(marketingRoute).not.toContain("Nykaa changed onboarding bundle");
    expect(marketingRoute).not.toContain("boAt removed COD offer");
    expect(marketingRoute).not.toContain("Meesho added discount hook");
    expect(marketingRoute.indexOf("Decision summary")).toBeLessThan(
      marketingRoute.indexOf("Source trail"),
    );
  });

  it("keeps Slack out of the public GA offer", () => {
    expect(marketingRoute).not.toContain("Slack delivery");
    expect(marketingRoute).not.toContain("Slack-ready");
    expect(marketingRoute).toContain("Brief export");
  });

  it("keeps unsupported social and internal implementation claims out of homepage copy", () => {
    for (const unsupported of ["Slack", "WhatsApp", "Reddit", "LinkedIn", "Twitter"]) {
      expect(marketingRoute).not.toContain(unsupported);
    }
    for (const internalTerm of ["GA gate", "fan-out", "D1", "canary", "internal workspace", "workspace-approved"]) {
      expect(marketingRoute).not.toContain(internalTerm);
    }
  });

  it("keeps the rendered sample artifact to supported channel labels", () => {
    expect(demoProofSource).toContain('channel: "Website page"');
    expect(demoProofSource).toContain('channel: "Public ad library"');
    for (const unsupported of ["TikTok", "Google / YouTube", "LinkedIn", "Pinterest", "Reddit", "X/Twitter"]) {
      expect(demoProofSource).not.toContain(unsupported);
    }
  });

  it("keeps Agency checkout held unless the commercial capacity proof opens it", () => {
    expect(marketingRoute).toContain("Account review");
    expect(marketingRoute).toContain("Agency is available by account review");
    expect(marketingRoute).toContain("Common billing questions");
    expect(marketingRoute).toContain("What changes on Agency?");
    expect(marketingRoute).toContain("Why is Agency held?");
    expect(marketingRoute).not.toContain("capacity review");
    expect(marketingRoute).not.toContain("higher-volume monitoring coverage");
    expect(marketingRoute).not.toContain("fan-out workflow path");
    expect(marketingRoute).not.toContain("highest queue priority");
  });

  it("uses customer-facing check language for top-ups and included usage", () => {
    expect(marketingRoute).toContain("Purchased checks never expire");
    expect(marketingRoute).toContain("Included checks reset every month");
    expect(marketingRoute).toContain("Scheduled scans are included with your plan");
    expect(marketingRoute).toContain("proof-backed capture");
    expect(marketingRoute).toContain("500 extra checks");
    expect(marketingRoute).not.toContain("Record packs");
    expect(marketingRoute).not.toContain("record packs");
    expect(marketingRoute).not.toContain("saved change records");
    expect(marketingRoute).not.toContain("per saved record");
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
    expect(marketingRoute).toContain("Proof-backed brief");
    expect(marketingRoute).toContain("Competitor moves, source trail, next action");
    expect(marketingRoute).toContain('action="/search"');
    expect(marketingRoute).toContain("Catch them in the act");
    expect(appCss).toContain('--ld-display: "Bricolage Grotesque"');
    expect(appCss).toContain("@keyframes ld-roll");
    expect(appCss).toContain("@keyframes ld-blink");
    expect(appCss).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
