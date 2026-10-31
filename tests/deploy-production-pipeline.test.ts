import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = ".github/workflows/deploy-production.yml";
const STAGING_WORKFLOW = ".github/workflows/deploy-staging.yml";

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
  needs?: string | string[];
  concurrency?: { group: string };
  environment?: { name: string; url?: string };
  "timeout-minutes"?: number;
  steps: Step[];
}

interface DeployWorkflow {
  jobs: Record<string, DeployJob> & { deploy: DeployJob; staging: DeployJob };
  on?: Record<string, unknown>;
}

let job: DeployJob;
let workflow: DeployWorkflow;
let stagingWorkflow: DeployWorkflow;

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
  workflow = parse(await readFile(path.join(REPO_ROOT, WORKFLOW), "utf8")) as DeployWorkflow;
  stagingWorkflow = parse(await readFile(path.join(REPO_ROOT, STAGING_WORKFLOW), "utf8")) as DeployWorkflow;
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

describe("deploy-staging deploys staging with cf on its own workflow", () => {
  const staging = () => stagingWorkflow.jobs.staging;
  const stagingStep = (needle: string): Step => {
    const found = staging().steps.find((candidate) => runsOf(candidate).includes(needle));
    if (!found) throw new Error(`the staging job has no step running \`${needle}\``);
    return found;
  };
  const stagingIndex = (needle: string): number => staging().steps.indexOf(stagingStep(needle));

  it("runs from main in the staging environment under its own concurrency group, outside the production workflow", () => {
    expect(staging().if).toContain("github.ref == 'refs/heads/main'");
    expect(staging().environment?.name).toBe("staging");
    expect(staging().concurrency?.group).toBe("deploy-staging");
    expect(staging().concurrency?.group).not.toBe(job.concurrency?.group);
    expect(staging()["timeout-minutes"]).toBeLessThanOrEqual(15);
    expect(Object.keys(workflow.jobs)).toEqual(["deploy"]);
    expect(Object.keys(stagingWorkflow.jobs)).toEqual(["staging"]);
    expect(stagingWorkflow.on?.push).toEqual({ branches: ["main"] });
  });

  it("is not needed by anything, and needs nothing", () => {
    expect(staging().needs).toBeUndefined();
    const dependents = Object.entries(stagingWorkflow.jobs)
      .filter(([, other]) => [other.needs ?? []].flat().includes("staging"))
      .map(([key]) => key);
    expect(dependents).toEqual([]);
    expect(job.needs).toBeUndefined();
  });

  it("builds in staging mode, migrates, deploys prebuilt in staging mode, then smokes the staging origin", () => {
    expect(runsOf(stagingStep("react-router build"))).toBe(
      "CLOUDFLARE_VITE_FORCE_BUILD_OUTPUT=true npx react-router build --mode staging",
    );
    expect(runsOf(stagingStep("cf deploy"))).toContain("npx cf deploy --prebuilt --mode staging");
    expect(runsOf(stagingStep("cf d1 migrations apply"))).toContain("jq -r .env.DB.id");
    expect(stagingIndex("react-router build")).toBeLessThan(stagingIndex("cf d1 migrations apply"));
    expect(stagingIndex("cf d1 migrations apply")).toBeLessThan(stagingIndex("cf deploy"));
    expect(stagingIndex("cf deploy")).toBeLessThan(stagingIndex("https://staging.0509.io/api/health"));
    const smoke = stagingStep("/api/health");
    expect(runsOf(smoke)).toContain('"commit\\":\\"$GITHUB_SHA\\"');
    expect(smoke["timeout-minutes"]).toBe(3);
  });

  it("uses cf only, never wrangler", () => {
    expect(JSON.stringify(staging())).not.toMatch(/wrangler/i);
  });

  it("hands the Dodo test key from the GitHub secret to the Worker through a private temp file", () => {
    const deploy = stagingStep("cf deploy");
    const run = runsOf(deploy);
    expect(deploy.env?.DODO_TEST_API_KEY).toBe("${{ secrets.DODO_TEST_API_KEY }}");
    expect(run).toContain("DODO_PAYMENTS_API_KEY");
    expect(run).toContain("mktemp");
    expect(run).toContain("rm -f");
    expect(run).toContain('--secrets-file "$secrets"');
    expect(run).not.toMatch(/echo[^\n]*\$\{?DODO|printf[^\n]*\$\{?DODO|set -x|--text|--body/);
    expect(run).not.toContain("${{");
    const others = JSON.stringify(staging().steps.filter((candidate) => candidate !== deploy));
    expect(others).not.toContain("DODO_TEST_API_KEY");
  });

  it("requires a staging value for every secret binding the staging config declares, before it deploys", () => {
    const deploy = stagingStep("cf deploy");
    for (const name of [
      "BETTER_AUTH_SECRET",
      "TURNSTILE_SITE_KEY",
      "TURNSTILE_SECRET_KEY",
      "DODO_WEBHOOK_SECRET",
      "SLACK_TARGET_SECRET",
    ]) {
      expect(deploy.env?.[name], name).toBe(`\${{ secrets.STAGING_${name} }}`);
    }
    const run = runsOf(deploy);
    expect(run).toContain("::error::staging needs its own value for:");
    expect(run.indexOf("::error::")).toBeLessThan(run.indexOf("cf deploy"));
  });

  it("keeps the staging token in the steps that call cf, never in install-script reach", () => {
    expect(JSON.stringify(staging())).not.toMatch(/NPM_CONFIG_IGNORE_SCRIPTS/);
    for (const candidate of staging().steps.filter((step) => runsOf(step).includes("npx cf"))) {
      expect(candidate.env?.CLOUDFLARE_API_TOKEN).toBe(CLOUDFLARE_TOKEN);
      expect(candidate.env?.CLOUDFLARE_ACCOUNT_ID).toBe(CLOUDFLARE_ACCOUNT);
    }
  });
});
