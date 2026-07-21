import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const searchRoute = readFileSync("app/routes/search.tsx", "utf8");
const searchCss = readFileSync("app/app.css", "utf8");
const searchClasses = Array.from(searchRoute.matchAll(/className=(?:"([^"]+)"|{`([^`]+)`})/g)).flatMap((match) =>
  (match[1] ?? match[2]).split(/\s+/).map((className) => className.replace(/\$\{[^}]+\}/g, "").trim()).filter(Boolean),
);

describe("search rebuild", () => {
  it("uses the fresh search surface instead of the legacy app/search system", () => {
    expect(searchRoute).toContain('pageClassName="f9-search-page"');
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
    expect(searchRoute).toContain("Preview public competitor ad results before creating an account");
    expect(searchRoute).toContain("Provider coverage and freshness vary");
    expect(searchRoute).not.toContain("Sign in to search competitor Meta ads");
  });

  it("uses DashboardShell instead of the old marketing header", () => {
    expect(searchRoute).toContain("DashboardShell");
    expect(searchRoute).not.toContain('className="f9-cursor-shell"');
    expect(searchRoute).not.toContain("<BrandWordmark />");
  });

  it("keeps public search centered on website-based market tracking", () => {
    expect(searchRoute).toContain("Competitor website");
    expect(searchRoute).toContain("Paste one competitor website");
    expect(searchRoute).not.toContain("Brand or search term");
    expect(searchRoute).not.toContain("My brand");
    expect(searchRoute).not.toContain("f9-search-controls");
    expect(searchRoute).toContain("f9-search-refine");
    expect(searchRoute).toContain('name="platform"');
    expect(searchRoute).toContain('name="creativeType"');
    expect(searchRoute).toContain('name="status"');
    expect(searchRoute).toContain('intent="save-query"');
    expect(searchRoute).not.toContain("Example tracked competitor");
    expect(searchRoute).not.toContain("Digest preview");
    expect(searchRoute).not.toContain("/api/demo-proof?format=markdown");
    expect(searchRoute).toContain("Track this {targetNoun}");
  });

  it("exposes firstSeenFrom / lastSeenFrom date inputs in the Refine panel", () => {
    // UI labels + named date inputs (not hidden-only plumbing).
    expect(searchRoute).toContain("First seen after");
    expect(searchRoute).toContain("Last active after");
    expect(searchRoute).toMatch(/name="firstSeenFrom"[\s\S]*?type="date"/);
    expect(searchRoute).toMatch(/name="lastSeenFrom"[\s\S]*?type="date"/);
    // Action still threads form fields into SearchFilters.
    expect(searchRoute).toContain('formData.get("firstSeenFrom")');
    expect(searchRoute).toContain('formData.get("lastSeenFrom")');
    // Secondary forms keep filter state via hidden fields.
    expect(searchRoute).toContain(
      '<input name="firstSeenFrom" type="hidden" value={filters.firstSeenFrom} />',
    );
    expect(searchRoute).toContain(
      '<input name="lastSeenFrom" type="hidden" value={filters.lastSeenFrom} />',
    );
  });

  it("keeps hidden result markers for production canaries", () => {
    expect(searchRoute).toContain("data-f9-result-source");
    expect(searchRoute).toContain("data-f9-result-cache-status");
    expect(searchRoute).toContain("data-f9-result-empty-reason");
  });

  it("keeps freshness warnings visible when non-empty results are cached or degraded", () => {
    expect(searchRoute).toContain("discoverySummary && visibleAds.length > 0");
    expect(searchRoute).toContain('className="f9-discovery-banner"');
  });

  it("keeps primary search links legible on dark buttons", () => {
    expect(searchCss).toContain(".f9-search-page a.f9-primary-button");
    expect(searchCss).toContain("color: #fff;");
  });
});
