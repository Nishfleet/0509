import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = ".github/workflows/e2e-scheduled.yml";
const E2E_DIR = path.join(REPO_ROOT, "e2e");
const MINT = /e2e\+[\w-]*\$\{/;
const RUNS_E2E = /\bnpm run e2e\b|\bnpx playwright test\b/;
const NO_DEPS = /--no-deps\b/;
const PROJECT_FLAG = /--project[= ]([\w,-]+)/g;

interface WorkflowStep {
  name?: string;
  run?: string;
  if?: unknown;
  uses?: string;
}

interface WorkflowJob {
  steps?: WorkflowStep[];
}

interface Project {
  name?: string;
  testMatch?: RegExp;
  dependencies?: string[];
  teardown?: string;
}

interface Derivation {
  dependents: string[];
  teardowns: string[];
}

let jobs: Record<string, WorkflowJob> = {};
let projects: Project[] = [];
let minting: string[] = [];
let derived: Derivation = { dependents: [], teardowns: [] };

async function readJobs(): Promise<Record<string, WorkflowJob>> {
  const source = await readFile(path.join(REPO_ROOT, WORKFLOW), "utf8");
  return (parse(source) as { jobs: Record<string, WorkflowJob> }).jobs;
}

async function setupFiles(): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(E2E_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".setup.ts")) found.push(path.posix.join("e2e", entry.name));
  }
  return found;
}

async function productionProjects(): Promise<Project[]> {
  vi.stubEnv("PLAYWRIGHT_TEST_BASE_URL", "https://0509.io");
  vi.stubEnv("CF_ACCESS_CLIENT_ID", "probe");
  vi.resetModules();
  try {
    const { default: config } = (await import("../playwright.config")) as { default: { projects?: Project[] } };
    return config.projects ?? [];
  } finally {
    vi.unstubAllEnvs();
  }
}

async function mintingSetups(config: Project[]): Promise<string[]> {
  const files = await setupFiles();
  const found: string[] = [];
  for (const project of config) {
    const match = project.testMatch;
    if (project.name === undefined || !(match instanceof RegExp)) continue;
    for (const file of files) {
      if (!match.test(file)) continue;
      const source = await readFile(path.join(REPO_ROOT, file), "utf8");
      if (!MINT.test(source)) continue;
      found.push(project.name);
      break;
    }
  }
  return found;
}

function dependentsOf(config: Project[], mintingNames: readonly string[]): string[] {
  const byName = new Map<string, Project>();
  for (const project of config) if (project.name !== undefined) byName.set(project.name, project);
  const runsMintingSetup = (name: string): boolean =>
    mintingNames.includes(name) || (byName.get(name)?.dependencies ?? []).some(runsMintingSetup);
  return [...byName.keys()].filter(runsMintingSetup);
}

function teardownProjects(config: Project[], mintingNames: readonly string[]): string[] {
  const found: string[] = [];
  for (const project of config) {
    if (project.name === undefined || project.teardown === undefined) continue;
    if (mintingNames.includes(project.name)) found.push(project.teardown);
  }
  return found;
}

function selectedProjects(run: string, config: Project[]): Project[] {
  const named = [...run.matchAll(PROJECT_FLAG)].flatMap(([, value]) => value.split(","));
  if (named.length === 0) return config;
  return config.filter((project) => project.name !== undefined && named.includes(project.name));
}

function mintsSession(run: string, config: Project[], model: Derivation): boolean {
  if (!RUNS_E2E.test(run) || NO_DEPS.test(run)) return false;
  return selectedProjects(run, config).some(
    (project) => project.name !== undefined && model.dependents.includes(project.name),
  );
}

function jobsThatMint(workflow: Record<string, WorkflowJob>, config: Project[], model: Derivation): string[] {
  return Object.entries(workflow)
    .filter(([, job]) => (job.steps ?? []).some((step) => mintsSession(step.run ?? "", config, model)))
    .map(([key]) => key);
}

function missingTeardown(workflow: Record<string, WorkflowJob>, config: Project[], model: Derivation): string[] {
  const reRunsTeardown = (step: WorkflowStep): boolean =>
    String(step.if ?? "").startsWith("always()") &&
    model.teardowns.some((name) => (step.run ?? "").includes(`--project=${name}`));
  return jobsThatMint(workflow, config, model).filter((key) => !(workflow[key]?.steps ?? []).some(reRunsTeardown));
}

function artifactsUploaded(workflow: Record<string, WorkflowJob>): string[] {
  return Object.entries(workflow).flatMap(([key, job]) =>
    (job.steps ?? []).flatMap((step, index) =>
      (step.uses ?? "").startsWith("actions/upload-artifact") ? [`${key}: ${step.name ?? String(index)}`] : [],
    ),
  );
}

function stepsRunningTheSuiteInAnotherWay(workflow: Record<string, WorkflowJob>): string[] {
  return Object.entries(workflow).flatMap(([key, job]) =>
    (job.steps ?? []).flatMap((step, index) =>
      (step.run ?? "").includes("--project") && !RUNS_E2E.test(step.run ?? "")
        ? [`${key}: ${step.name ?? String(index)}`]
        : [],
    ),
  );
}

function withSteps(
  workflow: Record<string, WorkflowJob>,
  job: string,
  steps: WorkflowStep[],
): Record<string, WorkflowJob> {
  return { ...workflow, [job]: { ...workflow[job], steps } };
}

beforeAll(async () => {
  jobs = await readJobs();
  projects = await productionProjects();
  minting = await mintingSetups(projects);
  derived = {
    dependents: dependentsOf(projects, minting),
    teardowns: teardownProjects(projects, minting),
  };
});

describe("the scheduled production run uploads no Playwright trace (0509#5999)", () => {
  it("names the job and step that would upload an artifact", () => {
    const workflow: Record<string, WorkflowJob> = {
      spec: { steps: [{ name: "Upload the trace", uses: "actions/upload-artifact@v7" }] },
      suite: { steps: [{ uses: "actions/upload-artifact@v7" }] },
    };
    expect(artifactsUploaded(workflow)).toEqual(["spec: Upload the trace", "suite: 0"]);
  });

  it("uploads nothing from e2e-scheduled.yml, because a trace can hold the Access cookie", () => {
    expect(Object.keys(jobs).length).toBeGreaterThan(5);
    expect(artifactsUploaded(jobs)).toEqual([]);
  });
});

describe("every job that mints a session account tears it down on every exit path (0509#6968)", () => {
  it("derives the minting setup and the projects that run it from the e2e sources", () => {
    expect(minting).toEqual(["session"]);
    expect(derived.teardowns).toEqual(["session-teardown"]);
    expect(derived.dependents).toEqual(["session", "desktop-1440", "phone-390"]);
  });

  it("counts a step as minting only when it runs a project that depends on the session setup", () => {
    const mints = (run: string): boolean => mintsSession(run, projects, derived);
    expect(mints("npm run e2e -- e2e/j12-rollovers.spec.ts e2e/j11-weekly-brief.spec.ts --project=desktop-1440")).toBe(
      true,
    );
    expect(mints("npm run e2e -- e2e/security-headers.spec.ts --project=desktop-1440")).toBe(true);
    expect(mints("npm run e2e -- --shard=${{ matrix.shard }}/4 --grep-invert @scheduled")).toBe(true);
    expect(mints("npx playwright test --project=desktop-1440")).toBe(true);
    expect(mints("npm run e2e -- e2e/j1-magic-link.spec.ts --project=desktop-1440 --no-deps")).toBe(false);
    expect(mints("npm run e2e -- --project=setup")).toBe(false);
    expect(mints("npm run e2e -- e2e/security-headers.spec.ts --project=public-1440")).toBe(false);
    expect(mints('echo "::error::journey dispatches from main only"')).toBe(false);
  });

  it("reads every step that starts the suite, so no step escapes the rule", () => {
    const otherRunner: Record<string, WorkflowJob> = {
      spec: { steps: [{ name: "Run a spec", run: "./node_modules/.bin/playwright test --project=desktop-1440" }] },
    };
    expect(stepsRunningTheSuiteInAnotherWay(otherRunner)).toEqual(["spec: Run a spec"]);
    expect(stepsRunningTheSuiteInAnotherWay(jobs)).toEqual([]);
  });

  it("bites on a job that mints and drops its teardown, or reruns it only on success", () => {
    const flag = (steps: WorkflowStep[]): string[] =>
      missingTeardown(withSteps(jobs, "spec", steps), projects, derived);
    const spec = jobs.spec?.steps ?? [];
    expect(flag(spec.filter((step) => !(step.run ?? "").includes("--project=session-teardown")))).toEqual(["spec"]);
    expect(
      flag(
        spec.map((step) =>
          (step.run ?? "").includes("--project=session-teardown") ? { ...step, if: "success()" } : step,
        ),
      ),
    ).toEqual(["spec"]);
    expect(
      flag(
        spec.map((step) =>
          (step.run ?? "").includes("--project=public-1440") ? { ...step, run: `${step.run ?? ""} --no-deps` } : step,
        ),
      ),
    ).toEqual([]);
  });

  it("re-runs the teardown in every job that runs the session setup, and no other", () => {
    expect(jobsThatMint(jobs, projects, derived).sort()).toEqual(["j12", "spec", "suite-shard"]);
    expect(missingTeardown(jobs, projects, derived)).toEqual([]);
  });
});
