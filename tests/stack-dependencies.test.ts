import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// CLAUDE.md: "Adding a dependency that is not in that file is a rejection."
// A reviewer enforced it until Nish 2026-09-28 16:47Z asked for the lean-code
// rules as hard blocks (0509#5783). Every dependency, of every kind, in every
// package.json the repo tracks needs its own approving row in
// docs/REBUILD-STACK.md §9: `| \`<name>\` | <specifier> |` (any run of spaces around the pipes: Prettier aligns tables). A mention in prose
// or in a "Rejected" table does not count.
//
// 0509#7085 (item 3): the row check proved a row existed and nothing about its
// numbers, so §9 drifted from package.json and package-lock.json unnoticed —
// `@types/node` named the wrong specifier and lock, `@sentry/cloudflare` the
// wrong lock. §9's own prose says "The version in this table is the
// `package.json` specifier", and the Lock column "the resolved version", so
// both columns are now checked against the files they copy. A drifted row is a
// lie about what ships.

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

const rootPackage = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as PackageJson;

const lock = JSON.parse(readFileSync(path.join(ROOT, "package-lock.json"), "utf8")) as {
  packages?: Record<string, { version?: string }>;
};

const stack = readFileSync(path.join(ROOT, "docs/REBUILD-STACK.md"), "utf8");

const approvedRow = (name: string): RegExp =>
  new RegExp(`^\\| \`${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\` +\\| +[\\^~]?\\d`, "m");

// The §9 table lives under "## 9. Every package.json dependency"; its header is
// the first `| Package | Specifier | ... | Lock |` row after that heading. Cells
// are read by position, so every data row must have the six columns the header
// declares.
interface StackRow {
  name: string;
  specifier: string;
  locked: string;
}

function stackRows(): Map<string, StackRow> {
  const lines = stack.split("\n");
  const heading = lines.findIndex((line) => /^## 9\. Every package\.json dependency/.test(line));
  const header = lines.findIndex((line, at) => at > heading && /^\|\s*Package\s*\|/.test(line));
  expect(heading, "docs/REBUILD-STACK.md has no §9 heading").toBeGreaterThanOrEqual(0);
  expect(header, "docs/REBUILD-STACK.md §9 has no `| Package |` header row").toBeGreaterThan(heading);

  const rows = new Map<string, StackRow>();
  for (let at = header + 2; at < lines.length; at += 1) {
    const line = lines[at];
    if (!line.trim().startsWith("|")) break;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    expect(cells.length, `§9 row ${at + 1} has ${cells.length} columns, not 6`).toBe(6);
    const name = cells[0].replace(/^`|`$/g, "");
    rows.set(name, { name, specifier: cells[1], locked: cells[5] });
  }
  return rows;
}

const rows = stackRows();

// package-lock.json resolves every direct dependency of the root manifest to
// `node_modules/<name>` at lockfileVersion 3.
const resolved = (name: string): string | undefined => lock.packages?.[`node_modules/${name}`]?.version;

const directDependencies = KINDS.flatMap((kind) => Object.entries(rootPackage[kind] ?? {}));

describe("docs/REBUILD-STACK.md §9", () => {
  it.each([...new Set(names)])("approves %s in its own row", (name) => {
    expect(approvedRow(name).test(stack), `${name} has no approving row in docs/REBUILD-STACK.md §9`).toBe(true);
  });

  it.each(directDependencies)("names the package.json specifier for %s", (name, specifier) => {
    const row = rows.get(name);
    expect(row, `${name} has no §9 row`).toBeDefined();
    expect(row?.specifier, `${name} §9 Specifier drifted from package.json`).toBe(specifier);
  });

  it.each(directDependencies)("names the resolved lockfile version for %s", (name) => {
    const row = rows.get(name);
    const version = resolved(name);
    expect(version, `package-lock.json has no node_modules/${name} entry`).toBeDefined();
    expect(row?.locked, `${name} §9 Lock drifted from package-lock.json`).toBe(version);
  });
});
