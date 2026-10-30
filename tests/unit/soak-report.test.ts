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

describe("soak-report's wrangler reads name themselves on failure (fleet-ops#10755)", () => {
  const helperLine = () =>
    (soakStep().run ?? "").split("\n").find((line) => line.includes("npx wrangler d1 execute")) ?? "";

  it("keeps pipefail, without which the jq downstream of a failed read exits 0 on no input", () => {
    expect((soakStep().run ?? "").trimStart().split("\n")[0]).toBe("set -euo pipefail");
  });

  it("captures wrangler's stdout, then prints the exit code and the body to stderr", () => {
    expect(helperLine()).toMatch(/local out; out=\$\(npx wrangler d1 execute 0509 --remote --json --command "\$1"\)/);
    expect(helperLine()).toContain(`printf 'wrangler d1 execute exited %s\\n%s\\n' "$?"`);
    expect(helperLine()).toMatch(/>&2; return 1;/);
  });

  it("rejects a payload with no results array, so a failed query cannot read as an empty one", () => {
    expect(helperLine()).toContain(`(if type == "array" then .[0].results else null end) // error("wrangler printed:`);
    expect(helperLine()).toContain(`[ -n "$out" ] ||`);
  });

  it("defines the helper once, above the reads that use it, and leaves no bare wrangler pipe into jq", () => {
    const run = soakStep().run ?? "";
    expect(run.match(/^d1\(\) \{$/gm) ?? []).toHaveLength(1);
    expect(run.match(/npx wrangler d1 execute/g) ?? []).toHaveLength(1);
    expect(run.indexOf("d1() {")).toBeLessThan(run.indexOf("sends=$(d1 "));
    expect(run).toContain("sweeps=$(d1 ");
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
    expect(failed.stderr).toContain("wrangler d1 execute exited 1");
    expect(failed.stderr).toContain("Authentication error [code: 10000]");

    const read = runD1("SELECT 1 AS ok");
    expect(read.status).toBe(0);
    expect(read.stderr).toBe("");
    expect(JSON.parse(read.stdout)).toEqual([{ ok: 1 }]);
  });

  function runJevRead(mode: "ok" | "fail"): { status: number | null; stdout: string; stderr: string } {
    const stub =
      mode === "fail"
        ? `npx() { printf '%s\\n' '{"error":{"text":"Authentication error [code: 10000]"}}'; exit 1; }`
        : `npx() { printf '%s\\n' '[{"results":[{"kind":"judge","code":"0001","n":2}],"success":true}]'; }`;
    const script = ["set -euo pipefail", stub, readerRun("jev-failures")].join("\n");
    const result = spawnSync("bash", ["-c", script], { encoding: "utf8" });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it("halts a jev-failures D1 read whose body is an error object and prints the cause (0509#4730)", () => {
    const failed = runJevRead("fail");
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("Authentication error [code: 10000]");

    const read = runJevRead("ok");
    expect(read.status).toBe(0);
    const rows = read.stdout
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line));
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toEqual({ kind: "judge", code: "0001", n: 2 });
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
