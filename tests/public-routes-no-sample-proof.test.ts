import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Regression guard for PR #633: the production build once failed because a
// public marketing route still statically imported the deleted sample/illustrative
// fixture `~/lib/demo-proof`. Every public route must source its proof from the
// real cache-only loader (`~/lib/public-proof.server`) and must never reference
// the removed sample fixture module — otherwise the bundle build fails to
// resolve the import and the site cannot ship.

const routesDir = join(process.cwd(), "app/routes");

const routeFiles = readdirSync(routesDir).filter(
  (name) => name.endsWith(".tsx") || name.endsWith(".ts"),
);

describe("public routes and sample-proof fixtures", () => {
  it("no public route imports the deleted sample-proof fixture", () => {
    for (const name of routeFiles) {
      const source = readFileSync(join(routesDir, name), "utf8");
      expect(
        source,
        `app/routes/${name} must not import the deleted ~/lib/demo-proof fixture`,
      ).not.toMatch(/from\s+["']~\/lib\/demo-proof["']/);
    }
  });

  it("public proof is sourced only from the real cache-only loader", () => {
    for (const name of routeFiles) {
      const source = readFileSync(join(routesDir, name), "utf8");
      // Any route that renders proof must go through loadPublicProofBrief —
      // directly, or via the /api/demo-proof endpoint whose loader is the same
      // call (#2696 moved the homepage brief to a client fetch so the
      // shared-cached document stays country-neutral). No route may synthesize
      // an inline illustrative fixture instead.
      if (source.includes("proofBrief") || source.includes("PublicProofBrief")) {
        expect(
          /loadPublicProofBrief/.test(source) || source.includes("/api/demo-proof"),
          `app/routes/${name} must use the real loadPublicProofBrief loader for proof (directly or via /api/demo-proof)`,
        ).toBe(true);
      }
    }
  });

  it("no public route reintroduces an inline illustrative proof fixture", () => {
    // The homepage once inlined a `demoProof` object; guard the class so a
    // sample/illustrative fixture cannot silently return via a new route.
    for (const name of routeFiles) {
      const source = readFileSync(join(routesDir, name), "utf8");
      expect(
        source,
        `app/routes/${name} must not reintroduce an inline sample-proof fixture`,
      ).not.toMatch(/const\s+demoProof\s*=|from\s+["']~\/lib\/demo-proof["']/);
    }
  });
});
