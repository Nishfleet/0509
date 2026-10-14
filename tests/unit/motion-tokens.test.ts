import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "app");
const BUDGET_MS = new Set([140, 160, 180, 220, 280, 320, 380]);

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(APP, ...parts), "utf8");
}

async function tsxFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return tsxFiles(full);
      return entry.name.endsWith(".tsx") ? [full] : [];
    }),
  );
  return nested.flat();
}

describe.each([
  ["dialog", "components/ui/dialog.tsx"],
  ["popover", "components/ui/popover.tsx"],
])("the %s surface", (_name, file) => {
  it("fades and never zooms, slides, rounds, shadows or blurs", async () => {
    const css = await source(...file.split("/"));
    expect(css).toContain("fade-in-0");
    expect(css).toContain("fade-out-0");
    expect(css).not.toMatch(
      /zoom-(in|out)|slide-(in|out)|rounded-(sm|md|lg|xl|2xl|3xl|4xl)\b|shadow-|backdrop-blur|ring-1/,
    );
    expect(css).toContain("rounded-none");
  });
});

describe("transition durations in the app", () => {
  it("only use durations from the §9 motion budget", async () => {
    const offenders: string[] = [];
    for (const file of await tsxFiles(APP)) {
      const text = await readFile(file, "utf8");
      for (const match of text.matchAll(/\bduration-(\d+)\b/g)) {
        if (!BUDGET_MS.has(Number(match[1]))) offenders.push(`${path.relative(APP, file)}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("ease every colour transition on a link along the push curve or a linear fade", async () => {
    for (const file of ["components/footer.tsx", "components/site-header.tsx", "components/landing/header.tsx"]) {
      expect(await source(...file.split("/"))).toMatch(/transition-colors duration-140 ease-push/);
    }
  });

  it("runs the shared switch track and thumb at 180ms on the push curve", async () => {
    const css = await source("components", "ui", "switch.tsx");
    expect(css).toMatch(/transition-colors duration-180 ease-push/);
    expect(css).toMatch(/transition-transform duration-180 ease-push/);
    expect(css).not.toMatch(/transition-all/);
  });
});
