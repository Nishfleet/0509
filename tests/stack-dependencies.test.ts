import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const ALLOWLIST = "docs/dependencies.md";
const KINDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

type PackageJson = Partial<Record<(typeof KINDS)[number], Record<string, string>>>;

const manifests = globSync("**/package.json", {
  cwd: ROOT,
  exclude: (file) => file.includes("node_modules") || file.startsWith(".") || file.startsWith("build"),
});

const rootPackage = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as PackageJson;

const dependencyNames = (file: string): string[] => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, file), "utf8")) as PackageJson;
  return KINDS.flatMap((kind) => Object.keys(pkg[kind] ?? {}));
};

const names = manifests.flatMap(dependencyNames);

const approvingRow = (name?: string): RegExp => {
  const cell = name === undefined ? "[^`]+" : name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`^\\| \`${cell}\` +\\| +[\\^~]?\\d[^\\s|]* *\\|`, "m");
};

const allowlist = readFileSync(path.join(ROOT, ALLOWLIST), "utf8");

interface StackRow {
  name: string;
  specifier: string;
  locked: string;
}

function stackRows(): Map<string, StackRow> {
  const lines = allowlist.split("\n");
  const header = lines.findIndex((line) => /^\|\s*Package\s*\|/.test(line));
  if (header < 0) throw new Error(`${ALLOWLIST} has no \`| Package |\` header row`);

  const rows = new Map<string, StackRow>();
  for (let at = header + 2; at < lines.length; at += 1) {
    const line = lines[at];
    if (!line.trim().startsWith("|")) break;

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

describe("the number columns", () => {
  it("reads the root manifest only", () => {
    expect(
      manifests.filter((file) => dependencyNames(file).length > 0),
      "a second package.json that declares dependencies needs its own specifier and lock checks here",
    ).toEqual(["package.json"]);
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
