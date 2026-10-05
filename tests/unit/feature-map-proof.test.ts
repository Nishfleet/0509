import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// #6133: drift in the feature map was found and never fixed — six open issues
// said the same thing. The class fix is this gate: a spec that no Proof row
// names, or a Proof row that names a spec not on disk, fails the PR. The shape
// is the e2e-fixture-cleanup.test.ts one by copy: REPO_ROOT from
// import.meta.url, a recursive readdir, a pure-regex probe. The map is
// hand-written on purpose; this test reads it, it does not generate it.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MAP = path.join(REPO_ROOT, ".agents", "skills", "verify", "feature-map.md");
// The same pattern the gardener sweeps used, so this gate fails on exactly
// the references a human sweep would report.
const SPEC_REF = /e2e\/[A-Za-z0-9_./-]+\.spec\.ts/g;

async function e2eSpecFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await e2eSpecFiles(full)));
      continue;
    }
    if (!/\.spec\.ts$/.test(entry.name)) continue;
    found.push(path.relative(REPO_ROOT, full).split(path.sep).join("/"));
  }
  return found;
}

describe("feature map proof coverage", () => {
  it("names every spec on disk", async () => {
    const map = await readFile(MAP, "utf8");
    const unnamed = (await e2eSpecFiles(path.join(REPO_ROOT, "e2e"))).filter((rel) => !map.includes(rel));
    expect(
      unnamed,
      unnamed.map((rel) => `name \`${rel}\` in the Proof column of the row whose behaviour it asserts`).join("\n"),
    ).toEqual([]);
  });

  it("names no spec that is not on disk", async () => {
    const map = await readFile(MAP, "utf8");
    const onDisk = new Set(await e2eSpecFiles(path.join(REPO_ROOT, "e2e")));
    const dead = [...new Set(map.match(SPEC_REF) ?? [])].filter((ref) => !onDisk.has(ref));
    expect(
      dead,
      dead
        .map((ref) => `\`${ref}\` is named in a Proof column but no such file exists — fix or remove the reference`)
        .join("\n"),
    ).toEqual([]);
  });

  // #7016: a merge-conflict resolution (ab00c365f) left two `/login` rows
  // (lines 27 and 28), each claiming `app/routes/login.tsx`, and only the newer
  // one carries the turnstile-blocked spec. Nothing failed, so the stale twin
  // stayed. The fix is this gate: every route row is unique on its Route + File
  // pair, so a second row for the same route and file fails the PR. Row shape
  // is taken from the file: a route row's first cell starts with a backtick,
  // while the header, the separator and the "Not a route" table do not (#6133
  // pattern). A parser that drifts and reads nothing would pass green while
  // checking nothing, so a positive control proves rows were actually seen.
  it("has no duplicate route row", async () => {
    const map = await readFile(MAP, "utf8");
    const seen = new Map<string, number>();
    const duplicates: string[] = [];
    map.split("\n").forEach((line, index) => {
      if (!line.startsWith("|")) return;
      const cells = line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim());
      if (cells.length < 2 || !cells[0].startsWith("`")) return;
      const key = `${cells[0]}\t${cells[1]}`;
      const first = seen.get(key);
      if (first !== undefined) {
        duplicates.push(`lines ${first} and ${index + 1} both claim ${cells[0]} in ${cells[1]}`);
        return;
      }
      seen.set(key, index + 1);
    });
    // Positive control: a parse that reads nothing must not pass green. The
    // map's route tables carry far more than a handful of rows, and `/` is on
    // every one of them.
    expect(seen.size, "the parser must have read rows from the map").toBeGreaterThan(0);
    expect(
      [...seen.keys()].some((key) => key.startsWith("`/`\t")),
      "the `/` route must be in the map",
    ).toBe(true);
    expect(duplicates, duplicates.join("\n")).toEqual([]);
  });
});
