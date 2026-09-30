import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// #5985: an e2e spec that mints an `e2e+` address creates a real user row in
// production, and deleteCreatedAccount in e2e/inbox.ts is the only path that
// removes it. A spec that mints and never calls the helper leaks a row per
// run. The shape is the toaster.test.ts one by copy (0509#4116): REPO_ROOT
// from import.meta.url, a recursive readdir, pure-regex probes, then the
// clean-tree sweep.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MINT = /e2e\+\$\{/;
const HELPER = /deleteCreatedAccount/;
// J14 drives the delete flow inline and asserts the mid-flow progress, so it
// cannot call the helper; it is the flow's proof.
const ALLOWED = new Set(["e2e/j14-delete-workspace.spec.ts"]);

// The five accounts the journey specs keep on purpose (0509#5688,
// fleet-manager): exact addresses, never a pattern.
const KEPT_JOURNEY_ACCOUNTS = [
  "e2e+j7@0509.io",
  "e2e+j8-hard@0509.io",
  "e2e+j8-soft@0509.io",
  "e2e+j9-mentions@0509.io",
  "e2e+j12-rollovers@0509.io",
];

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

describe("e2e fixture teardown detector", () => {
  it("bites on a per-run mint", () => {
    expect(MINT.test("const email = `e2e+${tag}@0509.io`;")).toBe(true);
  });

  it("ignores the fixed journey addresses and a non-e2e seed", () => {
    for (const email of KEPT_JOURNEY_ACCOUNTS) expect(MINT.test(email)).toBe(false);
    // j6-keyboard.spec.ts's preview-lane seed: a j6-prefixed address against
    // local D1, never the e2e+ shape.
    expect(MINT.test("const email = `j6-keyboard-${suffix}@0509.io`;")).toBe(false);
  });

  it("leaves no minting spec without a teardown call", async () => {
    const offenders: string[] = [];
    for (const rel of await e2eSpecFiles(path.join(REPO_ROOT, "e2e"))) {
      if (ALLOWED.has(rel)) continue;
      const source = await readFile(path.join(REPO_ROOT, rel), "utf8");
      if (MINT.test(source) && !HELPER.test(source)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the four journey accounts in the helper's guard", async () => {
    const source = await readFile(path.join(REPO_ROOT, "e2e/inbox.ts"), "utf8");
    for (const email of KEPT_JOURNEY_ACCOUNTS) expect(source).toContain(email);
  });
});
