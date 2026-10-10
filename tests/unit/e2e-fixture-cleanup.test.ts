import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import type { APIRequestContext } from "@playwright/test";

import { FIXTURE_ACCOUNTS } from "../../app/lib/fixture-accounts";
import { classifySettingsDeleteRedirect, deleteAccountViaRequest, isKeptAccount } from "../../e2e/inbox";

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
// J14 drives the delete flow inline and asserts the mid-flow progress, so it
// cannot call the helper; it is the flow's proof.
const ALLOWED = new Set(["e2e/j14-delete-workspace.spec.ts"]);

// The accounts the journey specs keep on purpose (0509#5688,
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
  "e2e+onboarded-desktop@0509.io",
  "e2e+onboarded-phone@0509.io",
  "e2e+j6-desktop@0509.io",
  "e2e+j6-phone@0509.io",
  "e2e+j11@0509.io",
];

// A setup project that mints is cleaned up by its `teardown:` project, not by
// the helper. The lighthouse sign-in is the one exception: the lighthouse job
// runs lhci-teardown as its own step after the audit (0509#5767).
const SETUP_TEARDOWN_ELSEWHERE = new Set(["e2e/lhci-session.setup.ts"]);

const WORKFLOW = ".github/workflows/e2e-scheduled.yml";
const TEARDOWN_RERUN = "--project=session-teardown";

interface WorkflowStep {
  name?: string;
  run?: string;
  if?: unknown;
  env?: Record<string, string>;
}

interface WorkflowJob {
  if?: string;
  concurrency?: unknown;
  env?: Record<string, string>;
  strategy?: { matrix?: unknown; "max-parallel"?: number };
  steps?: WorkflowStep[];
}

function readJobs(source: string): Record<string, WorkflowJob> {
  return (parse(source) as { jobs: Record<string, WorkflowJob> }).jobs;
}

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
      if (MINT.test(source) && !source.includes("deleteCreatedAccount")) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the journey accounts in the helper's guard", async () => {
    const source = await readFile(path.join(REPO_ROOT, "e2e/inbox.ts"), "utf8");
    for (const email of KEPT_JOURNEY_ACCOUNTS) expect(source).toContain(email);
  });

  it("keeps every FIXTURE_ACCOUNTS address in the guard, so the teardown never deletes a comp-plan identity", () => {
    for (const account of Object.values(FIXTURE_ACCOUNTS)) expect(KEPT_JOURNEY_ACCOUNTS).toContain(account.email);
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
    const jobs = Object.entries(readJobs(await readFile(path.join(REPO_ROOT, WORKFLOW), "utf8")));
    const offenders = jobs
      .filter(([, job]) =>
        (job.steps ?? []).some((step) =>
          /npm run e2e -- (?!--project=setup )(?!.*--no-deps)(?!.*--project=session-teardown)/.test(step.run ?? ""),
        ),
      )
      .filter(
        ([, job]) =>
          !(job.steps ?? []).some(
            (step) => (step.run ?? "").includes(TEARDOWN_RERUN) && String(step.if ?? "").startsWith("always()"),
          ),
      )
      .map(([key]) => key);
    expect(jobs.length).toBeGreaterThan(5);
    expect(offenders).toEqual([]);
  });

  it("never turns the J5 bot wall off, so a healthy homepage cannot land in the 24 h identity cache", async () => {
    const source = await readFile(path.join(REPO_ROOT, "e2e/j5-onboard-blocked.spec.ts"), "utf8");
    expect(source).toContain("/__wall?state=on");
    expect(source).not.toContain("/__wall?state=off");
  });

  it("treats every FIXTURE_ACCOUNTS address and the legacy kept accounts as kept, and a per-run one as not", () => {
    for (const account of Object.values(FIXTURE_ACCOUNTS)) {
      expect(isKeptAccount(account.email)).toBe(true);
      expect(isKeptAccount(account.email.toUpperCase())).toBe(true);
    }
    for (const email of KEPT_JOURNEY_ACCOUNTS) expect(isKeptAccount(email)).toBe(true);
    expect(isKeptAccount("e2e+abc123@0509.io")).toBe(false);
  });

  it("refuses to delete a FIXTURE_ACCOUNTS session through the request path, and deletes a per-run one", async () => {
    const posted: string[] = [];
    const requestFor = (email: string) =>
      ({
        get: () => Promise.resolve({ status: () => 200, json: () => Promise.resolve({ user: { email } }) }),
        post: (url: string) => {
          posted.push(url);
          return Promise.resolve({ status: () => 302, headers: () => ({ location: "/login?deleted=1" }) });
        },
      }) as unknown as APIRequestContext;

    for (const account of Object.values(FIXTURE_ACCOUNTS)) {
      await deleteAccountViaRequest(requestFor(account.email), "https://0509.io");
    }
    expect(posted).toEqual([]);

    await deleteAccountViaRequest(requestFor("e2e+abc123@0509.io"), "https://0509.io");
    expect(posted).toEqual(["/app/settings"]);
  });

  it("classifies a settings delete redirect as deleted, already gone, or unexpected", () => {
    expect(classifySettingsDeleteRedirect(302, "/login?deleted=abc")).toBe("deleted");
    expect(classifySettingsDeleteRedirect(302, "/login")).toBe("already-gone");
    expect(classifySettingsDeleteRedirect(302, "/login?next=%2Fapp%2Fsettings")).toBe("already-gone");
    expect(classifySettingsDeleteRedirect(200, "/login")).toBe("unexpected");
    expect(classifySettingsDeleteRedirect(302, "/app")).toBe("unexpected");
  });

  it("runs a matrix inside a job concurrency group one leg at a time", async () => {
    const dir = path.join(REPO_ROOT, ".github/workflows");
    const offenders: string[] = [];
    const grouped: string[] = [];
    for (const file of await readdir(dir)) {
      if (!/\.ya?ml$/.test(file)) continue;
      for (const [key, job] of Object.entries(readJobs(await readFile(path.join(dir, file), "utf8")))) {
        if (job.concurrency === undefined || job.strategy?.matrix === undefined) continue;
        const name = `${file}:${key}`;
        grouped.push(name);
        if (job.strategy["max-parallel"] !== 1) offenders.push(name);
      }
    }
    expect(grouped).toContain("e2e-scheduled.yml:suite-shard");
    expect(offenders).toEqual([]);
  });
});

// #7186: the e2e-scheduled dispatch rules that live in the workflow file. Each
// shell step is run for real in bash with the runner's default flags, so a
// test passes on what the step does, not on how it is spelled.
const PRINT_STEP = "Print what the page showed when it failed";
const SPEC_STEP = "Accept one spec file and no flags";
const MAIN_ONLY_JOBS = ["j12", "signin", "j8", "backup-proof", "jev-failures", "soak-report"];
const CLOUDFLARE_TOKEN = /CLOUDFLARE_(API|SETTINGS)_TOKEN/;

function runStep(script: string, cwd: string, env: Record<string, string> = {}): { code: number; out: string } {
  try {
    const out = execFileSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
      cwd,
      env: { PATH: process.env.PATH ?? "", ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (error) {
    const failed = error as { status: number; stdout: string };
    return { code: failed.status, out: failed.stdout };
  }
}

async function scheduledJobs(): Promise<Record<string, WorkflowJob>> {
  return readJobs(await readFile(path.join(REPO_ROOT, WORKFLOW), "utf8"));
}

function stepNamed(job: WorkflowJob, name: string): WorkflowStep | undefined {
  return (job.steps ?? []).find((step) => step.name === name);
}

describe("e2e-scheduled dispatch rules (0509#7186)", () => {
  it("prints the failure context in every job that runs a spec, and passes when there is none", async () => {
    const jobs = await scheduledJobs();
    const running = Object.entries(jobs).filter(([, job]) =>
      (job.steps ?? []).some((step) => /npm run e2e -- (?!--project=s(etup|ession-teardown) )/.test(step.run ?? "")),
    );
    expect(running.map(([key]) => key).sort()).toEqual(["j12", "j8", "signin", "spec", "suite-shard"]);
    const dir = await mkdtemp(path.join(tmpdir(), "e2e-print-"));
    try {
      for (const [key, job] of running) {
        const step = stepNamed(job, PRINT_STEP);
        expect(step?.if, key).toBe("failure()");
        expect(runStep(step?.run ?? "", dir).code, `${key} with no test-results`).toBe(0);
      }
      const script = stepNamed(jobs.j12, PRINT_STEP)?.run ?? "";
      const globbed = /test-results\/\*\*\/([\w.-]+)/.exec(script)?.[1];
      expect(globbed).toBeDefined();
      await mkdir(path.join(dir, "test-results/a/b"), { recursive: true });
      await writeFile(path.join(dir, "test-results/a/b", globbed ?? ""), "deep-probe\n");
      const printed = runStep(script, dir);
      expect(printed.code).toBe(0);
      expect(printed.out).toContain("deep-probe");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("runs the spec input only when it names one e2e spec file, before anything is installed", async () => {
    const { spec } = await scheduledJobs();
    const steps = spec.steps ?? [];
    expect(steps[0]?.name).toBe(SPEC_STEP);
    expect(steps[0]?.env?.SPEC).toBe("${{ inputs.spec }}");
    const script = steps[0]?.run ?? "";
    const accepted = (value: string) => runStep(script, tmpdir(), { SPEC: value }).code === 0;
    expect(accepted("e2e/j3-onboard-domain.spec.ts")).toBe(true);
    for (const bad of [
      "",
      "e2e/j3-onboard-domain.spec.ts --project=setup",
      "--grep=.",
      "e2e/",
      "e2e/sub/x.spec.ts",
      "e2e/../x.spec.ts",
      "tests/x.spec.ts",
      "e2e/x.spec.tsx",
      "e2e/a.spec.ts e2e/b.spec.ts",
      "e2e/x.spec.ts\ne2e/y.spec.ts",
    ]) {
      expect(accepted(bad), JSON.stringify(bad)).toBe(false);
    }
    expect(spec.if).not.toContain("refs/heads/main");
  });

  it("dispatches every journey from main only, and fails a branch dispatch out loud", async () => {
    const jobs = await scheduledJobs();
    for (const key of MAIN_ONLY_JOBS) expect(jobs[key]?.if, key).toContain("github.ref == 'refs/heads/main'");
    for (const key of ["production-sha", "suite-shard", "suite"]) {
      expect(jobs[key]?.if, key).toContain("github.event.schedule == '40 7 * * 0'");
      expect(jobs[key]?.if, key).not.toContain("inputs.");
    }
    expect(jobs.j12.if).toMatch(/^github\.event\.schedule == '5 10 \* \* 3' \|\| \(/);
    expect(jobs.signin.if).toMatch(/^github\.event\.schedule == '17 4 \* \* \*' \|\| \(/);
    expect(jobs["soak-report"].if).toMatch(/^github\.event\.schedule == '30 6 \* \* \*' \|\| \(/);
    const guard = jobs["main-only"];
    expect(guard.if).toBe(
      "github.event_name == 'workflow_dispatch' && inputs.journey != 'none' && github.ref != 'refs/heads/main'",
    );
    const refused = runStep(guard.steps?.[0]?.run ?? "", tmpdir(), { JOURNEY: "suite", REF: "refs/heads/x" });
    expect(refused.code).toBe(1);
    expect(refused.out).toContain("journey=suite dispatches from main only, not refs/heads/x");
  });

  it("installs with scripts off in every job whose job-level env holds a Cloudflare token", async () => {
    const dir = path.join(REPO_ROOT, ".github/workflows");
    const holders: string[] = [];
    const offenders: string[] = [];
    for (const file of await readdir(dir)) {
      if (!/\.ya?ml$/.test(file)) continue;
      for (const [key, job] of Object.entries(readJobs(await readFile(path.join(dir, file), "utf8")))) {
        const env = job.env ?? {};
        if (!Object.entries(env).some(([name, value]) => CLOUDFLARE_TOKEN.test(`${name}=${value}`))) continue;
        const name = `${file}:${key}`;
        holders.push(name);
        const installs = (job.steps ?? []).filter((step) => /\bnpm ci\b/.test(step.run ?? ""));
        const off = (step: WorkflowStep) =>
          (step.env?.NPM_CONFIG_IGNORE_SCRIPTS ?? env.NPM_CONFIG_IGNORE_SCRIPTS) === "true";
        if (!installs.every(off)) offenders.push(name);
      }
    }
    expect(holders).toContain("cloudflare-settings.yml:apply");
    expect(offenders).toEqual([]);
  });

  it("keeps install scripts on for deploy and evals, which need esbuild, workerd and unrs-resolver", async () => {
    for (const [file, key] of [
      ["deploy-production.yml", "deploy"],
      ["evals.yml", "evals"],
    ]) {
      const source = await readFile(path.join(REPO_ROOT, ".github/workflows", file), "utf8");
      expect(readJobs(source)[key], `${file}:${key}`).toBeDefined();
      expect(source, file).not.toContain("NPM_CONFIG_IGNORE_SCRIPTS");
    }
  });
});
