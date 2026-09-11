import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// Required contexts under branch protection: "Gitleaks" (secret-scan.yml) and
// "codex-node-checks" (ci.yml). A required job must be structurally incapable
// of concluding SKIPPED - GitHub counts a skipped required context as
// satisfying branch protection. So a required job carries no job-level `if:`
// (an if: can skip on cancellation or any future condition edit) and no
// `needs` (a job with needs is skipped when its dependency fails), and its
// authorizer runs as the first STEP, refusing fork PRs and unapproved
// dispatch candidates with a real failure. This regression fails on the
// pre-fix shape (job-level `if:` + `needs: authorize_release`) and passes on
// the healed shape (in-step authorizer, pinned SHA checkout).
const REQUIRED_JOBS = [
  [".github/workflows/secret-scan.yml", "gitleaks"],
  [".github/workflows/ci.yml", "codex-node-checks"],
  [".github/workflows/ci.yml", "dependabot-critical-check"],
  // preview-assert (0509#1576) becomes a required context on main once the
  // orchestrator adds it to branch protection; it must satisfy the same
  // never-skipped contract from day one.
  [".github/workflows/preview-assert.yml", "preview-assert"],
] as const;

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
  steps?: WorkflowStep[];
};

function requiredJob(workflowPath: string, jobId: string) {
  const parsed = parse(readFileSync(workflowPath, "utf8")) as {
    jobs: Record<string, WorkflowJob>;
  };
  const job = parsed.jobs[jobId];
  expect(job, `${workflowPath}: required job ${jobId} must exist`).toBeDefined();
  return job!;
}

describe("required contexts can never conclude skipped", () => {
  it("required jobs carry no job-level if: and no needs", () => {
    for (const [workflowPath, jobId] of REQUIRED_JOBS) {
      const job = requiredJob(workflowPath, jobId);
      expect(
        job.if,
        `${workflowPath}:${jobId} job-level \`if:\` would let the required context conclude SKIPPED`,
      ).toBeUndefined();
      expect(
        job.needs,
        `${workflowPath}:${jobId} \`needs\` skips the job when its dependency fails`,
      ).toBeUndefined();
    }
  });

  it("required jobs authorize in-step, first step, and never swallow failure", () => {
    for (const [workflowPath, jobId] of REQUIRED_JOBS) {
      const steps = requiredJob(workflowPath, jobId).steps ?? [];
      const authorize = steps[0];
      expect(
        authorize?.id,
        `${workflowPath}: first step must be the authorizer (id: authorize)`,
      ).toBe("authorize");
      expect(
        authorize?.run,
        `${workflowPath}: authorizer must refuse fork PRs with a real failure`,
      ).toContain('test "$HEAD_REPOSITORY" = "$GITHUB_REPOSITORY"');
      expect(
        authorize?.run,
        `${workflowPath}: authorizer must refuse unapproved dispatch candidates`,
      ).toContain('test "$EXPECTED_SHA" = "$GITHUB_SHA"');
      for (const step of steps) {
        expect(
          step["continue-on-error"],
          `${workflowPath}:${jobId} step "continue-on-error" would swallow a real failure`,
        ).toBeUndefined();
      }
    }
  });

  it("required jobs checkout the in-step authorized SHA and re-verify it", () => {
    for (const [workflowPath, jobId] of REQUIRED_JOBS) {
      const steps = requiredJob(workflowPath, jobId).steps ?? [];
      const checkout = steps.find((step) =>
        step.uses?.startsWith("actions/checkout@"),
      );
      expect(checkout?.with, `${workflowPath} pinned checkout`).toMatchObject({
        ref: "${{ steps.authorize.outputs.sha }}",
        "fetch-depth": 0,
        clean: true,
        "persist-credentials": false,
      });
      const checkoutIndex = steps.indexOf(checkout!);
      expect(
        steps[checkoutIndex + 1]?.name,
        `${workflowPath} immediate verification after checkout`,
      ).toMatch(/Verify (?:authorized|pinned)/);
      const verify = steps[checkoutIndex + 1];
      expect(verify?.run, `${workflowPath} verification must re-check the SHA`).toContain(
        'test "$(git rev-parse --verify HEAD)" = "$AUTHORIZED_SHA"',
      );
    }
  });

  // The Gate-B release proof (issue #2840) is a merge-queue gate but is
  // DELIBERATELY exempt from the never-conclude-skipped contract above: it
  // carries a job-level `if:` restricted to merge_group so the ~10 minute
  // proof never runs on pull_request pushes. Requiredness comes from the
  // main-merge-queue ruleset, which evaluates on the gh-readonly-queue ref
  // where the event is always merge_group; a missing required check fails
  // closed, so the PR-run skip can never render a queue batch green. These
  // assertions pin that exemption so the shape cannot drift silently.
  describe("release-proof merge-queue gate shape", () => {
    const job = requiredJob(".github/workflows/ci.yml", "release-proof");

    it("runs only on merge_group so PR pushes never pay the ~10 min proof", () => {
      expect(job.if).toContain("github.event_name == 'merge_group'");
    });

    it("carries no needs and fails closed within the 25 minute budget", () => {
      expect(job.needs).toBeUndefined();
      expect(job["timeout-minutes"]).toBeLessThanOrEqual(25);
      for (const step of job.steps ?? []) {
        expect(step["continue-on-error"]).toBeUndefined();
      }
    });

    it("refuses non-merge_group events with a real failure and re-verifies checkout", () => {
      const steps = job.steps ?? [];
      expect(steps[0]?.id).toBe("authorize");
      expect(steps[0]?.run).toContain(
        'test "$GITHUB_EVENT_NAME" = "merge_group"',
      );
      expect(steps[0]?.run).toContain(
        '[[ "$GITHUB_REF" =~ ^refs/heads/gh-readonly-queue/ ]]',
      );
      const checkoutIndex = steps.findIndex((step) =>
        step.uses?.startsWith("actions/checkout@"),
      );
      expect(steps[checkoutIndex + 1]?.run).toContain(
        'test "$(git rev-parse --verify HEAD)" = "$AUTHORIZED_SHA"',
      );
    });

    it("runs the canonical release proof over all six journeys and archives gate-b diagnostics on failure", () => {
      const runs = (job.steps ?? []).map((step) => step.run ?? "").join("\n");
      expect(runs).toContain("npm run build");
      expect(runs).toContain("npm run e2e:prepare:local");
      expect(runs).toContain(
        "node scripts/run-local-release-proof.mjs --journeys=1,2,3,4,5,6",
      );
      const upload = (job.steps ?? []).find((step) =>
        step.uses?.startsWith("actions/upload-artifact@"),
      );
      expect(upload?.if).toBe("failure()");
      expect(String(upload?.with?.path)).toContain("gate-b-manifest");
    });
  });
});
