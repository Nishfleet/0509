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

interface JobWithEnvironment {
  environment?: unknown;
  if?: string;
  steps?: SoakStep[];
}

function e2eJobs(): Record<string, JobWithEnvironment> {
  const source = readFileSync(path.join(REPO_ROOT, WORKFLOW), "utf8");
  return (parse(source) as { jobs: Record<string, JobWithEnvironment> }).jobs;
}

function soakStep(): SoakStep {
  const step = e2eJobs()["soak-report"]?.steps?.find((entry) =>
    (entry.run ?? "").includes("Soak report for the 24 hours"),
  );
  if (step === undefined) throw new Error("soak-report has no comment-posting run step");
  return step;
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
  function d1ReaderJobs(): [string, JobWithEnvironment][] {
    return Object.entries(e2eJobs()).filter(([, job]) =>
      (job.steps ?? []).some((step) => (step.run ?? "").includes("wrangler d1 execute 0509 --remote")),
    );
  }

  it("derives the D1 reader census", () => {
    expect(
      d1ReaderJobs()
        .map(([name]) => name)
        .sort(),
    ).toEqual(["jev-failures", "soak-report"].sort());
  });

  it("runs in production-e2e, the environment the D1-read token of #7072 lands in", () => {
    for (const [, job] of d1ReaderJobs()) {
      expect(job.environment).toBe("production-e2e");
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

describe("soak-report's wrangler reads name themselves on failure (0509#10755)", () => {
  it("captures wrangler's output and prints the exit code and the body before failing", () => {
    const run = soakStep().run ?? "";
    expect(run).toContain('out=$(npx wrangler d1 execute 0509 --remote --json --command "$1" 2>"$errf")');
    expect(run).toContain('echo "wrangler d1 execute exited $?"');
    expect(run).toContain('echo "$out"');
  });

  it("keeps wrangler's stderr out of the JSON jq parses, so noise cannot re-hide the cause", () => {
    const run = soakStep().run ?? "";
    expect(run).toContain('2>"$errf"');
    expect(run).not.toContain('2>&1');
    expect(run).toContain('cat "$errf"');
  });

  it("runs the sends and sweeps reads through that helper, leaving no bare wrangler pipe into jq", () => {
    const run = soakStep().run ?? "";
    expect(run).toContain("sends=$(d1 ");
    expect(run).toContain("sweeps=$(d1 ");
    expect(run).not.toMatch(/wrangler d1 execute[^\n]*\| jq/);
  });
});
