import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOW = ".github/workflows/e2e-scheduled.yml";
const CI = ".github/workflows/ci.yml";

interface SoakStep {
  name?: string;
  env?: Record<string, string>;
  run?: string;
}

function soakStep(): SoakStep {
  const step = e2eJobs()["soak-report"]?.steps?.find((entry) => (entry.run ?? "").includes("Soak report for the 24 hours"));
  if (step === undefined) throw new Error("soak-report has no comment-posting run step");
  return step;
}

interface JobWithEnvironment {
  environment?: unknown;
  steps?: SoakStep[];
}

function e2eJobs(): Record<string, JobWithEnvironment> {
  const source = readFileSync(path.join(REPO_ROOT, WORKFLOW), "utf8");
  return (parse(source) as { jobs: Record<string, JobWithEnvironment> }).jobs;
}

describe("soak-report measures the two DONE lines (0509#7076)", () => {
  it("counts last-24h Sentry GitHub issues, failing closed when gh cannot read them", () => {
    const run = soakStep().run ?? "";
    expect(run).toContain("author:app/sentry");
    expect(run).toContain('sentry_n" = "0"');
    expect(run).not.toContain('sentry_json="[]"');
    expect(run).not.toContain("no Sentry auth token is a repository secret");
  });

  it("reads healthchecks.io with a repo secret and fails the soak when checks are not up", () => {
    const step = soakStep();
    const run = step.run ?? "";
    expect(step.env?.HEALTHCHECKS_API_KEY).toBe("${{ secrets.HEALTHCHECKS_API_KEY }}");
    expect(run).toContain("https://healthchecks.io/api/v3/checks/");
    expect(run).toContain('status == "up"');
    expect(run).toContain("-H @-");
    expect(run).not.toContain('-H "X-Api-Key: $HEALTHCHECKS_API_KEY"');
    expect(run).not.toContain("no healthchecks.io read key is a repository secret");
  });

  it("is named in the pull_request disk-reading detector list", () => {
    expect(readFileSync(path.join(REPO_ROOT, CI), "utf8")).toContain("tests/unit/soak-report.test.ts");
  });
});

describe("a production D1 read declares its environment and runs only on main (0509#7773, #7072)", () => {
  function d1ReaderJobs(): [string, { environment?: unknown; if?: string; steps?: SoakStep[] }][] {
    return Object.entries(e2eJobs()).filter(([, job]) =>
      (job.steps ?? []).some((step) => (step.run ?? "").includes("wrangler d1 execute 0509 --remote")),
    );
  }

  it("derives the D1 reader census", () => {
    expect(d1ReaderJobs().map(([name]) => name)).toEqual(["jev-failures", "soak-report"]);
  });

  it("declares an environment, so the branch policy and the secret resolution are explicit", () => {
    for (const [, job] of d1ReaderJobs()) {
      expect(job.environment).toBeDefined();
    }
  });

  it("runs only on main", () => {
    for (const [, job] of d1ReaderJobs()) {
      expect(job.if).toContain("github.ref == 'refs/heads/main'");
    }
  });

  it("runs no dependency install script beside the Cloudflare token", () => {
    for (const [, job] of d1ReaderJobs()) {
      const install = (job.steps ?? []).map((step) => step.run ?? "").filter((run) => run.startsWith("npm ci"));
      expect(install).toEqual(["npm ci --ignore-scripts"]);
    }
  });
});
