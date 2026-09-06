import { readFileSync, readdirSync, statSync } from "node:fs";
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
const GUARD = "isE2ETestRequestEnabled(";

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
    it(`${name} carries or inherits the ${GUARD}...) guard call`, () => {
      expect(isGuarded(readRoute(name), new Set([name]))).toBe(true);
    });
  }
});

describe("the fixture-session predicate fails closed (G1)", () => {
  it("requires env flag AND local host AND fixture id shape — every leg alone is refused", async () => {
    const { isE2EFixtureWorkspaceSession } = await import("~/lib/e2e-auth.server");
    const fixtureId = "e2e-session-e2e-starter";
    const localRequest = new Request("http://localhost/app/account");
    const prodRequest = new Request("https://0509.io/app/account");
    const on = { E2E_TEST_MODE: "1" } as never;
    const off = {} as never;

    expect(isE2EFixtureWorkspaceSession(on, localRequest, fixtureId)).toBe(true);
    expect(isE2EFixtureWorkspaceSession(off, localRequest, fixtureId)).toBe(false);
    expect(isE2EFixtureWorkspaceSession(on, prodRequest, fixtureId)).toBe(false);
    expect(isE2EFixtureWorkspaceSession(on, localRequest, "real-session-id")).toBe(false);
    expect(isE2EFixtureWorkspaceSession(off, prodRequest, fixtureId)).toBe(false);
  });
});

describe("/app/ops redirects out of the customer app (G4)", () => {
  it("301s to /ops", async () => {
    const { loader } = await import("~/routes/app.ops-redirect");
    const response = loader();
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/ops");
  });
});

describe("the bare fixture-id check stays out of product code (G1 gate)", () => {
  it("no route or component calls isE2ETestSessionId directly", () => {
    const APP_DIRS = ["routes", "components"].map((dir) =>
      join(__dirname, "..", "app", dir),
    );
    const offenders: string[] = [];
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) visit(full);
        else if (/\.(ts|tsx)$/.test(entry) && readFileSync(full, "utf8").includes("isE2ETestSessionId")) {
          offenders.push(full);
        }
      }
    };
    for (const dir of APP_DIRS) visit(dir);
    expect(offenders).toEqual([]);
  });
});

describe("behavioral fail-closed proof: e2e routes on a production host", () => {
  const prodContext = { cloudflare: { env: {} } } as never;

  it("every e2e route file's loader refuses a production-host request", async () => {
    // Derived from the directory, not a hand-kept list — a NEW e2e route is
    // covered the moment it exists (Sol's PR-2 review, item 2).
    const routes = readdirSync(join(__dirname, "..", "app", "routes"))
      .filter((name) => name.startsWith("api.e2e.") && name.endsWith(".ts"))
      .map((name) => `~/routes/${name.slice(0, -3)}`);
    expect(routes.length).toBeGreaterThanOrEqual(11);
    for (const path of routes) {
      const module = (await import(/* @vite-ignore */ path)) as {
        loader?: (args: unknown) => Promise<unknown>;
      };
      if (!module.loader) continue;
      const request = new Request("https://0509.io/api/e2e/anything");
      let status: number | null = null;
      try {
        const result = (await module.loader({
          context: prodContext,
          params: {},
          request,
        })) as Response;
        status = result?.status ?? null;
      } catch (thrown) {
        status = thrown instanceof Response ? thrown.status : null;
      }
      expect(status, path).not.toBeNull();
      expect(status ?? 0, path).toBeGreaterThanOrEqual(400);
    }
  });
});

describe("legacy /app/ops POSTs survive the extraction (G4)", () => {
  it("307s into /ops preserving the method", async () => {
    const { action } = await import("~/routes/app.ops-redirect");
    const response = action();
    expect(response.status).toBe(307);
    expect(response.headers.get("Location")).toBe("/ops");
  });
});
