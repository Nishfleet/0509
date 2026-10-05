import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// 0509#7015: tests/fixtures/ carried two 1.6 MB gymshark captures
// (gymshark-2026-09-22-a.html and -b.html) that differed in 4 bytes
// — the active variant of two A/B experiments. The repo stored the
// same page twice and every clone paid for it; the b capture is now
// derived from a inside extract-text.test.ts. This test is the gate
// that keeps the mistake from coming back: two same-size fixture
// files that differ in only a handful of bytes are a stored twin,
// and one of them must be derived instead of committed.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURES = path.join(REPO_ROOT, "tests", "fixtures");

// A stored page capture is big; the small before/after pairs
// (copy-change-*.html, 467 B) hold deliberately different copy and
// stay under the floor.
const SIZE_FLOOR = 32 * 1024;

// 4 bytes separated the gymshark pair. 64 leaves room for a captured
// timestamp or one changed field while still naming a twin.
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
