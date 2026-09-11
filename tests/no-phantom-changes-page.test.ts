import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { SITEMAP_PATHS } from "~/lib/seo";
import { NO_PHANTOM_CHANGES_PUBLIC_PATH } from "~/lib/capture-validity-public-rules";
import { CAPTURE_VALIDITY_PUBLIC_RULES } from "~/lib/capture-validity-public-rules";
import { mockReactRouter } from "./helpers/mock-react-router";

/**
 * Lock test for issue #2026: the /no-phantom-changes buyer-guarantee page
 * must be registered, indexable, in the sitemap, enumerate the capture-validity
 * rule set (including geo-variance and takedown/restore suppression), link to
 * /capture-rules, and be linked from /ads, /trust, and /pricing.
 */
beforeEach(() => {
  vi.resetModules();
    mockReactRouter();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("no-phantom-changes page lock (#2026)", () => {
  it("is registered at /no-phantom-changes and in the sitemap", () => {
    const routes = readFileSync("app/routes.ts", "utf8");
    expect(routes).toContain('route("no-phantom-changes", "routes/no-phantom-changes.tsx")');
    expect(SITEMAP_PATHS).toContain("/no-phantom-changes");
    expect(NO_PHANTOM_CHANGES_PUBLIC_PATH).toBe("/no-phantom-changes");
  });

  it("renders the guarantee, every public rule, and the geo/takedown suppressions", async () => {
    const { default: NoPhantomChangesRoute } = await import("~/routes/no-phantom-changes");
    const markup = renderToStaticMarkup(createElement(NoPhantomChangesRoute));

    // The verbatim guarantee framing.
    expect(markup).toContain("If we send it, the page really changed");
    // A failed/suppressed capture is never an alert but is visible in run history.
    expect(markup).toContain("never becomes an alert");
    expect(markup).toContain("run history");

    // Core validity rule keywords the issue's verify gate greps for.
    expect(markup.toLowerCase()).toContain("error page");
    expect(markup.toLowerCase()).toContain("cookie");
    expect(markup.toLowerCase()).toContain("challenge");
    expect(markup.toLowerCase()).toContain("geo");

    // Same rules source as /capture-rules — cannot drift.
    for (const rule of CAPTURE_VALIDITY_PUBLIC_RULES) {
      expect(markup).toContain(rule.title);
      expect(markup).toContain(rule.refused);
    }
    // The two suppressions outside the reason-code union.
    expect(markup).toContain("Geo-variance");
    expect(markup).toContain("geo locale change");
    expect(markup).toContain("Site down, then back");

    // Cross-link to the gate-mapped rule list.
    expect(markup).toContain('href="/capture-rules"');
  });

  it("is linked from the /ads brand page, /trust, and /pricing sources", () => {
    const ads = readFileSync("app/routes/ads.$domain.tsx", "utf8");
    const trust = readFileSync("app/routes/trust.tsx", "utf8");
    const pricing = readFileSync("app/routes/pricing.tsx", "utf8");

    // /ads links inline via the shared constant; /trust links inline. Issue
    // #2049 moved the /pricing note into the shared TrustProofNote component
    // (which links NO_PHANTOM_CHANGES_PUBLIC_PATH), so /pricing links through
    // that component — recognizing the refactor keeps the guarantee strong.
    for (const [name, source] of [
      ["/ads", ads],
      ["/trust", trust],
      ["/pricing", pricing],
    ] as const) {
      const linked =
        source.includes('"/no-phantom-changes"') ||
        source.includes("NO_PHANTOM_CHANGES_PUBLIC_PATH") ||
        // /pricing renders the shared proof-trust element (issue #2049).
        source.includes("TrustProofNote");
      expect(linked, `${name} must link /no-phantom-changes`).toBe(true);
    }
  });
});
