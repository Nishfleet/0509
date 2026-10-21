import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";

import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

// https://github.com/Nishfleet/0509/issues/6087
// https://github.com/cloudflare/workers-sdk/pull/15497
const clientManifestBridge: Plugin = {
  name: "client-manifest-bridge",
  applyToEnvironment: (environment) => environment.name === "client",
  writeBundle() {
    const { root, build } = this.environment.config;
    const destination = path.join(root, "build/client/.vite");
    mkdirSync(destination, { recursive: true });
    cpSync(path.resolve(root, build.outDir, ".vite/manifest.json"), path.join(destination, "manifest.json"));
  },
};

export default defineConfig({
  build: { manifest: true },
  // Worker (ssr) bundle only: wrangler.jsonc's upload_source_maps ships the
  // maps to Cloudflare for stack traces and the profiler, but it can only
  // upload maps the build wrote. The client build stays map-free so no map is
  // served from the public assets.
  environments: { ssr: { build: { sourcemap: true } } },
  plugins: [
    ...(process.env.CLOUDFLARE_VITE_FORCE_BUILD_OUTPUT ? [clientManifestBridge] : []),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
});
