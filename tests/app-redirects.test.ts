import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as digestsRoute from "~/routes/app.digests";
import * as developerAccessRoute from "~/routes/app.developer-access";
import * as supportRoute from "~/routes/app.support";

/**
 * Route diet phase 1 (Nishfleet/0509#2213) — every folded route must land on
 * the documented new screen with a 302, and must keep the query string so a
 * deep link survives the fold. A POST from a page that was open across the
 * deploy gets a 307: method and body are preserved so the destination's
 * action still runs instead of 405ing.
 *
 * The old -> new map in `docs/route-diet.md` is the contract this test pins.
 */

type RouteLoader = (args: { request: Request }) => Promise<Response>;
type RouteAction = (args: { request: Request }) => Promise<Response>;

const routeConfig = readFileSync("app/routes.ts", "utf8");
const routeDietDoc = readFileSync("docs/route-diet.md", "utf8");

const SHIPPED_FOLDS = [
  {
    name: "digests -> briefs",
    oldPath: "/app/digests",
    stubFile: "app/routes/app.digests.tsx",
    newPath: "/app/briefs",
    newScreenFile: "app/routes/app.briefs.tsx",
    module: digestsRoute,
  },
  {
    name: "developer-access -> api",
    oldPath: "/app/developer-access",
    stubFile: "app/routes/app.developer-access.tsx",
    newPath: "/app/api",
    newScreenFile: "app/routes/app.api.tsx",
    module: developerAccessRoute,
  },
  {
    name: "support -> help",
    oldPath: "/app/support",
    stubFile: "app/routes/app.support.tsx",
    newPath: "/app/help",
    newScreenFile: "app/routes/app.help.tsx",
    module: supportRoute,
  },
] as const;

async function follow(
  module: unknown,
  path: string,
  search = "",
): Promise<{ status: number; location: string | null }> {
  const loader = (module as { loader: RouteLoader }).loader;
  const response = await loader({
    request: new Request(`https://five-to-nine.test${path}${search}`),
  });
  return { status: response.status, location: response.headers.get("location") };
}

describe("route diet phase 1 redirects", () => {
  it.each(SHIPPED_FOLDS)("$name answers 302 to $newPath", async (fold) => {
    const result = await follow(fold.module, fold.oldPath);
    expect(result.status).toBe(302);
    expect(result.location).toBe(fold.newPath);
  });

  it.each(SHIPPED_FOLDS)("$name preserves the query string", async (fold) => {
    const result = await follow(fold.module, fold.oldPath, "?tab=archive&event=evt_1");
    expect(result.status).toBe(302);
    expect(result.location).toBe(`${fold.newPath}?tab=archive&event=evt_1`);
  });

  it.each(SHIPPED_FOLDS)("$name answers a POST with 307, never 405", async (fold) => {
    const action = (fold.module as unknown as { action: RouteAction }).action;
    const response = await action({
      request: new Request(`https://five-to-nine.test${fold.oldPath}?tab=archive`, {
        method: "POST",
      }),
    });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${fold.newPath}?tab=archive`);
  });

  it.each(SHIPPED_FOLDS)("$name still has both its old and its new route file", (fold) => {
    expect(existsSync(fold.stubFile)).toBe(true);
    expect(existsSync(fold.newScreenFile)).toBe(true);
    expect(routeConfig).toContain(
      fold.newScreenFile.replace("app/routes/", "routes/"),
    );
  });

  it("renders nothing for a folded route — the screen moved, it did not fork", async () => {
    for (const fold of SHIPPED_FOLDS) {
      const screen = (fold.module as unknown as { default: () => unknown }).default;
      expect(screen()).toBeNull();
    }
  });

  it("registers the eight screens and the competitor drill-in", () => {
    expect(routeConfig).toContain('index("routes/app.dashboard.tsx")');
    expect(routeConfig).toContain('route("c/:id", "routes/app.c.$id.tsx")');
    expect(routeConfig).toContain('route("briefs", "routes/app.briefs.tsx")');
    expect(routeConfig).toContain('route("api", "routes/app.api.tsx")');
    expect(routeConfig).toContain('route("help", "routes/app.help.tsx")');
    for (const screen of [
      "app.dashboard.tsx",
      "app.c.$id.tsx",
      "app.briefs.tsx",
      "app.account.tsx",
      "app.team.tsx",
      "app.api.tsx",
      "app.settings.tsx",
      "app.help.tsx",
    ]) {
      expect(existsSync(`app/routes/${screen}`)).toBe(true);
    }
  });

  it("documents every shipped fold in docs/route-diet.md", () => {
    for (const fold of SHIPPED_FOLDS) {
      expect(routeDietDoc).toContain(fold.oldPath);
      expect(routeDietDoc).toContain(fold.newPath);
    }
  });

  it("does not present a deferred fold as shipped", () => {
    const rows = routeDietDoc.split("\n");
    for (const deferred of ["/app/billing", "/app/notifications", "/app/source-access"]) {
      const row = rows.find((line) => line.startsWith("| `") && line.includes(`\`${deferred}\``));
      expect(row).toBeDefined();
      expect(row).toContain("deferred");
    }
  });

  // Issue #2724: folding a route moves the screen it lands on. The Gate-B
  // release-coverage registry pins the exact finalUrl of each release proof,
  // so a fold that skips the registry turns into a production deploy failure
  // (coverage_missing + coverage_unexpected_entry) hours later. Pin the two
  // together here, in the test that owns the fold contract.
  it("keeps release-coverage expectations off every folded-away path", async () => {
    // @ts-ignore JavaScript reporter module is intentionally exercised through Vitest.
    const { RELEASE_COVERAGE_MATRIX } = await import(
      "../scripts/playwright-release-manifest-reporter.mjs"
    );
    const expected = Object.values(RELEASE_COVERAGE_MATRIX).flat();
    expect(expected.length).toBeGreaterThan(0);
    const expectedPaths = expected.map((entry) => {
      const finalUrl = entry.finalUrl as { exact?: string; pathname?: string };
      return finalUrl.exact !== undefined ? finalUrl.exact.split("?")[0] : finalUrl.pathname;
    });
    for (const fold of SHIPPED_FOLDS) {
      expect(
        expectedPaths,
        `${fold.name}: release coverage still expects ${fold.oldPath}`,
      ).not.toContain(fold.oldPath);
    }
  });
});
