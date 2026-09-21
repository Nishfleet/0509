import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

/**
 * The migrations lane's floor.
 *
 * REBUILD P2 C3 (#3862) deleted every integration suite that asserted against
 * pre-rebuild tables, which left the `workers` vitest project matching zero
 * files — and vitest exits 1 on "No test files found". A project that matches
 * nothing is either a red build or, with passWithNoTests, a gate that cannot
 * fail. Neither is acceptable, so this is the one assertion that holds while
 * the suites are rewritten against the new schema in P3.
 *
 * It deliberately pins no table and no filename. The chain is replaced
 * wholesale by migrations/0001_rebuild.sql in C4 (#3863), and a test naming
 * either would have to be edited in the same breath — which is exactly how the
 * previous version of this file ended up pinning a migration name that was
 * already applied in production.
 *
 * What it does assert: the setup file's migrations actually applied, and the
 * database is reachable from workerd. That is the floor the lane exists for.
 */
describe("migrations", () => {
  it("apply to a real local D1 and record themselves", async () => {
    const applied = await env.DB.prepare(
      "SELECT count(*) AS n FROM d1_migrations",
    ).first<{ n: number }>();

    expect(applied?.n ?? 0).toBeGreaterThan(0);
  });

  it("leave a queryable schema behind", async () => {
    const tables = await env.DB.prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    ).first<{ n: number }>();

    expect(tables?.n ?? 0).toBeGreaterThan(0);
  });
});
