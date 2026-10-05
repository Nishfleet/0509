import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// AGENTS.md: "Adding a dependency that is not in that file is a rejection."
// A reviewer enforced it until Nish 2026-09-28 16:47Z asked for the lean-code
// rules as hard blocks (0509#5783). Every dependency, of every kind, in every
// package.json the repo tracks needs its own approving row in
// docs/dependencies.md: `| `<name>` | <specifier> |` (any run of spaces around the pipes: Prettier aligns tables). A mention in prose
// or in a "Rejected" table does not count.
//
// 0509#7017: the table used to sit in docs/REBUILD-STACK.md §9, inside a 190 KB
// file of 2026-09 probe notes, and the old read matched a row anywhere in that
// file, so a row buried in research §1-8 satisfied the gate. It is its own file
// now, and the second describe is what stops it going back into one.
//
// 0509#7085 (item 3): the row check proved a row existed and nothing about its
// numbers, so the table drifted from package.json and package-lock.json
// unnoticed — `@types/node` named the wrong specifier and the wrong lock,
// `@sentry/cloudflare` the wrong lock. The table's own prose says "The version
// in this table is the `package.json` specifier", and the Lock column is "the
// resolved version", so both columns are now checked against the files they
// copy. A drifted row is a lie about what ships. It drifted back into prose
// inside a 190 KB file; it drifts just as quietly in its own 81-line file, so
// the number checks outlive the move that made the file readable.

const ROOT = path.resolve(import.meta.dirname, "..");
const ALLOWLIST = "docs/dependencies.md";
const KINDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

type PackageJson = Partial<Record<(typeof KINDS)[number], Record<string, string>>>;

const manifests = globSync("**/package.json", {
  cwd: ROOT,
  exclude: (file) => file.includes("node_modules") || file.startsWith(".") || file.startsWith("build"),
});

const rootPackage = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as PackageJson;

const names = manifests.flatMap((file) => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, file), "utf8")) as PackageJson;
  return KINDS.flatMap((kind) => Object.keys(pkg[kind] ?? {}));
});

// One approving row, whichever way it is asked for: | `name` | <specifier> |.
// Given a name it matches that package's row; given none it matches any
// approving row in the file, which is what stops the table growing a second
// home (0509#7017). The specifier cell is one token, because a cell that starts
// with a digit is not only a version: docs/REBUILD-STACK.md §4 has probe-result
// rows whose second cell reads `200, image/x-icon`, and the looser shape matched
// all three of them.
const approvingRow = (name?: string): RegExp => {
  const cell = name === undefined ? "[^`]+" : name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`^\\| \`${cell}\` +\\| +[\\^~]?\\d[^\\s|]* *\\|`, "m");
};

const allowlist = readFileSync(path.join(ROOT, ALLOWLIST), "utf8");

// The table's header declares six columns; cells are read by position, so every
// data row must have the six the header declares.
interface StackRow {
  name: string;
  specifier: string;
  locked: string;
}

// Throws with the file and the line, rather than asserting from module scope: a
// table that no longer parses then fails the named test that reads it, not the
// whole file's collection.
function stackRows(): Map<string, StackRow> {
  const lines = allowlist.split("\n");
  const header = lines.findIndex((line) => /^\|\s*Package\s*\|/.test(line));
  if (header < 0) throw new Error(`${ALLOWLIST} has no \`| Package |\` header row`);

  const rows = new Map<string, StackRow>();
  for (let at = header + 2; at < lines.length; at += 1) {
    const line = lines[at];
    if (!line.trim().startsWith("|")) break;
    // `\|` inside a cell is legal Markdown and is not a column separator, so a
    // row holding one splits into the wrong number of cells and would fail the
    // width check below with a count that does not name the cell.
    const cells = line
      .split(/(?<!\\)\|/)
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length !== 6) {
      throw new Error(`${ALLOWLIST} row ${at + 1} has ${cells.length} columns, not 6`);
    }
    const name = cells[0].replace(/^`|`$/g, "");
    rows.set(name, { name, specifier: cells[1], locked: cells[5] });
  }
  return rows;
}

// package-lock.json resolves every direct dependency of the root manifest to
// `node_modules/<name>` at lockfileVersion 3.
const lock = JSON.parse(readFileSync(path.join(ROOT, "package-lock.json"), "utf8")) as {
  packages?: Record<string, { version?: string }>;
};

const resolved = (name: string): string | undefined => lock.packages?.[`node_modules/${name}`]?.version;

const directDependencies = KINDS.flatMap((kind) => Object.entries(rootPackage[kind] ?? {}));

describe(ALLOWLIST, () => {
  it.each([...new Set(names)])("approves %s in its own row", (name) => {
    expect(approvingRow(name).test(allowlist), `${name} has no approving row in ${ALLOWLIST}`).toBe(true);
  });
});

describe("the allowlist lives in one file", () => {
  const otherDocs = globSync("**/*.md", {
    cwd: ROOT,
    exclude: (file) => file.includes("node_modules") || file.startsWith(".") || file.startsWith("build"),
  }).filter((file) => file !== ALLOWLIST);

  it.each(otherDocs)("%s holds no approving row", (file) => {
    expect(approvingRow().test(readFileSync(path.join(ROOT, file), "utf8"))).toBe(false);
  });

  it.each(["AGENTS.md", "README.md", "docs/REBUILD-STACK.md"])("%s points at the allowlist", (doc) => {
    expect(readFileSync(path.join(ROOT, doc), "utf8")).toContain(ALLOWLIST);
  });
});

// The row checks above read every manifest, but the specifier and Lock checks
// below read the root manifest and the root lock, so a second package.json would
// pass the row check while silently escaping both number checks. Fail loudly
// instead of under-checking: adding a manifest means extending this file.
describe("the number columns", () => {
  it("reads the root manifest only", () => {
    expect(manifests, "a second package.json needs its own specifier and lock checks here").toEqual(["package.json"]);
  });

  it("parses the table into six-column rows", () => {
    const parsed = stackRows();
    expect(parsed.size, `${ALLOWLIST} parses no rows`).toBeGreaterThan(0);
    for (const [name, row] of parsed) {
      expect(row.specifier, `${name} has an empty Specifier cell`).not.toBe("");
      expect(row.locked, `${name} has an empty Lock cell`).not.toBe("");
    }
  });

  it.each(directDependencies)("names the package.json specifier for %s", (name, specifier) => {
    const row = stackRows().get(name);
    expect(row, `${name} has no ${ALLOWLIST} row`).toBeDefined();
    expect(row?.specifier, `${name} Specifier drifted from package.json`).toBe(specifier);
  });

  it.each(directDependencies)("names the resolved lockfile version for %s", (name) => {
    const row = stackRows().get(name);
    const version = resolved(name);
    expect(version, `package-lock.json has no node_modules/${name} entry`).toBeDefined();
    expect(row?.locked, `${name} Lock drifted from package-lock.json`).toBe(version);
  });
});
