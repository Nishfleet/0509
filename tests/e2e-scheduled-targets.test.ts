import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCTION = "https://0509.io";
const STAGING = "https://staging.0509.io";
const PRODUCTION_JOBS = ["signin", "backup-proof", "jev-failures"];

interface Step {
  run?: string;
  env?: Record<string, string>;
}

interface Job {
  environment?: string;
  env?: Record<string, string>;
  steps?: Step[];
}

const workflow = parse(readFileSync(path.join(REPO_ROOT, ".github/workflows/e2e-scheduled.yml"), "utf8")) as {
  env?: Record<string, string>;
  jobs: Record<string, Job>;
};

const e2eSteps = Object.entries(workflow.jobs).flatMap(([key, job]) =>
  (job.steps ?? [])
    .filter((step) => (step.run ?? "").includes("npm run e2e"))
    .map((step) => ({
      key,
      target:
        step.env?.PLAYWRIGHT_TEST_BASE_URL ??
        job.env?.PLAYWRIGHT_TEST_BASE_URL ??
        workflow.env?.PLAYWRIGHT_TEST_BASE_URL,
    })),
);

describe("e2e-scheduled targets staging, and only signin targets production", () => {
  it("defaults every job to staging at the workflow level", () => {
    expect(workflow.env?.PLAYWRIGHT_TEST_BASE_URL).toBe(STAGING);
  });

  it("runs every Playwright step against staging except signin, which keeps production", () => {
    expect([...new Set(e2eSteps.map(({ key }) => key))].sort()).toEqual(["j12", "j8", "signin", "spec", "suite-shard"]);
    for (const { key, target } of e2eSteps) {
      expect(target, key).toBe(key === "signin" ? PRODUCTION : STAGING);
    }
  });

  it("names the production origin in no job but the production ones", () => {
    const offenders = Object.entries(workflow.jobs)
      .filter(([key]) => !PRODUCTION_JOBS.includes(key))
      .filter(([, job]) => JSON.stringify(job).includes(`${PRODUCTION}"`))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it("holds the kept-account and live-sweep jobs in the staging environment, signin in production-e2e", () => {
    for (const key of ["j12", "spec", "j8", "suite-shard", "soak-report"]) {
      expect(workflow.jobs[key]?.environment, key).toBe("staging");
    }
    for (const key of PRODUCTION_JOBS) expect(workflow.jobs[key]?.environment, key).toBe("production-e2e");
  });
});
