import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = ".github/workflows/deploy-production.yml";

const QUEUE_CHECKS = ["npm run typecheck", "npm test", "npx vitest", "npx tsc", "tsc -b"];

const CLOUDFLARE_TOKEN = "${{ secrets.CLOUDFLARE_API_TOKEN }}";
const CLOUDFLARE_ACCOUNT = "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}";

interface Step {
  id?: string;
  name?: string;
  if?: string;
  run?: string;
  "timeout-minutes"?: number;
  env?: Record<string, string>;
}

interface DeployJob {
  if?: string;
  "timeout-minutes"?: number;
  steps: Step[];
}

interface DeployWorkflow {
  jobs: { deploy: DeployJob };
}

let job: DeployJob;

function runsOf(step: Step | undefined): string {
  return step?.run ?? "";
}

function step(needle: string): Step {
  const found = job.steps.find((candidate) => runsOf(candidate).includes(needle));
  if (!found) throw new Error(`the deploy job has no step running \`${needle}\``);
  return found;
}

function indexOf(needle: string): number {
  return job.steps.indexOf(step(needle));
}

beforeAll(async () => {
  const workflow = parse(await readFile(path.join(REPO_ROOT, WORKFLOW), "utf8")) as DeployWorkflow;
  job = workflow.jobs.deploy;
});

describe("deploy-production does not repeat the merge queue (0509#7004)", () => {
  it("runs no typecheck or test command the queue already ran", () => {
    const repeats = job.steps.filter((candidate) => QUEUE_CHECKS.some((c) => runsOf(candidate).includes(c)));
    expect(repeats.map((candidate) => candidate.name ?? candidate.run)).toEqual([]);
  });

  it("still builds, because `npm run deploy` uploads the build output", () => {
    expect(job.steps.some((candidate) => runsOf(candidate) === "npm run build")).toBe(true);
  });

  it("deploys only from main, so a dispatch from a branch cannot ship untested code", () => {
    expect(job.if ?? "").toContain("github.ref == 'refs/heads/main'");
  });

  it("keeps the job cap below the old 20 minutes but above 10", () => {
    expect(job["timeout-minutes"]).toBeGreaterThan(10);
    expect(job["timeout-minutes"]).toBeLessThan(20);
  });

  it("bounds the smoke with its own step timeout, so a hang fails the step", () => {
    expect(step("/api/health")["timeout-minutes"]).toBe(3);
  });
});

describe("deploy-production rolls back on smoke failure (0509#7004)", () => {
  it("records the serving Worker version before the deploy replaces it", () => {
    const record = step("wrangler deployments status");
    expect(record.id, "the recording step needs an id for the rollback to read").toBe("previous");
    expect(indexOf("wrangler deployments status")).toBeLessThan(indexOf("npm run deploy"));
  });

  it("fails the deploy when the live version id cannot be read", () => {
    const run = runsOf(step("wrangler deployments status"));
    expect(run).toContain("exit 1");
    expect(run).toContain("$GITHUB_OUTPUT");
    expect(run).not.toMatch(/\|\|\s*echo/);
  });

  it("ids the deploy and smoke steps the rollback condition reads", () => {
    expect(step("npm run deploy").id).toBe("deploy");
    expect(step("/api/health").id).toBe("smoke");
  });

  it("rolls back to the recorded version when the smoke test fails", () => {
    const rollback = step("wrangler rollback");

    expect(rollback.if).toBe("always() && steps.deploy.outcome == 'success' && steps.smoke.outcome != 'success'");
    expect(runsOf(rollback)).toContain("npx wrangler rollback");

    expect(runsOf(rollback)).toContain(" --yes ");
    expect(runsOf(rollback)).toContain("--message");
    expect(runsOf(rollback)).toContain("smoke failed");

    expect(runsOf(rollback)).not.toContain("${{");
    expect(rollback.env?.ROLLBACK_TARGET).toBe("${{ steps.previous.outputs.version_id }}");
    expect(rollback.env?.CLOUDFLARE_API_TOKEN).toBe(CLOUDFLARE_TOKEN);
    expect(rollback.env?.CLOUDFLARE_ACCOUNT_ID).toBe(CLOUDFLARE_ACCOUNT);
  });

  it("rolls back after the smoke and before the fixture Workers", () => {
    const smokeAt = indexOf("/api/health");
    const rollbackAt = indexOf("wrangler rollback");
    const fixtureAt = indexOf("workers/fixture-site.wrangler.jsonc");
    expect(rollbackAt).toBeGreaterThan(smokeAt);
    expect(rollbackAt).toBeLessThan(fixtureAt);
  });
});
