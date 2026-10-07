import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// 0509#5738: on GitHub a SKIPPED required check counts as a pass (#4664 merged
// with a required check SKIPPED). So no required job may carry a job-level
// `if:`; its steps decide instead and the job always reports. The names below
// are the gate jobs `ci-ok` aggregates (0509#7013), and `ci-ok` is the one
// required_status_check of ruleset 21391031. A rename fails the first test
// instead of silently checking nothing. vitest-shard is the test matrix split
// out of codex-node-checks when one job no longer fit its timeout (0509#7163).

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOWS = path.join(REPO_ROOT, ".github/workflows");
const REQUIRED = ["Gitleaks", "codex-node-checks", "vitest-shard", "semgrep", "preview-assert"];

interface WorkflowStep {
  if?: unknown;
  run?: string;
}

interface WorkflowJob {
  name?: string;
  if?: unknown;
  needs?: string | string[];
  steps?: WorkflowStep[];
}

interface Job {
  file: string;
  key: string;
  reported: string;
  job: WorkflowJob;
}

function readJobs(file: string, source: string): Job[] {
  const jobs = (parse(source) as { jobs?: Record<string, WorkflowJob> }).jobs ?? {};
  return Object.entries(jobs).map(([key, job]) => ({ file, key, reported: job.name ?? key, job }));
}

async function allJobs(): Promise<Job[]> {
  const files = (await readdir(WORKFLOWS)).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  const perFile = await Promise.all(
    files.map(async (file) => readJobs(file, await readFile(path.join(WORKFLOWS, file), "utf8"))),
  );
  return perFile.flat();
}

describe("required checks always report (0509#5738)", () => {
  it("finds every required check as a job in some workflow", async () => {
    const reported = new Set((await allJobs()).map((job) => job.reported));
    expect(REQUIRED.filter((name) => !reported.has(name))).toEqual([]);
  });

  it("gives no required job a job-level if:", async () => {
    const offenders = (await allJobs())
      .filter(({ reported }) => REQUIRED.includes(reported))
      .filter(({ job }) => job.if !== undefined)
      .map(({ file, key }) => `${file}: ${key}`);
    expect(offenders).toEqual([]);
  });

  it("reads a job-level if: when one is there", () => {
    const yaml = [
      "on: push",
      "jobs:",
      "  semgrep:",
      "    if: github.event_name != 'x'",
      "    runs-on: ubuntu-latest",
    ].join("\n");
    const [job] = readJobs("fixture.yml", yaml);
    expect(job.reported).toBe("semgrep");
    expect(job.job.if).toBe("github.event_name != 'x'");
  });
});

describe("ci-ok aggregates every required check (0509#7013)", () => {
  it("needs every required job and runs even when one of them fails", async () => {
    const ciOk = (await allJobs()).find(({ file, reported }) => file === "ci.yml" && reported === "ci-ok");
    expect(ciOk?.job.if).toBe("always()");
    expect([ciOk?.job.needs ?? []].flat().sort()).toEqual([...REQUIRED].sort());
  });

  it("passes only when every needed job succeeded, never on a denylist of results", async () => {
    const ciOk = (await allJobs()).find(({ file, reported }) => file === "ci.yml" && reported === "ci-ok");
    const steps = ciOk?.job.steps ?? [];
    expect(steps.map((step) => step.if)).toEqual(["always()"]);
    expect(steps[0]?.run).toContain('all(.[]; .result == "success")');
  });
});

describe("a pull request is retested against current main before it queues (2026-10-07 incident)", () => {
  it("reruns ci.yml when a pull request is marked ready or armed for auto-merge", async () => {
    const ci = parse(await readFile(path.join(WORKFLOWS, "ci.yml"), "utf8")) as {
      on: { pull_request: { types: string[] } };
    };
    expect(ci.on.pull_request.types).toEqual(
      expect.arrayContaining(["opened", "synchronize", "reopened", "ready_for_review", "auto_merge_enabled"]),
    );
  });
});

describe("lighthouse runs after the deploy, not on deployment_status (0509#7013)", () => {
  it("keeps ci.yml off deployment_status and chains lighthouse to the deploy job", async () => {
    const ci = parse(await readFile(path.join(WORKFLOWS, "ci.yml"), "utf8")) as { on: Record<string, unknown> };
    expect(Object.keys(ci.on)).not.toContain("deployment_status");
    const deploy = readJobs(
      "deploy-production.yml",
      await readFile(path.join(WORKFLOWS, "deploy-production.yml"), "utf8"),
    );
    expect(deploy.find(({ key }) => key === "lighthouse")?.job.needs).toEqual(["deploy"]);
  });
});
