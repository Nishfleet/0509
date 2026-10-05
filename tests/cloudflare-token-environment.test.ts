import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// 0509#7072: a job that reads a Cloudflare token secret without
// `environment: production` gets that token on any branch, because a branch can
// edit the workflow and dispatch it. The production environment allows `main`
// only, so the environment key is the gate. A string or `{ name }` both count.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOWS = path.join(REPO_ROOT, ".github/workflows");
const TOKEN = /secrets\.CLOUDFLARE_[A-Z_]*TOKEN|secrets\[['"]CLOUDFLARE_[A-Z_]*TOKEN['"]\]/;

interface WorkflowJob {
  environment?: string | { name?: string };
}

interface Job {
  file: string;
  key: string;
  job: WorkflowJob;
}

function readJobs(file: string, source: string): Job[] {
  const jobs = (parse(source) as { jobs?: Record<string, WorkflowJob> }).jobs ?? {};
  return Object.entries(jobs).map(([key, job]) => ({ file, key, job }));
}

function environmentName(job: WorkflowJob): string | undefined {
  const env = job.environment;
  if (typeof env === "string") return env;
  if (env !== null && typeof env === "object" && typeof env.name === "string") return env.name;
  return undefined;
}

function readsCloudflareToken(job: WorkflowJob): boolean {
  return TOKEN.test(JSON.stringify(job));
}

function tokenJobsWithoutProduction(jobs: Job[]): string[] {
  return jobs
    .filter(({ job }) => readsCloudflareToken(job) && environmentName(job) !== "production")
    .map(({ file, key }) => `${file}: ${key}`);
}

async function allJobs(): Promise<Job[]> {
  const files = (await readdir(WORKFLOWS)).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  const perFile = await Promise.all(
    files.map(async (file) => readJobs(file, await readFile(path.join(WORKFLOWS, file), "utf8"))),
  );
  return perFile.flat();
}

describe("jobs that read a Cloudflare token use environment: production (0509#7072)", () => {
  it("finds the jobs that read a Cloudflare token", async () => {
    const tokenJobs = (await allJobs()).filter(({ job }) => readsCloudflareToken(job));
    expect(tokenJobs.map(({ file, key }) => `${file}: ${key}`)).toEqual(
      expect.arrayContaining(["deploy-production.yml: deploy", "e2e-scheduled.yml: soak-report"]),
    );
  });

  it("puts every such job behind environment: production", async () => {
    expect(tokenJobsWithoutProduction(await allJobs())).toEqual([]);
  });

  it("flags a job that reads the token without environment: production", () => {
    const yaml = [
      "on: workflow_dispatch",
      "jobs:",
      "  leak:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - env:",
      "          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
      "        run: echo hi",
    ].join("\n");
    expect(tokenJobsWithoutProduction(readJobs("fixture.yml", yaml))).toEqual(["fixture.yml: leak"]);
  });

  it("flags a job-level env reading another Cloudflare token", () => {
    const yaml = [
      "on: workflow_dispatch",
      "jobs:",
      "  settings:",
      "    env:",
      "      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_SETTINGS_TOKEN }}",
      "    steps:",
      "      - run: echo hi",
    ].join("\n");
    expect(tokenJobsWithoutProduction(readJobs("fixture.yml", yaml))).toEqual(["fixture.yml: settings"]);
  });

  it("accepts environment.name: production", () => {
    const yaml = [
      "on: workflow_dispatch",
      "jobs:",
      "  gated:",
      "    environment:",
      "      name: production",
      "    steps:",
      "      - env:",
      "          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
      "        run: echo hi",
    ].join("\n");
    expect(tokenJobsWithoutProduction(readJobs("fixture.yml", yaml))).toEqual([]);
  });
});
