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
          exclude: ["tests/integration/**"],
        },
      },
      {
        // Real workerd + real local D1 with migrations/0001_rebuild.sql applied.
        // The only project where a D1 assertion means anything.
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
          include: ["tests/integration/**/*.integration.test.ts"],
          setupFiles: ["./tests/integration/apply-migrations.ts"],
          testTimeout: 30_000,
        },
      },
    ],
  },
});
