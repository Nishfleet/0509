import path from "node:path";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Workers-runtime integration suite (P10-A job 1).
 *
 * Runs a focused set of D1 integration tests on real workerd via Miniflare
 * (per-file isolated storage), applying the real `migrations/*.sql` chain to
 * a fresh local D1 in a setup file. Kept in a dedicated config so the 461
 * existing node-env Vitest suites in `vite.config.ts` are untouched.
 *
 * `@cloudflare/vitest-pool-workers` was renamed to `@cloudflare/vitest-plugin`
 * on 2026-08-19; `cloudflare:test` and `cloudflare:workers` are the current
 * module names. Do not regress to `SELF.fetch` / `vitest-pool-workers`.
 *
 * Boundings are deliberately minimal: only the `DB` D1 binding plus a
 * test-only `TEST_MIGRATIONS` binding carrying the parsed migration array.
 * No `browser`/`ai`/`send_email`/`r2`/workflow bindings — this is the D1
 * layer only, so a missing paid provider can never fail the suite.
 */
export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrationsPath = path.join(process.cwd(), "migrations");
      const migrations = await readD1Migrations(migrationsPath);
      return {
        miniflare: {
          d1Databases: { DB: "0509" },
          bindings: { TEST_MIGRATIONS: migrations },
        },
      };
    }),
    tsconfigPaths(),
  ],
  test: {
    include: ["tests/integration-d1/**/*.test.ts"],
    setupFiles: ["./tests/integration-d1/setup.ts"],
    testTimeout: 30_000,
  },
});
