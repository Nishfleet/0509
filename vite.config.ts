import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

// https://github.com/Nishfleet/0509/issues/6087
// https://github.com/cloudflare/workers-sdk/pull/15497
const forcedOutput: Plugin = {
  name: "forced-output-assets",
  applyToEnvironment: (environment) => environment.name === "client",
  writeBundle() {
    const { root, build } = this.environment.config;
    const destination = path.join(root, "build/client/.vite");
    mkdirSync(destination, { recursive: true });
    cpSync(path.resolve(root, build.outDir, ".vite/manifest.json"), path.join(destination, "manifest.json"));
  },
  buildApp: {
    order: "post",
    handler(builder) {
      const output = path.join(builder.config.root, ".cloudflare/output/v0/workers/default");
      const assets = path.join(output, "assets");
      cpSync(path.join(builder.config.root, "build/client"), assets, { recursive: true, force: false });
      const bundle = path.join(output, "bundle/assets");
      const missing = new Set<string>();
      for (const file of readdirSync(bundle).filter((name) => /^server-build-.*\.js$/.test(name))) {
        const urls = readFileSync(path.join(bundle, file), "utf8").matchAll(/"(\/[\w./-]+\.(?:js|css))"/g);
        for (const [, url] of urls) if (url && !existsSync(path.join(assets, url))) missing.add(url);
      }
      if (missing.size > 0)
        return Promise.reject(
          new Error(`the server build references assets that are not uploaded: ${[...missing].join(", ")}`),
        );
      return Promise.resolve();
    },
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
    ...(process.env.CLOUDFLARE_VITE_FORCE_BUILD_OUTPUT ? [forcedOutput] : []),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
});
