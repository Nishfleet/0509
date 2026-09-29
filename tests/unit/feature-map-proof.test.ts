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
      dead.map((ref) => `\`${ref}\` is named in a Proof column but no such file exists — fix or remove the reference`).join("\n"),
    ).toEqual([]);
  });
});
