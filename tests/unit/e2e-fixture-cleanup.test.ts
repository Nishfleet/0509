import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// #5985: every e2e spec that mints an `e2e+` address creates a real user row in
// production (the signup journeys run against the live Worker), and the only
// path that removes it is deleteCreatedAccount in e2e/inbox.ts, called from
// each spec's afterEach. A spec that mints and never calls the helper leaks a
// row per run, silently, with nothing failing.
//
// The shape is the toaster.test.ts one by copy (0509#4116): REPO_ROOT from
// import.meta.url, a recursive readdir, pure-regex probes, then the clean-tree
// sweep. Only the scanned dir and the probes differ — e2e instead of app and
// workers, *.spec.ts only.
//
// The probes are the other half. A detector that cannot be shown to fail is a
// detector nobody can trust, so each probe asserts a line the regex must bite
// and a line it must leave alone: a template mint, a concatenated mint, the
// four fixed journey addresses, and the one non-e2e seed. The four address
// literals cannot match a regex that requires `${`, so those two cases are the
// fleet-manager constraint recorded as executable text — they would fail if
// the probe were ever widened past the per-run shape, and they name the accounts
// the helper must keep.
//
// J14 is the one allowed offender: e2e/j14-delete-workspace.spec.ts drives the
// product's own delete flow inline and asserts the mid-flow progress (the
// `deleted` instance id, "Snapshots and screenshots: removed"), so calling the
// helper after its own inline delete would prove nothing. The spec IS the
// delete flow's proof, and a separate case asserts it still drives that flow,
// so the exemption cannot outlive the file or the delete it is granted for.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MINT = /e2e\+\$\{/;
// The bypass the template-literal probe above cannot see: building the same
// address by concatenation. No spec does this today; this probe is what makes
// the shape fail loudly if one ever does, so the sweep below is not blind to
// a refactor away from the template form.
const MINT_CONCAT = /["']e2e\+["']\s*\+/;
// A call, not the bare identifier: an import a spec never calls must not count
// as teardown, or the exact leak this detector exists to catch — mint in the
// test, helper never runs — would pass on the import line alone.
const HELPER = /deleteCreatedAccount\s*\(/;
const ALLOWED = new Set(["e2e/j14-delete-workspace.spec.ts"]);
// The inline delete the exemption above is granted for: J14 waits for the
// product's own post-delete redirect, which no helper call produces.
const INLINE_DELETE = ["waitForURL", "?deleted="];

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
// What Playwright runs: the files in the root of e2e/, nothing recursive. A
// spec a future subdirectory holds is not run by `npm run e2e` today, so
// scanning it would hold this detector to a contract the runner has not made.
const SCANNED_DIR = "e2e";

async function e2eSpecs(): Promise<string[]> {
  const dir = path.join(REPO_ROOT, SCANNED_DIR);
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() || !/\.spec\.ts$/.test(entry.name)) continue;
    found.push(`${SCANNED_DIR}/${entry.name}`);
  }
  return found.sort();
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

  it("bites on a concatenated mint, not only a template literal", () => {
    expect(MINT_CONCAT.test('const email = "e2e+" + tag + "@0509.io";')).toBe(true);
    for (const email of KEPT_JOURNEY_ACCOUNTS) expect(MINT_CONCAT.test(email)).toBe(false);
  });

  it("leaves no minting spec without a teardown call", async () => {
    const specs = await e2eSpecs();
    // A vacuous pass — an empty walk reporting no offenders — is the failure
    // mode of every repo-scanning detector, so the walk proves it found specs.
    expect(specs.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const rel of specs) {
      const source = await readFile(path.join(REPO_ROOT, rel), "utf8");
      if (!MINT.test(source) && !MINT_CONCAT.test(source)) continue;
      if (ALLOWED.has(rel)) continue;
      if (!HELPER.test(source)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the exemption alive: J14 still drives the inline delete", async () => {
    const rel = "e2e/j14-delete-workspace.spec.ts";
    const source = await readFile(path.join(REPO_ROOT, rel), "utf8");
    expect(MINT.test(source) || MINT_CONCAT.test(source)).toBe(true);
    for (const shape of INLINE_DELETE) expect(source).toContain(shape);
  });

  it("pins the kept journey accounts both ways", async () => {
    const source = await readFile(path.join(REPO_ROOT, "e2e/inbox.ts"), "utf8");
    for (const email of KEPT_JOURNEY_ACCOUNTS) expect(source).toContain(email);
    // Equality, not containment: a fifth address added to the helper's guard
    // without landing here is a skip rule the fleet-manager constraint never
    // approved, and it must fail here rather than sit in production until
    // someone reads the diff.
    const guard = /const KEPT_JOURNEY_ACCOUNTS[^=]*=\s*\[([^\]]*)\]/.exec(source);
    expect(guard).not.toBeNull();
    expect([...(guard?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((entry) => entry[1]).sort()).toEqual(
      [...KEPT_JOURNEY_ACCOUNTS].sort(),
    );
  });
});
