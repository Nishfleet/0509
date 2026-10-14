import { readFileSync } from "node:fs";
import path from "node:path";

import type { Manifest } from "vite";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(path.join("build/client", ".vite", "manifest.json"), "utf8")) as Manifest;

const PAGES = [
  "app/routes/app.competitor.tsx?__react-router-build-client-route",
  "app/routes/app.alerts.tsx?__react-router-build-client-route",
  "app/routes/app.home.tsx?__react-router-build-client-route",
];

function reachableSources(entry: string): string[] {
  const seen = new Set<string>();
  const walk = (key: string): void => {
    if (seen.has(key) || !Object.hasOwn(manifest, key)) return;
    seen.add(key);
    for (const next of [...(manifest[key].imports ?? []), ...(manifest[key].dynamicImports ?? [])]) walk(next);
  };
  walk(entry);
  return [...seen].map((key) => readFileSync(path.join("build/client", manifest[key].file), "utf8"));
}

describe("signed-in pages stay free of the public suffix list", () => {
  it.each(PAGES)("%s does not ship tldts", (page) => {
    expect(Object.hasOwn(manifest, page)).toBe(true);
    for (const source of reachableSources(page)) expect(source).not.toContain("allowIcannDomains");
  });
});
