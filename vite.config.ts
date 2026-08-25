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

// The D1 migrations are read once at config-evaluation time (in Node) and
// threaded into the workerd test isolate as a TEST_MIGRATIONS binding, so the
// `tests/integration/setup-d1.ts` setup file can call `applyD1Migrations()`
// against the real workerd-backed D1 binding. Reading here keeps the workerd
// project self-contained: no test file reaches the filesystem for migrations.
const d1Migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));

export default defineConfig(({ mode }) => ({
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
    // Vitest only defaults NODE_ENV to "test" when it is unset; an inherited
    // NODE_ENV=production makes react@19 resolve its production build, whose
    // `act` export is undefined ("act is not a function"). Pin it so a leaked
    // NODE_ENV from a caller's shell or CI cannot break the suite.
    env: { NODE_ENV: "test" },
    testTimeout: 10_000,
    projects: [
      // The existing plain-Vitest suite — node environment, mocks, no workerd.
      // Behaviour and include set are unchanged from the pre-project config;
      // this project is what every existing `tests/**/*.test.ts(x)` file runs
      // under. Splitting it out as its own project is what lets the workerd
      // integration project run alongside it without imposing the Workers
      // runtime on suites that import `node:*` built-ins.
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
          exclude: ["tests/integration/**"],
        },
      },
      // Real workerd + real local D1, via @cloudflare/vitest-plugin. Tests in
      // `tests/integration/` run inside the Workers runtime with the `DB` D1
      // binding from `wrangler.jsonc`, migrations applied per-test-file by the
      // shared setup file. This is the surface that turns a schema migration
      // from an unverifiable change class into a verifiable one (recos §1.5).
      {
        extends: true,
        test: {
          name: "workerd-d1",
          // No `environment` here: @cloudflare/vitest-plugin supplies its own
          // Workers runtime environment and rejects a custom one. Setting one
          // is a hard error, not a warning.
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["./tests/integration/setup-d1.ts"],
          testTimeout: 30_000,
        },
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            // Local-only: `wrangler.jsonc` carries a real D1 `database_id`,
            // which the plugin treats as a remote binding and would proxy to
            // the real Cloudflare account (needing CLOUDFLARE_API_TOKEN). The
            // integration suite runs entirely against local workerd D1
            // (Miniflare), seeded by `applyD1Migrations()` in the setup file,
            // so disable the remote proxy.
            remoteBindings: false,
            miniflare: {
              // Test-only binding carrying the migration blobs read above; the
              // setup file applies them to `env.DB` via `applyD1Migrations()`.
              bindings: { TEST_MIGRATIONS: d1Migrations },
            },
          }),
        ],
      },
    ],
  },
}));
