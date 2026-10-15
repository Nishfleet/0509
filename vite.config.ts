import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  build: { manifest: true },
  // Worker (ssr) bundle only: wrangler.jsonc's upload_source_maps ships the
  // maps to Cloudflare for stack traces and the profiler, but it can only
  // upload maps the build wrote. The client build stays map-free so no map is
  // served from the public assets.
  environments: { ssr: { build: { sourcemap: true } } },
  plugins: [cloudflare({ viteEnvironment: { name: "ssr" } }), tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
});
