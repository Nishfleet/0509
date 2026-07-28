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

describe("search — Evidence Desk treatment (BL-025)", () => {
  it("runs exactly one Rank-1 CTA and retires the fourth button style from the command block", () => {
    // Brief §5: "See ads" is the single thing this page exists to do.
    expect(searchRoute).toMatch(/f9-ed-cta--rank1[\s\S]*?See ads/);
    expect(searchClasses.filter((className) => className === "f9-ed-cta--rank1")).toHaveLength(1);
    // The command block no longer reaches for `.f9-primary-button` /
    // `.f9-secondary-button` — the workspace button API is the three ranks.
    expect(searchCss).not.toContain(".f9-search-page .f9-search-command .f9-primary-button");
    expect(searchCss).not.toContain(".f9-search-page .f9-search-command .f9-secondary-button");
  });

  it("opens in the desk voice: mono kicker, display title, one honest lead", () => {
    expect(searchRoute).toContain("Meta Ad Library · live search");
    expect(searchRoute).toContain('<h1 id="search-command-title">Find competitor ads</h1>');
    expect(searchCss).toContain("font-family: var(--ed-display);");
    // Brief §4.6: radius 0 and 2.5px rules replaced the 8/10px Vercel-era card
    // chrome on every control in this block.
    expect(searchCss).not.toContain("border: 1px solid #ddd8cd;");
    expect(searchCss).not.toContain("border: 1px solid #d8d2c5;");
    expect(searchCss).not.toContain("color: #9b978f;");
  });

  it("integrates the helper text into the form it describes", () => {
    // The hint used to sit after </Form>, dangling under the button.
    const formBlock = searchRoute.slice(
      searchRoute.indexOf('<Form className="f9-search-command-form"'),
      searchRoute.indexOf("</Form>", searchRoute.indexOf('<Form className="f9-search-command-form"')),
    );
    expect(formBlock).toContain('id="search-command-hint"');
    expect(formBlock).toContain('className="f9-search-command-hint"');
    expect(searchCss).toMatch(/\.f9-search-command-hint \{[\s\S]*?grid-column: 1 \/ -1;/);
  });

  it("fills the pre-search result area with a labelled specimen, never a void", () => {
    // Brief §6.8 / anti-reference A3: an empty state is a panel, and the
    // specimen is inert, dimmed and labelled — no invented finding.
    expect(searchRoute).toContain("SpecimenEmptyState");
    expect(searchRoute).toContain("No search run yet · Meta Ad Library");
    expect(searchRoute).toContain("Result 01 — sample shape, not a finding");
    expect(searchRoute).toContain("Sample advertiser");
    // The specimen carries no Rank-1 of its own (§5: one per screen).
    const specimenBlock = searchRoute.slice(searchRoute.indexOf("<SpecimenEmptyState"));
    expect(specimenBlock.slice(0, specimenBlock.indexOf("/>"))).not.toContain("primaryAction");
  });

  it("styles the filter row itself instead of shipping native select and date chrome", () => {
    expect(searchCss).toMatch(/\.f9-search-page \.f9-search-field select \{[\s\S]*?appearance: none;/);
    expect(searchCss).toContain(".f9-search-page .f9-search-field input[type=\"date\"]");
    expect(searchCss).toContain(".f9-search-page .f9-search-refine-disclosure > summary::after");
  });

  it("lets the dark theme flip the command block through the --ed-* aliases only", () => {
    // BL-025 deleted the dark-only duplicates of these controls; a second
    // theme-scoped rule for them can only drift from the token layer.
    expect(searchCss).not.toContain('[data-f9-theme="dark"] .f9-search-page .f9-search-field input');
    expect(searchCss).not.toContain('[data-f9-theme="dark"] .f9-search-page .f9-search-field select');
    expect(searchCss).not.toContain('[data-f9-theme="dark"] .f9-search-page .f9-search-command-hint,');
    expect(searchCss).not.toContain(
      '[data-f9-theme="dark"] .f9-search-page .f9-search-refine-disclosure',
    );
  });
});
