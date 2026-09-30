import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// CLAUDE.md: "Adding a dependency that is not in that file is a rejection."
// A reviewer enforced it until Nish 2026-09-28 16:47Z asked for the lean-code
// rules as hard blocks (0509#5783). Every dependency, of every kind, in every
// package.json the repo tracks needs its own approving row in
// docs/REBUILD-STACK.md §9: `| \`<name>\` | <specifier> |` (any run of spaces around the pipes: Prettier aligns tables). A mention in prose
// or in a "Rejected" table does not count.

const ROOT = path.resolve(import.meta.dirname, "..");
const KINDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

type PackageJson = Partial<Record<(typeof KINDS)[number], Record<string, string>>>;

const manifests = globSync("**/package.json", {
  cwd: ROOT,
  exclude: (file) => file.includes("node_modules") || file.startsWith(".") || file.startsWith("build"),
});

const names = manifests.flatMap((file) => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, file), "utf8")) as PackageJson;
  return KINDS.flatMap((kind) => Object.keys(pkg[kind] ?? {}));
});

const stack = readFileSync(path.join(ROOT, "docs/REBUILD-STACK.md"), "utf8");
const approvedRow = (name: string): RegExp =>
  new RegExp(`^\\| \`${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\` +\\| +[\\^~]?\\d`, "m");

describe("docs/REBUILD-STACK.md §9", () => {
  it.each([...new Set(names)])("approves %s in its own row", (name) => {
    expect(approvedRow(name).test(stack), `${name} has no approving row in docs/REBUILD-STACK.md §9`).toBe(true);
  });
});
