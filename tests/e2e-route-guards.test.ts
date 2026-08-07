import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * G2 (tri-audit safety): eleven `api/e2e/*` routes ship in the production
 * route table. Their protection is the `isE2ETestRequestEnabled` guard
 * (env flag + local-host check + database sentinel, fail closed), but that
 * guard lives INSIDE the modules — invisible from `routes.ts`. This test
 * makes the invariant structural: every e2e route file must carry the
 * guard itself, delegate to a `~/lib/e2e-*.server` module that carries it,
 * or re-export from another e2e route that does. A new e2e route without a
 * guard fails this test before it can ship.
 */

const ROUTES_DIR = join(__dirname, "..", "app", "routes");
const LIB_DIR = join(__dirname, "..", "app", "lib");
const GUARD = "isE2ETestRequestEnabled";

function readRoute(name: string): string {
  return readFileSync(join(ROUTES_DIR, name), "utf8");
}

function isGuarded(source: string, seen = new Set<string>()): boolean {
  if (source.includes(GUARD)) return true;

  const libModules = [...source.matchAll(/~\/lib\/(e2e-[a-z0-9.-]+)\.server/g)].map(
    (match) => `${match[1]}.server.ts`,
  );
  for (const module of libModules) {
    if (seen.has(module)) continue;
    seen.add(module);
    const moduleSource = readFileSync(join(LIB_DIR, module), "utf8");
    if (moduleSource.includes(GUARD)) return true;
  }

  const reExports = [...source.matchAll(/~\/routes\/(api\.e2e\.[a-z0-9.-]+)"/g)].map(
    (match) => `${match[1]}.ts`,
  );
  for (const route of reExports) {
    if (seen.has(route)) continue;
    seen.add(route);
    if (isGuarded(readRoute(route), seen)) return true;
  }

  return false;
}

describe("every api/e2e route is fail-closed", () => {
  const e2eRoutes = readdirSync(ROUTES_DIR).filter(
    (name) => name.startsWith("api.e2e.") && name.endsWith(".ts"),
  );

  it("finds the e2e route surface", () => {
    expect(e2eRoutes.length).toBeGreaterThanOrEqual(11);
  });

  for (const name of e2eRoutes) {
    it(`${name} carries or inherits the ${GUARD} guard`, () => {
      expect(isGuarded(readRoute(name), new Set([name]))).toBe(true);
    });
  }
});
