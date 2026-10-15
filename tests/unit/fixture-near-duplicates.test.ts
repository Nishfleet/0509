import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURES = path.join(REPO_ROOT, "tests", "fixtures");

const SIZE_FLOOR = 32 * 1024;

const DIFFERENCE_BUDGET = 64;

async function fixtureFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await fixtureFiles(full)));
    } else {
      found.push(full);
    }
  }
  return found.sort();
}

function differingBytes(a: Uint8Array, b: Uint8Array): number {
  let differing = 0;
  for (let i = 0; i < a.length && differing <= DIFFERENCE_BUDGET; i++) {
    if (a[i] !== b[i]) differing++;
  }
  return differing;
}

describe("tests/fixtures", () => {
  it("stores no near-identical twin of a large capture", async () => {
    const large: { name: string; bytes: Uint8Array }[] = [];
    for (const file of await fixtureFiles(FIXTURES)) {
      const bytes = await readFile(file);
      if (bytes.length >= SIZE_FLOOR) {
        large.push({ name: path.relative(REPO_ROOT, file), bytes });
      }
    }

    const twins: string[] = [];
    for (let i = 0; i < large.length; i++) {
      for (let j = i + 1; j < large.length; j++) {
        const a = large[i];
        const b = large[j];
        if (a.bytes.length !== b.bytes.length) continue;
        const differing = differingBytes(a.bytes, b.bytes);
        if (differing <= DIFFERENCE_BUDGET) {
          twins.push(`${a.name} and ${b.name}: ${differing} differing bytes of ${a.bytes.length}`);
        }
      }
    }

    expect(twins).toEqual([]);
  });
});
