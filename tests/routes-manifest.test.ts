import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import routeConfig from "~/routes";

/**
 * Route-manifest gate (issue #2249, defect B).
 *
 * `app/routes.ts` is explicit `route()` configuration — a file under
 * `app/routes/` is NOT served unless it is registered here. The
 * capture-failures endpoint (`api.ads.capture-failures.$domain.ts`) existed
 * on disk and was lazy-fetched by the `/ads/:domain` page but was never
 * mounted, so the "What we checked, even when it didn't alert" expander 404'd
 * on every brand page.
 *
 * This test catches the whole class: every `api.*.ts` / `api.*.tsx` file under
 * `app/routes/` must appear in the registered route manifest. On main it names
 * `api.ads.capture-failures.$domain.ts` (and any sibling) as unmounted; on the
 * branch the manifest is complete and the test passes.
 */

const ROUTES_DIR = join(process.cwd(), "app", "routes");

function collectFiles(entries: typeof routeConfig, acc: Set<string> = new Set()): Set<string> {
  for (const entry of entries) {
    if (entry.file) acc.add(entry.file);
    if (entry.children) collectFiles(entry.children, acc);
  }
  return acc;
}

function apiRouteFiles(): string[] {
  return readdirSync(ROUTES_DIR)
    .filter((name) => name.startsWith("api.") && (name.endsWith(".ts") || name.endsWith(".tsx")))
    .sort();
}

describe("route manifest — every api.* route file is mounted", () => {
  it("registers all api.* route files in app/routes.ts", () => {
    const mounted = collectFiles(routeConfig);
    const onDisk = apiRouteFiles();

    const unmounted = onDisk
      .map((name) => `routes/${name}`)
      .filter((ref) => !mounted.has(ref));

    expect(unmounted).toEqual([]);
  });

  it("mounts the capture-failures endpoint at the path the ads page fetches", () => {
    // The /ads/:domain page lazy-fetches `/api/ads/capture-failures/:domain`
    // (app/routes/ads.$domain.tsx). The registered path must match that URL
    // shape so the expand resolves instead of 404'ing.
    const mounted = collectFiles(routeConfig);
    expect(mounted.has("routes/api.ads.capture-failures.$domain.ts")).toBe(true);

    const entry = routeConfig.find(
      (e) => e.file === "routes/api.ads.capture-failures.$domain.ts",
    );
    expect(entry?.path).toBe("api/ads/capture-failures/:domain");
  });
});
