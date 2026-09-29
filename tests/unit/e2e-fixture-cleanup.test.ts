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
// sweep. The scan covers every e2e/**/*.ts, not only *.spec.ts: a spec that
// gets its address from a minting helper holds no `e2e+` literal, so helper
// exports are found first and a spec calling one counts as a minter too.
//
// J14 is the one allowed offender: e2e/j14-delete-workspace.spec.ts drives the
// product's own delete flow inline and asserts the mid-flow progress (the
// `deleted` instance id, "Snapshots and screenshots: removed"), so calling the
// helper after its own inline delete would prove nothing. The spec IS the
// delete flow's proof, and a separate case asserts it still waits on the
// ?deleted= redirect, so the exemption cannot outlive the delete it was
// granted for.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MINT = /e2e\+\$\{/;
// The bypass the template-literal probe above cannot see: building the same
// address by concatenation. No spec does this today; this probe is what makes
// the shape fail loudly if one ever does, so the sweep below is not blind to
// a refactor away from the template form.
const MINT_CONCAT = /["']e2e\+["']\s*(?:\+|\.concat\b)/;
// A call, not the bare identifier: an import a spec never calls must not count
// as teardown, or the exact leak this detector exists to catch — mint in the
// test, helper never runs — would pass on the import line alone. Comments are
// stripped before this runs (and before the MINT probes, which must not fire
// on prose), so a commented-out call is not a call either.
const HELPER = /deleteCreatedAccount\s*\(/;
const ALLOWED = new Set(["e2e/j14-delete-workspace.spec.ts"]);
// The inline delete the exemption above is granted for: J14 waits for the
// product's own post-delete redirect, which no helper call produces.
const INLINE_DELETE = /waitForURL\([^)]*\?deleted=/;
const EXPORTED_CALLABLE = /export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g;

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

// Comments lie in both directions: a mint mentioned in prose marks a spec that
// never mints, and a commented-out deleteCreatedAccount() passes as teardown.
// `//` is stripped only after whitespace, a line start or one of ;{}( so a
// string like "https://…" survives.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[\s;{}(])\/\/[^\n]*/gm, "$1");
}

// Names a minting helper exports; a spec calling any of them is a minter even
// without an `e2e+` literal of its own.
function mintingHelperNames(sources: Map<string, string>): Set<string> {
  const names = new Set<string>();
  for (const [rel, source] of sources) {
    if (rel.endsWith(".spec.ts")) continue;
    const clean = stripComments(source);
    if (!MINT.test(clean) && !MINT_CONCAT.test(clean)) continue;
    for (const match of clean.matchAll(EXPORTED_CALLABLE)) names.add(match[1]);
  }
  return names;
}

function specMints(source: string, helperNames: Set<string>): boolean {
  const clean = stripComments(source);
  if (MINT.test(clean) || MINT_CONCAT.test(clean)) return true;
  for (const name of helperNames) {
    if (new RegExp(`\\b${name}\\s*\\(`).test(clean)) return true;
  }
  return false;
}

// rel-path -> source, every *.ts under e2e/. Pure so the sweep's branches are
// exercised on synthetic trees below, not only on the repo.
function findOffenders(sources: Map<string, string>): string[] {
  const helperNames = mintingHelperNames(sources);
  const offenders: string[] = [];
  for (const [rel, source] of sources) {
    if (!rel.startsWith("e2e/") || !rel.endsWith(".spec.ts")) continue;
    if (ALLOWED.has(rel)) continue;
    if (!specMints(source, helperNames)) continue;
    if (!HELPER.test(stripComments(source))) offenders.push(rel);
  }
  return offenders.sort();
}

// Playwright scans the root of e2e/, so the walk is the toaster.test.ts
// recursion over that dir — every *.ts (helpers included), repo-relative with
// `/` separators.
async function e2eSources(dir: string, into: Map<string, string>): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await e2eSources(full, into);
      continue;
    }
    if (!/\.ts$/.test(entry.name)) continue;
    const rel = path.relative(REPO_ROOT, full).split(path.sep).join("/");
    into.set(rel, await readFile(full, "utf8"));
  }
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

  it("counts a spec calling a minting helper as a minter", () => {
    const sources = new Map([
      ["e2e/mint-helper.ts", 'export async function mintAddress() { return `e2e+${tag}@0509.io`; }'],
      ["e2e/uses-helper.spec.ts", "const email = await mintAddress();"],
    ]);
    expect(findOffenders(sources)).toEqual(["e2e/uses-helper.spec.ts"]);
  });

  it("does not count a commented-out teardown call", () => {
    const spec = 'const email = `e2e+${tag}@0509.io`;\n// afterEach: deleteCreatedAccount(page, email)';
    const sources = new Map([["e2e/commented.spec.ts", spec]]);
    expect(findOffenders(sources)).toEqual(["e2e/commented.spec.ts"]);
  });

  it("does not count a mint mentioned only in prose", () => {
    const spec = '// mints e2e+${tag}@0509.io for the run\nconst email = "fixed@0509.io";';
    const sources = new Map([["e2e/prose.spec.ts", spec]]);
    expect(findOffenders(sources)).toEqual([]);
  });

  it("leaves no minting spec without a teardown call", async () => {
    const sources = new Map<string, string>();
    await e2eSources(path.join(REPO_ROOT, "e2e"), sources);
    // A vacuous pass — an empty walk reporting no offenders — is the failure
    // mode of every repo-scanning detector, so the walk proves it found specs.
    expect([...sources.keys()].filter((rel) => rel.endsWith(".spec.ts")).length).toBeGreaterThan(0);
    expect(findOffenders(sources)).toEqual([]);
  });

  it("keeps the exemption alive: J14 still drives the inline delete", async () => {
    const source = await readFile(path.join(REPO_ROOT, "e2e/j14-delete-workspace.spec.ts"), "utf8");
    expect(MINT.test(stripComments(source)) || MINT_CONCAT.test(stripComments(source))).toBe(true);
    expect(source).toMatch(INLINE_DELETE);
  });

  it("pins the kept journey accounts both ways", async () => {
    const source = await readFile(path.join(REPO_ROOT, "e2e/inbox.ts"), "utf8");
    for (const email of KEPT_JOURNEY_ACCOUNTS) expect(source).toContain(email);
    // Equality, not containment, and literal extraction, not a line shape: a
    // fifth skip address added in any formatting style lands here as a quoted
    // literal and fails, while a reformat of the list itself stays green. A
    // guard entry the fleet-manager constraint never approved must fail here
    // rather than sit in production until someone reads the diff.
    const guarded = [...source.matchAll(/"(e2e\+[^"<]*@0509\.io)"/g)].map((entry) => entry[1]).sort();
    expect(guarded).toEqual([...KEPT_JOURNEY_ACCOUNTS].sort());
  });
});
