import { createRequire } from "node:module";
import path from "node:path";

import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const require = createRequire(import.meta.url);
const reactRouterDevRoot = path.dirname(require.resolve("@react-router/dev/package.json"));
const e2ePersistPath = process.env.E2E_PERSIST_PATH ?? ".wrangler/e2e-state";
const isE2ETestMode = String(process.env.E2E_TEST_MODE) === "1";
// The local release server runs a loopback-only, inspector-disabled contract
// (scripts/local-release-server.mjs). @cloudflare/vite-plugin only calls
// os.networkInterfaces() at boot to find a free DevTools inspector port
// (getInputInspectorPort -> getPorts -> getLocalHosts). That call throws
// `uv_interface_addresses ... system error 97` (EAFNOSUPPORT) on the hardened
// self-hosted runners, killing the server before the first journey. Setting
// `inspectorPort: false` skips that path deterministically instead of relying
// on retries, and the E2E proof never used the inspector anyway.
const isE2ELoopbackContract =
  isE2ETestMode || process.env.E2E_VITE_NO_INSPECTOR === "1";
const isBl034Capture = String(process.env.BL034_CAPTURE) === "1";
const isVerificationLane = Boolean(process.env.DEPLOY_WINDOW_VERIFY_SLOT);
const e2eOrigin = process.env.APP_ORIGIN ?? "http://127.0.0.1:4179";
const e2eBetterAuthSecret =
  process.env.BETTER_AUTH_SECRET ??
  "7f2c0cb9d8f541dfb58d94397b67953f37a3843cd9dd4fb582ec912b4db67093";

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
            ...(isE2ELoopbackContract ? { inspectorPort: false } : {}),
            persistState: isE2ETestMode ? { path: e2ePersistPath } : true,
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
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    testTimeout: 10_000,
    maxWorkers: isVerificationLane ? 1 : undefined,
    fileParallelism: !isVerificationLane,
  },
}));
