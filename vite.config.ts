import { createRequire } from "node:module";
import path from "node:path";

import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { resolveLocalReleaseCloudflareInspectorPort } from "./scripts/local-release-server.mjs";

const require = createRequire(import.meta.url);

// Vitest only defaults NODE_ENV to "test" when it is unset (`NODE_ENV ??=` in
// prepareVitest), so an inherited NODE_ENV=production survives into config
// evaluation and vite's environment setup in the main process — the
// `test.env` pin below only reaches the pool workers. Two failures follow:
// react@19.2.8 resolves its production build, whose `act` export is undefined
// ("act is not a function"), and happy-dom suites that import `node:*`
// modules get them browser-externalized by vite's client environment
// ("No such built-in module: node:"). Normalize it for vitest processes only;
// dev/build/preview never set VITEST and are untouched.
if (process.env.VITEST === "true") {
  process.env.NODE_ENV = "test";
}
const reactRouterDevRoot = path.dirname(require.resolve("@react-router/dev/package.json"));
const e2ePersistPath = process.env.E2E_PERSIST_PATH ?? ".wrangler/e2e-state";
const isE2ETestMode = String(process.env.E2E_TEST_MODE) === "1";
const isBl034Capture = String(process.env.BL034_CAPTURE) === "1";
const e2eOrigin = process.env.APP_ORIGIN ?? "http://127.0.0.1:4179";
const e2eBetterAuthSecret =
  process.env.BETTER_AUTH_SECRET ??
  "7f2c0cb9d8f541dfb58d94397b67953f37a3843cd9dd4fb582ec912b4db67093";
// E2E test mode disables the Cloudflare plugin's inspector port selection so
// the dev server never enumerates host interfaces at boot (`os.networkInterfaces`
// can abort boot on hardened runners with `uv_interface_addresses ... system
// error 97`). Manual `npm run dev` keeps the default inspector.
const cloudflareInspectorPort = resolveLocalReleaseCloudflareInspectorPort();

// The `workers` vitest project runs `tests/integration/**` on real workerd via
// Miniflare, against a real local D1 built by applying the repo's real
// `migrations/*.sql`. Reading those files has to happen here, in Node, because
// workerd has no filesystem — they reach the setup file through the test-only
// `TEST_MIGRATIONS` binding.
//
// Only read them under vitest: `npm run dev`, `build` and `preview` must not
// pay for 70+ file reads they never use.
const INTEGRATION_TEST_GLOB = "tests/integration/**/*.integration.test.ts";

export default defineConfig(async ({ mode }) => ({
  plugins:
    mode === "test"
      ? [tsconfigPaths()]
      : [
          cloudflare({
            ...(isE2ETestMode
              ? {
                  configPath: "./wrangler.e2e.jsonc",
                  config: {
                    vars: {
                      APP_ORIGIN: e2eOrigin,
                      BETTER_AUTH_URL: e2eOrigin,
                      BETTER_AUTH_SECRET: e2eBetterAuthSecret,
                      E2E_PROVIDER_NETWORK_DENY: "1",
                      E2E_TEST_MODE: "1",
                      ...(isBl034Capture
                        ? { PRESENCE_WEBSITE_ROLLOUT: "pilot" }
                        : {}),
                    },
                  },
                }
              : {}),
            persistState: isE2ETestMode ? { path: e2ePersistPath } : true,
            inspectorPort: cloudflareInspectorPort,
            viteEnvironment: { name: "ssr" },
          }),
          reactRouter(),
          tsconfigPaths(),
        ],
  server: {
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd()), reactRouterDevRoot],
    },
  },
  test: {
    projects: [
      {
        // The historical suite: plain Vitest on node. `extends: true` keeps the
        // root config's plugins (tsconfigPaths) and resolution identical to
        // what it was before projects existed.
        extends: true,
        test: {
          name: "node",
          environment: "node",
          // Vitest only defaults NODE_ENV to "test" when it is unset; an
          // inherited NODE_ENV=production makes react@19 resolve its
          // production build, whose `act` export is undefined ("act is not a
          // function"). Pin it so a leaked NODE_ENV from a caller's shell or
          // CI cannot break the suite.
          env: { NODE_ENV: "test" },
          include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
          // Integration suites belong to the `workers` project below; running
          // them on node would silently skip the real runtime.
          exclude: [INTEGRATION_TEST_GLOB],
          testTimeout: 10_000,
        },
      },
      {
        // Real workerd (via Miniflare) + real local D1 with the repo's real
        // migrations applied. This is the only project where a D1 assertion
        // means anything: everything else mocks the binding.
        extends: true,
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./tests/integration/wrangler.test.jsonc" },
            miniflare: {
              // Test-only binding: the setup file applies these inside workerd.
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations(
                  path.join(import.meta.dirname, "migrations"),
                ),
              },
            },
          })),
        ],
        test: {
          name: "workers",
          include: [INTEGRATION_TEST_GLOB],
          setupFiles: ["./tests/integration/apply-migrations.ts"],
          // Applying 70+ migrations to a fresh local D1 costs more than a unit
          // test's 10s budget on a loaded CI runner.
          testTimeout: 30_000,
        },
      },
    ],
  },
}));
