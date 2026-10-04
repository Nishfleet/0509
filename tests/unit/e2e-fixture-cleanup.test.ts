import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

// #5985: an e2e spec that mints an `e2e+` address creates a real user row in
// production, and deleteCreatedAccount in e2e/inbox.ts is the only path that
// removes it. A spec that mints and never calls the helper leaks a row per
// run. The shape is the toaster.test.ts one by copy (0509#4116): REPO_ROOT
// from import.meta.url, a recursive readdir, pure-regex probes, then the
// clean-tree sweep.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// A prefix before the interpolation is still a per-run mint:
// `e2e+onboarded-${lane}-…` and `e2e+${tag}-…` leaked rows the bare
// `e2e+${` probe never saw (0509#6968).
const MINT = /e2e\+[\w-]*\$\{/;
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
  "e2e+j8-hard-v2@0509.io",
  "e2e+j8-soft-v2@0509.io",
  "e2e+j9-mentions@0509.io",
  "e2e+j12-rollovers@0509.io",
  "e2e+soak@0509.io",
];

// A setup project that mints is cleaned up by its `teardown:` project, not by
// the helper. The lighthouse sign-in is the one exception: the lighthouse job
// runs lhci-teardown as its own step after the audit (0509#5767).
const SETUP_TEARDOWN_ELSEWHERE = new Set(["e2e/lhci-session.setup.ts"]);

const WORKFLOW = ".github/workflows/e2e-scheduled.yml";
const TEARDOWN_RERUN = "--project=session-teardown --project=onboarded-teardown";

async function e2eFiles(dir: string, suffix: RegExp): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await e2eFiles(full, suffix)));
      continue;
    }
    if (!suffix.test(entry.name)) continue;
    found.push(path.relative(REPO_ROOT, full).split(path.sep).join("/"));
  }
  return found;
}

describe("e2e fixture teardown detector", () => {
  it("bites on a per-run mint, with or without a prefix", () => {
    expect(MINT.test("const email = `e2e+${tag}@0509.io`;")).toBe(true);
    expect(MINT.test("const email = `e2e+onboarded-${lane}-${hex}@0509.io`;")).toBe(true);
    expect(MINT.test("return `e2e+lhci-${hex}@0509.io`;")).toBe(true);
  });

  it("ignores the fixed journey addresses and a non-e2e seed", () => {
    for (const email of KEPT_JOURNEY_ACCOUNTS) expect(MINT.test(email)).toBe(false);
    // j6-keyboard.spec.ts's preview-lane seed: a j6-prefixed address against
    // local D1, never the e2e+ shape.
    expect(MINT.test("const email = `j6-keyboard-${suffix}@0509.io`;")).toBe(false);
  });

  it("leaves no minting spec without a teardown call", async () => {
    const offenders: string[] = [];
    for (const rel of await e2eFiles(path.join(REPO_ROOT, "e2e"), /\.spec\.ts$/)) {
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

  it("pairs every minting setup project with a teardown project", async () => {
    vi.stubEnv("PLAYWRIGHT_TEST_BASE_URL", "https://0509.io");
    vi.stubEnv("CF_ACCESS_CLIENT_ID", "probe");
    const { default: config } = await import("../../playwright.config");
    vi.unstubAllEnvs();
    const projects = config.projects ?? [];
    const offenders: string[] = [];
    for (const rel of await e2eFiles(path.join(REPO_ROOT, "e2e"), /\.setup\.ts$/)) {
      if (SETUP_TEARDOWN_ELSEWHERE.has(rel)) continue;
      const source = await readFile(path.join(REPO_ROOT, rel), "utf8");
      if (!MINT.test(source)) continue;
      const owner = projects.find((project) => project.testMatch instanceof RegExp && project.testMatch.test(rel));
      if (owner?.teardown === undefined) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("re-runs the setup teardowns on every exit path of each production job that runs the setups", async () => {
    const source = await readFile(path.join(REPO_ROOT, WORKFLOW), "utf8");
    const jobs = source.split(/^ {2}(?=[a-z0-9-]+:$)/m).slice(1);
    const offenders = jobs
      .filter((job) =>
        /npm run e2e -- (?!--project=setup )(?![^\n]*--no-deps)(?![^\n]*--project=session-teardown)/.test(job),
      )
      .filter((job) => !(job.includes(TEARDOWN_RERUN) && /if: always\(\)/.test(job)))
      .map((job) => job.slice(0, job.indexOf(":")));
    expect(jobs.length).toBeGreaterThan(5);
    expect(offenders).toEqual([]);
  });

  it("never turns the J5 bot wall off, so a healthy homepage cannot land in the 24 h identity cache", async () => {
    const source = await readFile(path.join(REPO_ROOT, "e2e/j5-onboard-blocked.spec.ts"), "utf8");
    expect(source).toContain("/__wall?state=on");
    expect(source).not.toContain("/__wall?state=off");
  });

  it("treats a second session teardown as a login redirect, not a missing deleted query", async () => {
    const source = await readFile(path.join(REPO_ROOT, "e2e/session.teardown.ts"), "utf8");
    expect(source).toContain("/login?deleted=");
    expect(source).toContain("toMatch(/\\/login(?:\\?|$)/)");
  });

  it("signs in again when settings refuses a stale delete, instead of treating the row as gone", async () => {
    const source = await readFile(path.join(REPO_ROOT, "e2e/inbox.ts"), "utf8");
    expect(source).toContain("sign out and sign back in");
    expect(source).toContain("signInWithMagicLink");
    expect(source).not.toContain("treating as already gone");
  });

  it("runs a matrix inside a job concurrency group one leg at a time", async () => {
    const dir = path.join(REPO_ROOT, ".github/workflows");
    const offenders: string[] = [];
    const grouped: string[] = [];
    for (const file of await readdir(dir)) {
      if (!/\.ya?ml$/.test(file)) continue;
      const source = await readFile(path.join(dir, file), "utf8");
      for (const job of source.split(/^ {2}(?=[A-Za-z0-9_-]+:$)/m).slice(1)) {
        if (!/^ {4}concurrency:/m.test(job) || !/^ {6}matrix:/m.test(job)) continue;
        const name = `${file}:${job.slice(0, job.indexOf(":"))}`;
        grouped.push(name);
        if (!/^ {6}max-parallel: 1$/m.test(job)) offenders.push(name);
      }
    }
    expect(grouped).toContain("e2e-scheduled.yml:suite-shard");
    expect(offenders).toEqual([]);
  });
});
