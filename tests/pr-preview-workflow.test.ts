import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// 0509#7336. The owner reviews pull requests from a phone, so a review had to
// start from a screenshot or a local rebuild. pr-preview.yml uploads the pull
// request head as a version of the `0509-preview` Worker and points one GitHub
// Deployment at that version's preview URL.
//
// This pins the properties that make the link correct, against the real
// workflow file: a restated copy would pass against a job that moved on. The
// two properties that matter most are the ones with no visible failure mode:
//
//   * a `wrangler deploy` anywhere in this job would publish the preview build
//     in front of the Worker's own hostname, which is not behind Cloudflare
//     Access (the Access app covers `*-0509-preview.<subdomain>.workers.dev`);
//   * a preview URL or a BETTER_AUTH_URL derived from anything but the pull
//     request number would give the second push a different link, which is the
//     one thing the issue asks not to happen.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = ".github/workflows/pr-preview.yml";

interface Step {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
}

interface Job {
  name?: string;
  if?: unknown;
  "timeout-minutes"?: number;
  steps: Step[];
}

interface Workflow {
  name: string;
  on: { pull_request?: { types?: string[] } } & Record<string, unknown>;
  permissions: Record<string, string>;
  concurrency: { group: string; "cancel-in-progress"?: boolean };
  jobs: Record<string, Job>;
}

const read = async (): Promise<Workflow> =>
  parse(await readFile(path.join(REPO_ROOT, WORKFLOW), "utf8")) as unknown as Workflow;

const runsOf = (job: Job): string[] => (job.steps ?? []).map((step) => step.run ?? "").filter(Boolean);

const envsOf = (job: Job): Record<string, string>[] => (job.steps ?? []).map((step) => step.env ?? {});

describe("pr-preview.yml uploads a preview version (0509#7336)", () => {
  it("runs on the pull request events that need a fresh preview", async () => {
    const workflow = await read();
    expect(Object.keys(workflow.on)).toEqual(["pull_request"]);
    expect(workflow.on.pull_request?.types).toEqual(["opened", "synchronize", "reopened"]);
  });

  it("asks for no more than reading the repo and writing a deployment", async () => {
    const workflow = await read();
    expect(workflow.permissions).toEqual({ contents: "read", deployments: "write" });
  });

  it("runs one preview per pull request, cancelling the superseded upload", async () => {
    const workflow = await read();
    expect(workflow.concurrency["cancel-in-progress"]).toBe(true);
    // The group must carry the pull request number: a group shared by every PR
    // would cancel one PR's preview when another PR pushes.
    expect(workflow.concurrency.group).toContain("github.event.pull_request.number");
  });

  it("never deploys, because a deploy publishes to the Worker's own hostname", async () => {
    const workflow = await read();
    const job = Object.values(workflow.jobs)[0] as Job;
    const shell = runsOf(job).join("\n");
    expect(shell).not.toMatch(/wrangler deploy|npm run deploy|wrangler versions deploy/);
    expect(shell).toContain("wrangler versions upload");
  });

  it("builds the preview environment, not the production one", async () => {
    const workflow = await read();
    const job = Object.values(workflow.jobs)[0] as Job;
    expect(runsOf(job).join("\n")).toContain("CLOUDFLARE_ENV=preview npm run build");
  });

  it("uploads every action it uses pinned to a commit SHA", async () => {
    const workflow = await read();
    const job = Object.values(workflow.jobs)[0] as Job;
    const uses = (job.steps ?? []).map((step) => step.uses).filter((value): value is string => Boolean(value));
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) {
      // Hash-pinned is what .github/zizmor.yml requires of every action; an
      // unpinned `uses:` fails the audit, and a test catches it before the push.
      expect(action, action).toMatch(/@[0-9a-f]{40}(\s|$)/);
    }
  });

  it("names the Worker it uploads to in the config it builds from", async () => {
    // The preview Worker, never the production one: Nish ruled on 2026-09-04
    // that uploading previews to the serving Worker evicted real deploys from
    // its version history. The workflow never names a Worker, so this is the
    // assertion that keeps it that way: any `--name` here bypasses env.preview.
    const workflow = await read();
    const job = Object.values(workflow.jobs)[0] as Job;
    const shell = runsOf(job).join("\n");
    expect(shell).not.toMatch(/--name\b/);
  });
});

describe("the preview link is one per pull request (0509#7336)", () => {
  it("derives the alias and the URL from the same pull request number", async () => {
    const workflow = await read();
    const job = Object.values(workflow.jobs)[0] as Job;
    const envs = envsOf(job);
    const alias = envs.map((env) => env.PREVIEW_ALIAS ?? "").find(Boolean);
    const url = envs.map((env) => env.PREVIEW_URL ?? "").find(Boolean);
    expect(alias).toBe("pr-${{ github.event.pull_request.number }}");
    expect(url).toBe("https://pr-${{ github.event.pull_request.number }}-0509-preview.nishant345.workers.dev");
    expect(url?.startsWith(`https://${alias}-`)).toBe(true);
  });

  it("points the preview's auth URL at the preview itself", async () => {
    const workflow = await read();
    const job = Object.values(workflow.jobs)[0] as Job;
    const upload = runsOf(job).find((run) => run.includes("wrangler versions upload")) ?? "";
    // The URL in wrangler.jsonc is production, so without this the preview's
    // magic-link mail would carry a 0509.io link and land the reader on the
    // production app instead of the copy under review.
    expect(upload).toContain('--var "BETTER_AUTH_URL:${PREVIEW_URL}"');
  });

  it("reuses the pull request's deployment instead of adding a second one", async () => {
    const workflow = await read();
    const job = Object.values(workflow.jobs)[0] as Job;
    const publish = runsOf(job).find((run) => run.includes("/deployments")) ?? "";
    expect(publish).toContain("deployments?environment=preview&ref=${DEPLOY_REF}");
    expect(publish).toContain('gh api -X POST "repos/${GH_REPO}/deployments"');
    // The status is what carries the link, and it is posted against the
    // deployment found or created above rather than a fresh one.
    expect(publish).toContain("deployments/${deployment}/statuses");
    expect(publish).toContain("environment_url");
    // A deployment that requires contexts gates a merge; the merge queue's one
    // required check is `ci-ok`, and a preview deployment must never join it.
    expect(publish).toContain("required_contexts");
  });

  it("gives the deployment the pull request's head branch, so a push re-reads it", async () => {
    const workflow = await read();
    const job = Object.values(workflow.jobs)[0] as Job;
    const refs = envsOf(job)
      .map((env) => env.DEPLOY_REF ?? "")
      .filter(Boolean);
    expect(refs).toEqual(["${{ github.event.pull_request.head.ref }}"]);
  });

  it("fails with a named cause when the repository secrets are not there", async () => {
    // A pull request from a fork carries no secrets. Without this the job dies
    // inside wrangler with an opaque auth error and the reviewer has nothing to
    // tap.
    const workflow = await read();
    const job = Object.values(workflow.jobs)[0] as Job;
    const upload = runsOf(job).find((run) => run.includes("wrangler versions upload")) ?? "";
    expect(upload).toContain("::error::");
    expect(upload).toContain("CLOUDFLARE_API_TOKEN");
  });

  it("is not one of the required checks the merge queue reads", async () => {
    // tests/required-checks-never-skip.test.ts pins the gate list. A preview
    // job that took a gate name would either be ignored or, worse, become a
    // check the queue waits on while it uploads to Cloudflare.
    const workflow = await read();
    const job = Object.values(workflow.jobs)[0] as Job;
    const reported = job.name ?? Object.keys(workflow.jobs)[0];
    expect(reported).not.toMatch(/^(Gitleaks|codex-node-checks|vitest-shard|semgrep|preview-assert|base-fresh|ci-ok)$/);
    expect(job.if).toBeUndefined();
  });
});
