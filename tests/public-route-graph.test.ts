import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loader as plansLoader } from "~/routes/plans";
import { loader as pricingLoader } from "~/routes/pricing";
import { loader as sampleBriefLoader } from "~/routes/sample-brief";

const LEGACY_ROUTES = [
  {
    file: "sample-brief",
    path: "/sample-brief",
    location: "/#demo",
    loader: sampleBriefLoader,
  },
  {
    file: "pricing",
    path: "/pricing",
    location: "/#pricing",
    loader: pricingLoader,
  },
  {
    file: "plans",
    path: "/plans",
    location: "/#pricing",
    loader: plansLoader,
  },
] as const;

describe("legacy public routes 301 to their homepage anchors", () => {
  it("registers every legacy redirect in the route manifest", () => {
    const manifest = readFileSync(
      join(__dirname, "..", "app", "routes.ts"),
      "utf8",
    );
    for (const { file, path } of LEGACY_ROUTES) {
      expect(
        manifest,
        `${path} must be registered in app/routes.ts or it 404s in production`,
      ).toContain(`route("${path.slice(1)}", "routes/${file}.tsx")`);
    }
  });

  for (const { path, location, loader } of LEGACY_ROUTES) {
    it(`301s ${path} to ${location}`, async () => {
      const response = await loader({
        request: new Request(`https://0509.io${path}`),
        url: new URL(`https://0509.io${path}`),
        params: {},
        context: {},
      } as never);

      expect(response.status).toBe(301);
      expect(response.headers.get("location")).toBe(location);
    });
  }
});
