import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOWS = path.join(REPO_ROOT, ".github/workflows");
const REQUIRED = [
  "Gitleaks",
  "codex-node-checks",
  "vitest-shard",
  "semgrep",
  "preview-assert",
  "base-fresh",
  "deploy-freeze",
];

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

describe("a stale base is caught on the pull request, not in the queue (2026-10-07 incident)", () => {
  it("rechecks base-fresh whenever a gate file changes on main, over the paths base-fresh reads", async () => {
    const retest = parse(await readFile(path.join(WORKFLOWS, "stale-base-retest.yml"), "utf8")) as {
      on: { push: { branches: string[]; paths: string[] } };
    };
    const ci = await readFile(path.join(WORKFLOWS, "ci.yml"), "utf8");
    const line = ci.split("\n").find((l) => l.includes("git log -1 --first-parent")) ?? "";
    const read = line
      .split(" -- ")
      .pop()
      ?.replace(")", "")
      .trim()
      .split(" ")
      .map((p) => p.replaceAll("'", ""))
      .sort();
    const pushed = retest.on.push.paths.map((p) => p.replace("/**", "")).sort();
    expect(retest.on.push.branches).toEqual(["main"]);
    expect(read).toEqual(pushed);
  });
});

describe("deploy-freeze freezes the queue on a red deploy (0509#7696)", () => {
  const ci = async (): Promise<string> => readFile(path.join(WORKFLOWS, "ci.yml"), "utf8");

  const gate = async (): Promise<WorkflowJob> => {
    const jobs = readJobs("ci.yml", await ci());
    const found = jobs.find(({ key }) => key === "deploy-freeze");
    if (!found) throw new Error("ci.yml has no deploy-freeze job");
    return found.job;
  };

  const run = async (): Promise<string> => {
    const steps = (await gate()).steps ?? [];
    const text = steps.map((step) => step.run ?? "").join("\n");
    if (!text.trim()) throw new Error("the deploy-freeze job has no run: step");
    return text;
  };

  it("reads the deploy runs on main, never another branch or a deployment event", async () => {
    expect(await run()).toContain("workflows/deploy-production.yml/runs?branch=main&status=completed");
  });

  it("blocks on anything that is not a green deploy, including a timeout and a startup failure", async () => {
    const text = await run();
    expect(text).toContain('select(.conclusion == "success"');
    for (const verdict of ["failure", "timed_out", "startup_failure"]) {
      expect(text).toContain(`.conclusion == "${verdict}"`);
    }
    expect(text).toContain('[ "$c" = success ]');
  });

  it("ignores a run that produced no verdict, so a cancelled or skipped deploy cannot freeze a healthy production", async () => {
    expect(await run()).not.toContain(".workflow_runs[0].conclusion");
  });

  it("opens the freeze for the repair, or the PR that fixes a red deploy could never merge", async () => {
    expect(await run()).toContain("grep -qx deploy-fix");
  });

  it("keeps the merge_group condition on the step, so the job reports on a pull request too", async () => {
    expect((await gate()).if).toBeUndefined();
    const steps = (await gate()).steps ?? [];
    expect(steps.map((step) => step.if)).toEqual(["github.event_name == 'merge_group'"]);
  });
});

describe("deploy-production.yml holds only the deploy job (0509#7656, fleet-ops#9889)", () => {
  it("keeps ci.yml off deployment_status", async () => {
    const ci = parse(await readFile(path.join(WORKFLOWS, "ci.yml"), "utf8")) as { on: Record<string, unknown> };
    expect(Object.keys(ci.on)).not.toContain("deployment_status");
  });

  it("runs no post-deploy job, so a run conclusion is the deploy's conclusion", async () => {
    const deploy = readJobs(
      "deploy-production.yml",
      await readFile(path.join(WORKFLOWS, "deploy-production.yml"), "utf8"),
    );
    expect(deploy.map(({ key }) => key)).toEqual(["deploy"]);
  });

  it("still gates the Lighthouse budgets on the pull request", async () => {
    const ci = parse(await readFile(path.join(WORKFLOWS, "ci.yml"), "utf8")) as { jobs: Record<string, WorkflowJob> };
    const runs = Object.values(ci.jobs)
      .flatMap((job) => job.steps ?? [])
      .map((step) => step.run ?? "");
    expect(runs.some((run) => run.includes("npx lhci collect"))).toBe(true);
    expect(runs.some((run) => run.includes("npx lhci assert --budgets-file=lighthouse-budget.pr.json"))).toBe(true);
  });
});
