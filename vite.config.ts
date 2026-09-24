import { readFileSync } from "node:fs";
import path from "node:path";
import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

function landingCriticalCss(): Plugin {
  return {
    name: "landing-critical-css",
    apply: "build",
    generateBundle(_options, bundle) {
      const css = Object.values(bundle).find((item) => {
        if (item.type !== "asset" || !item.fileName.endsWith(".css")) return false;
        const source = typeof item.source === "string" ? item.source : new TextDecoder().decode(item.source);
        return source.includes("@font-face") && source.includes("Bricolage Grotesque");
      });
      if (!css || css.type !== "asset") return;
      const source = typeof css.source === "string" ? css.source : new TextDecoder().decode(css.source);
      const face = readFileSync(path.resolve("app/components/landing/hero-face.css"), "utf8").trim();
      const critical = `${face}${source.replace(/@font-face\s*\{[^}]*\}/g, "")}`;
      const fullFace = ["/fonts/bricolage-grotesque-latin", "/fonts/instrument-sans", "/fonts/ibm-plex"];
      if (fullFace.some((file) => critical.includes(file))) {
        this.error("landing critical css still references a full font file");
      }
      this.emitFile({ type: "asset", fileName: "landing-critical.css", source: critical });
    },
  };
}

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
    landingCriticalCss(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
});
