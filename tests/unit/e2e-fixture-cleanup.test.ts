import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// #5985: every e2e spec that mints an `e2e+` address creates a real user row in
// production (the signup journeys run against the live Worker), and the only
// path that removes it is deleteCreatedAccount in e2e/inbox.ts, called from
// each spec's afterEach. A spec that mints and never calls the helper leaks a
// row per run, silently, with nothing failing. The probes below prove MINT
// still bites on a per-run mint and still ignores the fixed journey addresses,
// then the sweep asserts no minting spec is left unwired.
//
// The shape is the toaster.test.ts one by copy (0509#4116): REPO_ROOT from
// import.meta.url, a recursive readdir, a pure-regex probe, then the clean-tree
// sweep. Only the scanned dir and the probes differ — e2e instead of app and
// workers, *.spec.ts only.
//
// J14 is the one allowed offender: e2e/j14-delete-workspace.spec.ts drives the
// product's own delete flow inline and asserts the mid-flow progress (the
// `deleted` instance id, "Snapshots and screenshots: removed"), so calling the
// helper after its own inline delete would prove nothing. The spec IS the
// delete flow's proof.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MINT = /e2e\+\$\{/;
const HELPER = /deleteCreatedAccount/;
const ALLOWED = new Set(["e2e/j14-delete-workspace.spec.ts"]);

// The four accounts the journey specs keep on purpose (0509#5688,
// fleet-manager). Exact addresses, never a pattern — the helper skips these
// four by exact match, so a detector that pinned them as a prefix would ban a
// shape the product does not mint.
const KEPT_JOURNEY_ACCOUNTS = [
  "e2e+j7@0509.io",
  "e2e+j8-soft@0509.io",
  "e2e+j9-mentions@0509.io",
  "e2e+j12-rollovers@0509.io",
];

async function e2eSpecs(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await e2eSpecs(full)));
      continue;
    }
    if (!/\.spec\.ts$/.test(entry.name)) continue;
    found.push(path.relative(REPO_ROOT, full).split(path.sep).join("/"));
  }
  return found;
}

describe("e2e fixture teardown detector", () => {
  it("bites on a per-run mint", () => {
    expect(MINT.test('const email = `e2e+${tag}@0509.io`;')).toBe(true);
  });

  it("ignores the fixed journey addresses and a non-e2e seed", () => {
    for (const email of KEPT_JOURNEY_ACCOUNTS) expect(MINT.test(email)).toBe(false);
    // j6-keyboard.spec.ts's preview-lane seed: a j6-prefixed address against
    // local D1, never the e2e+ shape the metric counts.
    expect(MINT.test('const email = `j6-keyboard-${suffix}@0509.io`;')).toBe(false);
  });

  it("leaves no minting spec without the teardown helper", async () => {
    const specs = await e2eSpecs(path.join(REPO_ROOT, "e2e"));
    const offenders: string[] = [];
    for (const rel of specs) {
      if (ALLOWED.has(rel)) continue;
      const source = await readFile(path.join(REPO_ROOT, rel), "utf8");
      if (MINT.test(source) && !HELPER.test(source)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("pins the four kept journey addresses into the helper", async () => {
    const source = await readFile(path.join(REPO_ROOT, "e2e/inbox.ts"), "utf8");
    for (const email of KEPT_JOURNEY_ACCOUNTS) expect(source).toContain(email);
  });
});
