import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const searchRoute = readFileSync("app/routes/search.tsx", "utf8");
const searchCss = readFileSync("app/app.css", "utf8");
const searchClasses = Array.from(searchRoute.matchAll(/className=(?:"([^"]+)"|{`([^`]+)`})/g)).flatMap((match) =>
  (match[1] ?? match[2]).split(/\s+/).map((className) => className.replace(/\$\{[^}]+\}/g, "").trim()).filter(Boolean),
);

describe("search rebuild", () => {
  it("uses the fresh search surface instead of the legacy app/search system", () => {
    expect(searchRoute).toContain('className="f9-search-page"');
    expect(searchClasses).not.toEqual(
      expect.arrayContaining([
        "app-shell",
        "site-header",
        "search-panel",
        "results-panel",
        "search-detail",
        "button-primary",
        "button-secondary",
        "section-label",
        "eyebrow",
        "muted-text",
        "content-card",
        "callout-card",
        "empty-state",
        "badge",
      ]),
    );
  });

  it("keeps stale launch framing out of public search", () => {
    expect(searchRoute).not.toMatch(/pilot|beta|manual|fit review|self-serve|not live/i);
  });

  it("describes search as public before account-gated saved tracking", () => {
    expect(searchRoute).toContain("Preview live competitor Meta ads before creating an account");
    expect(searchRoute).toContain("sign in only when you want to save examples and track offer changes");
    expect(searchRoute).not.toContain("Sign in to search competitor Meta ads");
  });

  it("uses the Five to Nine wordmark in the search header", () => {
    expect(searchRoute).toContain("<BrandWordmark />");
  });

  it("keeps public search centered on website-based market tracking", () => {
    expect(searchRoute).toContain("Market tracking");
    expect(searchRoute).toContain("Website to track");
    expect(searchRoute).toContain("My brand");
    expect(searchRoute).toContain("Track this {targetNoun}");
    expect(searchRoute).toContain("Example tracked competitor");
    expect(searchRoute).toContain("Digest preview");
    expect(searchRoute).toContain("/api/demo-proof?format=markdown");
  });

  it("keeps primary search links legible on dark buttons", () => {
    expect(searchCss).toContain(".f9-search-page a.f9-primary-button");
    expect(searchCss).toContain("color: #fff;");
  });
});
