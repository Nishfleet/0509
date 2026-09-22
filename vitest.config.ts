import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Deliberately a separate config from vite.config.ts.
//
// vitest picks up vite.config.ts by default, which carries the cloudflare()
// BUILD plugin. That plugin puts the app's Worker entry inside the test runner
// and the runner then evaluates it as CommonJS, giving
// "ReferenceError: module is not defined at workers/runner-worker/index.js:107".
// The build plugin and the test plugin are different things; only
// cloudflareTest() belongs here.
export default defineConfig({
  test: {
    projects: [
      {
        // Pure logic: no bindings, no workerd.
        test: {
          name: "node",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          // This file needs the workers project's D1. Running it here has no DB.
          exclude: ["tests/integration/**", "tests/mentions/disabled-source.test.ts"],
        },
      },
      {
        // Real workerd + real local D1. setupFiles applies every file in migrations/.
        // The only project where a D1 assertion means anything.
        // tests/mentions/disabled-source.test.ts lives on the issue's path and
        // still has to run here, because the node project has no D1 binding.
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./tests/integration/wrangler.test.jsonc" },
            miniflare: {
              bindings: { TEST_MIGRATIONS: await readD1Migrations("migrations") },
            },
          })),
        ],
        test: {
          name: "workers",
          include: [
            "tests/integration/**/*.integration.test.ts",
            "tests/mentions/disabled-source.test.ts",
          ],
          setupFiles: ["./tests/integration/apply-migrations.ts"],
          testTimeout: 30_000,
        },
      },
      {
        // The J1 mail-sink Worker (0509#3927): real workerd + real local KV.
        // Its token gate and email handler run against the same binding kinds
        // production has — a broken gate fails in a merge gate, not in CI's
        // production lane.
        plugins: [
          cloudflareTest(() => ({
            wrangler: { configPath: "./tests/integration/wrangler.e2e-inbox.test.jsonc" },
          })),
        ],
        test: {
          name: "e2e-inbox",
          include: ["tests/integration/e2e-inbox.test.ts"],
          testTimeout: 30_000,
        },
      },
    ],
  },
});
