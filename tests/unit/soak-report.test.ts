import { spawnSync } from "node:child_process";
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

  function readerRun(name: string): string {
    const step = (e2eJobs()[name]?.steps ?? []).find((entry) =>
      (entry.run ?? "").includes("wrangler d1 execute 0509 --remote"),
    );
    if (step === undefined) throw new Error(`${name} has no D1 read step`);
    return step.run ?? "";
  }

  function soakHelper(): string {
    const lines = (soakStep().run ?? "").split("\n");
    const start = lines.findIndex((line) => line === "d1() {");
    const end = lines.findIndex((line, index) => index > start && line === "}");
    if (start === -1 || end === -1) throw new Error("soak-report has no d1 helper");
    return lines.slice(start, end + 1).join("\n");
  }

  function runD1(sql: string): { status: number | null; stdout: string; stderr: string } {
    const stub = [
      "npx() {",
      '  case "$*" in',
      '    *FAIL*) printf \'%s\\n\' \'{"error":{"text":"Authentication error [code: 10000]"}}\'; return 1 ;;',
      "  esac",
      '  printf \'%s\\n\' \'[{"results":[{"ok":1}],"success":true}]\'',
      "}",
    ].join("\n");
    const script = ["set -euo pipefail", stub, soakHelper(), `d1 "${sql}"`].join("\n");
    const result = spawnSync("bash", ["-c", script], { encoding: "utf8" });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it("prints a failed D1 read's cause to stderr, where no $() capture eats it (0509#4730)", () => {
    const failed = runD1("SELECT * FROM FAIL");
    expect(failed.status).toBe(1);
    expect(failed.stdout).toBe("");
    expect(failed.stderr).toContain("wrangler exit 1");
    expect(failed.stderr).toContain("Authentication error [code: 10000]");

    const read = runD1("SELECT 1 AS ok");
    expect(read.status).toBe(0);
    expect(read.stderr).toBe("");
    expect(JSON.parse(read.stdout)).toEqual([{ ok: 1 }]);
  });

  it("halts a D1 read that returned an error object even when wrangler exits 0 (0509#4730)", () => {
    expect(readerRun("soak-report")).toContain("halt_error(1)");
    expect(readerRun("jev-failures")).toContain("halt_error(1)");
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
