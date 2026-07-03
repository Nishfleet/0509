import { createRequire } from "node:module";
import path from "node:path";

import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const require = createRequire(import.meta.url);
const reactRouterDevRoot = path.dirname(require.resolve("@react-router/dev/package.json"));

export default defineConfig(({ mode }) => ({
  plugins:
    mode === "test"
      ? [tsconfigPaths()]
      : [cloudflare({ viteEnvironment: { name: "ssr" } }), reactRouter(), tsconfigPaths()],
  server: {
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd()), reactRouterDevRoot],
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 10_000,
  },
}));
