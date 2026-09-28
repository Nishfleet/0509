import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// CLAUDE.md: "Adding a dependency that is not in that file is a rejection."
// A reviewer enforced it until Nish 2026-09-28 16:47Z asked for the lean-code
// rules as hard blocks (0509#5783). Every package.json dependency is named, in
// backticks, in docs/REBUILD-STACK.md beside the vendor doc that justifies it.

const ROOT = path.resolve(import.meta.dirname, "..");

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as PackageJson;
const stack = readFileSync(path.join(ROOT, "docs/REBUILD-STACK.md"), "utf8");
const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];

describe("docs/REBUILD-STACK.md", () => {
  it.each(names)("names %s", (name) => {
    expect(stack.includes(`\`${name}\``), `${name} is not in docs/REBUILD-STACK.md`).toBe(true);
  });
});
