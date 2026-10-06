import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { lintTextAt } from "./eslint-lint-text";

const ROOT = path.resolve(import.meta.dirname, "..");

interface Tsconfig {
  include?: string[];
  exclude?: string[];
  references?: { path: string }[];
}

function readTsconfig(name: string): Tsconfig {
  return JSON.parse(readFileSync(path.join(ROOT, name), "utf8")) as Tsconfig;
}

const FLOATING = `export async function probe(): Promise<number> {
  return await Promise.resolve(1);
}
probe();
`;

describe("tsconfig.test.json (#7073, #7183)", () => {
  it("is a referenced project so tsc -b typechecks tests, e2e and configs", () => {
    const root = readTsconfig("tsconfig.json");
    const paths = (root.references ?? []).map((reference) => reference.path);
    expect(paths).toContain("./tsconfig.test.json");
    const testProject = readTsconfig("tsconfig.test.json");
    expect(testProject.include).toEqual(expect.arrayContaining(["tests/**/*.ts", "e2e/**/*.ts", "*.config.ts"]));
    const skipped = (testProject.exclude ?? []).filter((entry) => entry.startsWith("tests/"));
    expect(skipped.length).toBe(74);
  });

  it("type-aware lint flags a floating promise in e2e", { timeout: 60_000 }, async () => {
    const result = await lintTextAt("e2e/smoke.spec.ts", FLOATING);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((message) => message.includes("must be awaited"))).toBe(true);
  });
});
