import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// The `preview-assert` workflow (0509#1576) runs the deploy job's own
// pre-deploy verification against the PR head and becomes a required status
// context on main, so it must satisfy the required-context contract: no
// job-level `if:`/`needs:`, an in-step authorizer as step 1, and a pinned
// checkout of the authorized SHA. It runs the deploy gate's assertion
// commands unchanged (`npm run typecheck` + `npm run build`) and uploads a
// preview Worker version via Cloudflare's own mechanism
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

  it("runs no test step — ci.yml's unsharded suite owns coverage on every PR", () => {
    // The extra unsharded suite run existed only to catch a test that passed
    // sharded and failed under full-suite load (run 33561746667,
    // d1-remote-restore-evidence.test.ts:222 — a pidfile publish race inside
    // the spec). The race is fixed at the source (0509#2373), so re-running
    // the whole suite a second time per PR no longer buys anything; the
    // deploy job's own post-merge run is unchanged. (ci.yml is unsharded as
    // of batch 2, #3069: the shard jobs folded into codex-node-checks.)
    expect(steps.find((step) => step.run === "npm run test")).toBeUndefined();
    expect(source).not.toContain("npm run test");
    expect(source).not.toContain("--shard=");
  });

  it("builds with the deploy pipeline's own build before the bundle proof", () => {
    // `npm run build` emits build/server/wrangler.json (no_bundle, main
    // index.js) plus the .wrangler/deploy/config.json redirect the production
    // deploy uses. The dry-run bundle proof would fail to bundle the raw TS
    // entry without it — observed on the first preview-assert run of PR #1580.
    const build = steps.find((step) => step.run === "npm run build");
    const proof = steps.find((step) => step.run?.includes("wrangler deploy --dry-run"));
    expect(build).toBeDefined();
    expect(proof).toBeDefined();
    expect(steps.indexOf(build!)).toBeLessThan(steps.indexOf(proof!));
  });

  it("proves the bundle with a dry-run and never uploads a version to the production worker (2026-09-12)", () => {
    const proof = steps.find((step) => step.run?.includes("wrangler deploy --dry-run"));
    expect(proof).toBeDefined();
    expect(proof?.run).toContain("--outdir");
    expect(proof?.env).toMatchObject({
      CLOUDFLARE_ACCOUNT_ID: "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
      CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}",
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    });
    // ~200 `versions upload`s a day evicted every real deploy from Cloudflare's
    // version history (run 34679399412: rollback "Version not found") and blocked
    // `wrangler secret put`; the workflow must not upload versions anywhere.
    expect(steps.some((step) => step.run?.includes("wrangler versions upload"))).toBe(false);
    expect(proof?.run).toMatch(/no version uploaded/);
  });

  it("references no production environment and no canary secret", () => {
    expect(job.environment).toBeUndefined();
    expect(source).not.toMatch(/secrets\.CANARY_BYPASS_TOKEN/);
    expect(source).not.toMatch(/secrets\.DODO/);
  });

  it("does not invoke the post-deploy Gate C canary (it mutates production D1/email)", () => {
    // scripts/verify-post-deploy-release.mjs hardcodes https://0509.io and
    // writes billing records / sends proof emails. A preview version of the
    // production worker shares those bindings, so running Gate C from a PR
    // check would mutate production. The canary stays post-merge.
    expect(source).not.toContain("verify-post-deploy-release");
    expect(source).not.toContain("gate-c-soak");
    expect(source).not.toContain("npm run deploy");
  });

  it("pins every remote action to a full commit SHA", () => {
    for (const reference of source.matchAll(/^\s*(?:uses:)\s*([^\s]+).*$/gm)) {
      expect(reference[1]).toMatch(/@[a-f0-9]{40}(?:\s|#|$)/);
    }
  });
});