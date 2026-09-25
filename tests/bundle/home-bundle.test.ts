// 0509#4134
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { gzipSync } from "node:zlib";

import type { Manifest } from "vite";
import { describe, expect, it } from "vitest";

const HOME_ROUTES = ["app/routes/app-layout.tsx", "app/routes/app.home.tsx"];

const manifest = JSON.parse(
  readFileSync(path.join("build/client", ".vite", "manifest.json"), "utf8"),
) as Manifest;

const startKeys = Object.keys(manifest).filter((key) => {
  const chunk = manifest[key];
  if (chunk.isEntry !== true) return false;
  if (!key.startsWith("app/routes/")) return true;
  return HOME_ROUTES.some((route) => key.startsWith(route));
});

for (const route of HOME_ROUTES) {
  expect(startKeys.some((key) => key.startsWith(route))).toBe(true);
}

const files = (() => {
  const visited = new Set<string>();
  const collected: string[] = [];
  const queue = [...startKeys];
  while (queue.length > 0) {
    const key = queue.pop();
    if (key === undefined || visited.has(key)) continue;
    visited.add(key);
    if (!Object.hasOwn(manifest, key)) {
      throw new Error(`the build manifest has no chunk for ${key}`);
    }
    const chunk = manifest[key];
    collected.push(chunk.file);
    for (const imported of chunk.imports ?? []) queue.push(imported);
  }
  return collected;
})();

const homeBytes = files.reduce((total, file) => {
  return total + gzipSync(readFileSync(path.join("build/client", file))).length;
}, 0);

const chartBytes = (() => {
  const require = createRequire(import.meta.url);
  const uplot = readFileSync(path.join("node_modules/uplot/dist/uPlot.iife.min.js"));
  const uplotReact = readFileSync(require.resolve("uplot-react"));
  return gzipSync(uplot).length + gzipSync(uplotReact).length;
})();

const HOME_CEILING_KB = 170;

describe("Home bundle budgets", () => {
  it("keeps /app JavaScript within its ratchet ceiling", () => {
    console.log(
      `home-bundle /app js gzip=${(homeBytes / 1024).toFixed(1)} KB (ceiling ${HOME_CEILING_KB}, target 150)`,
    );
    expect(homeBytes).toBeLessThanOrEqual(HOME_CEILING_KB * 1024);
  });

  it("keeps the chart under 30 KB gzipped", () => {
    console.log(`home-bundle chart gzip=${(chartBytes / 1024).toFixed(1)} KB (budget 30)`);
    expect(chartBytes).toBeLessThanOrEqual(30 * 1024);
  });
});
