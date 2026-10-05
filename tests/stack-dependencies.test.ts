import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// CLAUDE.md: "Adding a dependency that is not in that file is a rejection."
// A reviewer enforced it until Nish 2026-09-28 16:47Z asked for the lean-code
// rules as hard blocks (0509#5783). Every dependency, of every kind, in every
// package.json the repo tracks needs its own approving row in
// docs/dependencies.md: `| `<name>` | <specifier> |` (any run of spaces around
// the pipes: Prettier aligns tables). A mention in prose or in a "Rejected"
// table does not count.
//
// 0509#7017: the table used to sit in docs/REBUILD-STACK.md §9, inside a 190 KB
// file of 2026-09 probe notes, and the old read matched a row anywhere in that
// file, so a row buried in research §1-8 satisfied the gate. It is its own file
// now, and the second describe is what stops it going back into one.

const ROOT = path.resolve(import.meta.dirname, "..");
const ALLOWLIST = "docs/dependencies.md";
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

// One approving row, whatever the name: | `name` | <specifier that starts with
// a digit, after an optional ^ or ~>. The same shape `approvedRow` looks for,
// without the name, so a doc that grows the table again is caught. The
// specifier cell must be one token: that is what tells an approving row from
// the probe-result tables elsewhere (| `https://...` | 200, `image/x-icon` |),
// whose second cell starts with a digit too.
const approvingRow = /^\| `[^`]+` +\| +[\^~]?\d[^\s|]* *\|/m;

const allowlist = readFileSync(path.join(ROOT, ALLOWLIST), "utf8");
const approvedRow = (name: string): RegExp =>
  new RegExp(`^\\| \`${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\` +\\| +[\\^~]?\\d`, "m");

describe(ALLOWLIST, () => {
  it.each([...new Set(names)])("approves %s in its own row", (name) => {
    expect(approvedRow(name).test(allowlist), `${name} has no approving row in ${ALLOWLIST}`).toBe(true);
  });
});

describe("the allowlist lives in one file", () => {
  const otherDocs = globSync("**/*.md", {
    cwd: ROOT,
    exclude: (file) => file.includes("node_modules") || file.startsWith(".") || file.startsWith("build"),
  }).filter((file) => file !== ALLOWLIST);

  it.each(otherDocs)("%s holds no approving row", (file) => {
    expect(approvingRow.test(readFileSync(path.join(ROOT, file), "utf8"))).toBe(false);
  });

  it.each(["CLAUDE.md", "README.md", "docs/REBUILD-STACK.md"])("%s points at the allowlist", (doc) => {
    expect(readFileSync(path.join(ROOT, doc), "utf8")).toContain(ALLOWLIST);
  });
});
