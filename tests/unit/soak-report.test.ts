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

interface SoakJob {
  environment?: string;
  steps?: SoakStep[];
}

function jobs(): Record<string, SoakJob> {
  const source = readFileSync(path.join(REPO_ROOT, WORKFLOW), "utf8");
  return (parse(source) as { jobs: Record<string, SoakJob> }).jobs;
}

function soakStep(): SoakStep {
  const source = readFileSync(path.join(REPO_ROOT, WORKFLOW), "utf8");
  const jobs = (parse(source) as { jobs: Record<string, { steps?: SoakStep[] }> }).jobs;
  const step = jobs["soak-report"]?.steps?.find((entry) => (entry.run ?? "").includes("Soak report for the 24 hours"));
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

describe("the production D1 reads use the environment that holds the token (0509#7736)", () => {
  it("declares `production` for jev-failures and soak-report", () => {
    expect(jobs()["jev-failures"]?.environment).toBe("production");
    expect(jobs()["soak-report"]?.environment).toBe("production");
  });

  it("type-checks every wrangler D1 read and names a redacted Cloudflare error", () => {
    const reads = (job: string) =>
      (jobs()[job]?.steps ?? [])
        .flatMap((step) => (step.run ?? "").split("\n"))
        .filter((line) => line.includes("wrangler d1 execute") && line.includes("--json"));
    expect([reads("jev-failures").length, reads("soak-report").length]).toEqual([2, 3]);
    for (const job of ["jev-failures", "soak-report"]) {
      for (const line of reads(job)) {
        expect(line).toContain('type == "array"');
        expect(line).toContain("D1 read failed");
        expect(line).toContain('gsub("[0-9a-f]{32}"');
      }
    }
  });
});
