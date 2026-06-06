import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const searchRoute = readFileSync("app/routes/search.tsx", "utf8");
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

  it("uses the Five to Nine wordmark in the search header", () => {
    expect(searchRoute).toContain("<BrandWordmark />");
  });

  it("keeps public search centered on competitor website tracking", () => {
    expect(searchRoute).toContain("Competitor website");
    expect(searchRoute).toContain("Website to track");
    expect(searchRoute).toContain("Track this competitor");
  });
});
