import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// The `preview-assert` workflow (0509#1576) runs the deploy job's own
// pre-deploy verification against the PR head and becomes a required status
// context on main, so it must satisfy the required-context contract: no
// job-level `if:`/`needs:`, an in-step authorizer as step 1, and a pinned
// checkout of the authorized SHA. It also runs the deploy gate's assertion
// commands unchanged (`npm run typecheck` + the FULL unsharded `npm run
// test`) and uploads a preview Worker version via Cloudflare's own mechanism
// (`wrangler versions upload --preview-alias`) without touching production.
const source = readFileSync(".github/workflows/preview-assert.yml", "utf8");
const parsed = parse(source) as {
  on?: Record<string, unknown>;
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  permissions?: Record<string, string>;
  jobs?: Record<string, WorkflowJob>;
};

type WorkflowStep = {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  "continue-on-error"?: unknown;
};

type WorkflowJob = {
  if?: string;
  needs?: string | string[];
  "runs-on"?: string | string[];
  environment?: string | { name?: string };
  steps?: WorkflowStep[];
};

const job = parsed.jobs?.["preview-assert"]!;
const steps = job.steps ?? [];

describe("preview-assert workflow", () => {
  it("runs on pull_request and merge_group (the required check on main)", () => {
    expect(parsed.on?.pull_request).toBeDefined();
    expect(parsed.on?.merge_group).toBeDefined();
    expect(parsed.on?.workflow_dispatch).toBeDefined();
  });

  it("serializes per-branch runs and cancels superseded PR checks", () => {
    expect(parsed.concurrency).toEqual({
      group: "preview-assert-${{ github.ref }}",
      "cancel-in-progress": true,
    });
  });

  it("carries no job-level if: and no needs (a required context must never conclude SKIPPED)", () => {
    expect(job.if).toBeUndefined();
    expect(job.needs).toBeUndefined();
    for (const step of steps) {
      expect(step["continue-on-error"]).toBeUndefined();
    }
  });

  it("authorizes in-step, first step, refusing forks and unapproved dispatches", () => {
    const authorize = steps[0];
    expect(authorize?.id).toBe("authorize");
    expect(authorize?.run).toContain('test "$HEAD_REPOSITORY" = "$GITHUB_REPOSITORY"');
    expect(authorize?.run).toContain('test "$EXPECTED_SHA" = "$GITHUB_SHA"');
    expect(authorize?.run).toContain('test "$GITHUB_REPOSITORY" = "Nishfleet/0509"');
  });

  it("checks out the in-step authorized SHA and re-verifies it", () => {
    const checkout = steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkout?.with).toMatchObject({
      ref: "${{ steps.authorize.outputs.sha }}",
      "fetch-depth": 0,
      clean: true,
      "persist-credentials": false,
    });
    const checkoutIndex = steps.indexOf(checkout!);
    expect(steps[checkoutIndex + 1]?.name).toMatch(/Verify (?:authorized|pinned)/);
    expect(steps[checkoutIndex + 1]?.run).toContain(
      'test "$(git rev-parse --verify HEAD)" = "$AUTHORIZED_SHA"',
    );
  });

  it("runs the deploy job's typecheck unchanged, with the same heap budget", () => {
    const typecheck = steps.find((step) => step.run === "npm run typecheck");
    expect(typecheck).toBeDefined();
    expect(typecheck?.env?.NODE_OPTIONS).toBe("--max-old-space-size=2048");
  });

  it("runs the FULL unsharded test suite exactly as the deploy job does", () => {
    const test = steps.find((step) => step.run === "npm run test");
    expect(test).toBeDefined();
    // The demonstrated failure class (run 33561746667) is a test that passes
    // sharded in PR CI and fails when the whole suite runs together on the
    // deploy runner. preview-assert runs the same unsharded command.
    expect(source).toContain("npm run test");
    expect(source).not.toContain("--shard=");
  });

  it("uploads a preview Worker version via Cloudflare's own mechanism", () => {
    const upload = steps.find((step) =>
      step.run?.includes("wrangler versions upload"),
    );
    expect(upload).toBeDefined();
    expect(upload?.run).toContain("--preview-alias");
    expect(upload?.env).toMatchObject({
      CLOUDFLARE_ACCOUNT_ID: "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
      CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}",
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    });
    // A version upload is inert and the preview URL is never requested
    // (the version carries production bindings).
    expect(upload?.run).toContain("wrangler versions upload");
    expect(upload?.run).toMatch(/never requested|do not request/);
  });

  it("references no production environment and no canary secret", () => {
    expect(job.environment).toBeUndefined();
    expect(source).not.toMatch(/secrets\.CANARY_BYPASS_TOKEN/);
    expect(source).not.toMatch(/secrets\.DODO/);
  });

  it("pins every remote action to a full commit SHA", () => {
    for (const reference of source.matchAll(/^\s*(?:uses:)\s*([^\s]+).*$/gm)) {
      expect(reference[1]).toMatch(/@[a-f0-9]{40}(?:\s|#|$)/);
    }
  });
});