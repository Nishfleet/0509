import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { isBuyerSurfaceLocaleId } from "~/lib/locale-markets";

/**
 * Issue #2962 (orchestrator Branch B): the first-value locale routes
 * (`$locale.search` etc., issue #1578) are DELETED — every buyer-surface
 * locale path is a 301 to the EN pathname. This canary keeps the redirect
 * contract for exactly those routes registered before the removal.
 */
const LOCALE_FIRST_VALUE_ROUTES = [
  "search",
  "competitor-monitoring",
  "capture-rules",
  "methodology",
] as const;

describe("locale first-value surfaces are EN redirects (issue #2962)", () => {
  it("registers NO first-value child routes under :locale any more", () => {
    const routes = readFileSync("app/routes.ts", "utf8");
    const localeBlock = routes.slice(
      routes.indexOf('route(":locale/*"'),
      routes.indexOf('route("team/accept"'),
    );
    for (const route of LOCALE_FIRST_VALUE_ROUTES) {
      expect(localeBlock, `${route} locale child must be gone`).not.toContain(
        `route("${route}",`,
      );
    }
  });

  it("the splat redirect file still exists and exports the 301 loader", async () => {
    const mod = await import("~/routes/$locale");
    expect(typeof mod.loader).toBe("function");
    expect(mod.default).toBeDefined();
  });

  it("isBuyerSurfaceLocaleId still gates the five legacy prefixes", () => {
    for (const locale of ["de", "ja", "pt-br", "fr", "es"] as const) {
      expect(isBuyerSurfaceLocaleId(locale)).toBe(true);
    }
    expect(isBuyerSurfaceLocaleId("en")).toBe(false);
  });
});
