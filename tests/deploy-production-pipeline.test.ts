import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

// 0509#7004: the deploy job ran `npm run typecheck` and `npm test` a second
// time, on a tree the merge queue had already passed both on (ruleset 21391031
// has no bypass actor), and a red smoke test left the new Worker live with no
// step to undo it. Run 37179881263 was cancelled at the job's 20-minute cap
// 19 minutes into `npm test`, so that deploy shipped a day late.
//
// This pins the properties that remove both failure modes against the real
// workflow file: a restated copy would pass against a job that moved on.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = ".github/workflows/deploy-production.yml";

// The checks the merge queue runs before main accepts a tree. Repeating one of
// these in the deploy job is the finding, whichever spelling it uses.
const QUEUE_CHECKS = ["npm run typecheck", "npm test", "npx vitest", "npx tsc", "tsc -b"];

const CLOUDFLARE_TOKEN = "${{ secrets.CLOUDFLARE_API_TOKEN }}";
const CLOUDFLARE_ACCOUNT = "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}";

interface Step {
  id?: string;
  name?: string;
  if?: string;
  run?: string;
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

// Throws with the missing command in the message, so a job that lost the step
// fails the way the finding is worded instead of reading as `undefined`.
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

  it("keeps the job cap at the size of the reduced job", () => {
    // The 20-minute cap was spent in the test repeat that is now gone; a job
    // that the queue already tested does not need it.
    expect(job["timeout-minutes"]).toBeGreaterThan(0);
    expect(job["timeout-minutes"]).toBeLessThanOrEqual(10);
  });
});

describe("deploy-production rolls back on smoke failure (0509#7004)", () => {
  it("records the serving Worker version before the deploy replaces it", () => {
    const record = step("wrangler deployments status");
    expect(record.id, "the recording step needs an id for the rollback to read").toBe("previous");
    expect(indexOf("wrangler deployments status")).toBeLessThan(indexOf("npm run deploy"));
  });

  it("fails the deploy when the live version id cannot be read", () => {
    // No default target and no `// empty` fallback: a deploy with no way back
    // is what this step exists to prevent, so an unread version is one.
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
    expect(rollback.if).toBe("failure() && steps.deploy.outcome == 'success'");
    expect(runsOf(rollback)).toContain("npx wrangler rollback");
    expect(runsOf(rollback)).toContain("--message");
    expect(runsOf(rollback)).toContain("smoke failed");
    // The recorded version reaches the command through the environment, so
    // `run:` holds no template expression at all.
    expect(runsOf(rollback)).not.toContain("${{");
    expect(rollback.env?.ROLLBACK_TARGET).toBe("${{ steps.previous.outputs.version_id }}");
    expect(rollback.env?.CLOUDFLARE_API_TOKEN).toBe(CLOUDFLARE_TOKEN);
    expect(rollback.env?.CLOUDFLARE_ACCOUNT_ID).toBe(CLOUDFLARE_ACCOUNT);
  });

  it("rolls back after the smoke and before the fixture Workers", () => {
    // A failure in the fixture Workers below is test infrastructure, never the
    // app, and must not roll back a good deploy.
    const smokeAt = indexOf("/api/health");
    const rollbackAt = indexOf("wrangler rollback");
    const fixtureAt = indexOf("workers/fixture-site.wrangler.jsonc");
    expect(rollbackAt).toBeGreaterThan(smokeAt);
    expect(rollbackAt).toBeLessThan(fixtureAt);
  });
});
