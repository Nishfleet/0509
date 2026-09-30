import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// 0509#5738: on GitHub a SKIPPED required check counts as a pass (#4664 merged
// with a required check SKIPPED). So no required job may carry a job-level
// `if:`; its steps decide instead and the job always reports. The names below
// are the required_status_checks of ruleset 21391031 that are jobs in this repo.
// A rename fails the first test instead of silently checking nothing.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOWS = path.join(REPO_ROOT, ".github/workflows");
const REQUIRED = ["Gitleaks", "codex-node-checks", "semgrep", "preview-assert"];

interface Job {
  file: string;
  key: string;
  reported: string;
  body: readonly string[];
}

// No YAML parser is in the stack (docs/REBUILD-STACK.md), so jobs are read by
// indentation, by reading each job block in turn.
function readJobs(file: string, yaml: string): Job[] {
  const lines = yaml.split("\n");
  const jobsAt = lines.indexOf("jobs:");
  if (jobsAt === -1) return [];
  const headers = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => index > jobsAt && /^ {2}[A-Za-z_][A-Za-z0-9_-]*:\s*$/.test(line));
  return headers.map(({ line, index }, n) => {
    const end = n + 1 < headers.length ? headers[n + 1].index : lines.length;
    const body = lines.slice(index + 1, end);
    const key = line.trim().slice(0, -1);
    const named = body.find((l) => /^ {4}name:\s*/.test(l));
    const reported = named
      ? named
          .replace(/^ {4}name:\s*/, "")
          .replace(/^["']|["']$/g, "")
          .trim()
      : key;
    return { file, key, reported, body };
  });
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
      .filter((job) => REQUIRED.includes(job.reported))
      .filter((job) => job.body.some((l) => /^ {4}if:/.test(l)))
      .map((job) => `${job.file}: ${job.key}`);
    expect(offenders).toEqual([]);
  });

  it("reads a job-level if: when one is there", () => {
    const yaml = [
      "on: push",
      "jobs:",
      "  semgrep:",
      "    if: github.event_name != 'x'",
      "    runs-on: ubuntu-latest",
      "",
    ].join("\n");
    const [job] = readJobs("fixture.yml", yaml);
    expect(job.reported).toBe("semgrep");
    expect(job.body.some((l) => /^ {4}if:/.test(l))).toBe(true);
  });
});
