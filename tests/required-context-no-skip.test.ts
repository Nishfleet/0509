import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// Required contexts under the main-merge-queue ruleset's required_status_checks
// (live ruleset, verified 2026-09-13): "Gitleaks" (secret-scan.yml),
// "codex-node-checks" (ci.yml), "required-verifier-integrity", "semgrep",
// "preview-assert" and "release-proof". dependabot-critical-check is NOT
// ruleset-required despite being enforced below (this test intentionally
// covers more than the ruleset asks). Requiredness is judged on the
// ruleset's gh-readonly-queue merge ref, which yields TWO pinned shapes
// (issue #3263, extending the release-proof precedent pinned below):
//
// 1. NEVER-CONCLUDE-SKIPPED (a real verdict on BOTH the PR and the queue
//    ref): the job carries no job-level `if:` (an if: can skip on
//    cancellation or any future condition edit) and no `needs` (a job with
//    needs is skipped when its dependency fails), and its authorizer runs as
//    the first STEP, refusing fork PRs and unapproved dispatch candidates
//    with a real failure. This regression fails on the pre-fix shape
//    (job-level `if:` + `needs: authorize_release`) and passes on the
//    healed shape (in-step authorizer, pinned SHA checkout).
//
// 2. MERGE_GROUP-ONLY (issue #3263, the release-proof shape): the heavy
//    contexts (codex-node-checks, preview-assert) carry a job-level `if:`
//    that reports a real verdict on merge_group (the queue's only event)
//    and keeps workflow_dispatch verification alive, and reports skipped on
//    PR-head pushes, which the ruleset never consults for queue batches.
//    The `if:` is pinned to the EXACT proven string so the skip surface
//    cannot widen silently, and there is still NO `needs` anywhere.
//
// Both shapes keep the in-step authorizer as the first STEP, refusing fork
// PRs and unapproved dispatch candidates with a real failure - a gate that
// cannot verify must say no, never render green or skipped.
const REQUIRED_JOBS = [
  [".github/workflows/secret-scan.yml", "gitleaks"],
  [".github/workflows/ci.yml", "dependabot-critical-check"],
  // preview-assert (0509#1576) became a required context on main; it
  // migrates to the merge-queue contract (issue #3263) from day one.
  [".github/workflows/preview-assert.yml", "preview-assert"],
] as const;

// The EXACT job-level `if:` a merge-queue-required heavy context may carry
// (issue #3263): a real verdict on the queue ref (merge_group) and on
// authorized dispatch candidates, skipped on PR-head pushes. Pinned exactly
// so no future event, or event deletion, can silently change when the
// required context reports. MUST stay in sync with ci.yml's
// codex-node-checks + shard jobs and preview-assert.yml's job.
const MERGE_GROUP_ONLY_IF =
  "github.event_name == 'merge_group' || github.event_name == 'workflow_dispatch'";

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
  "timeout-minutes"?: number;
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
  // The two shapes a required context may take (see REQUIRED_JOBS above):
  // always-run (no if:) or the pinned merge-queue if: from issue #3263.
  const NEVER_SKIP_JOBS: (typeof REQUIRED_JOBS)[number][] = [
    [".github/workflows/secret-scan.yml", "gitleaks"],
    [".github/workflows/ci.yml", "dependabot-critical-check"],
  ];
  const MERGE_GROUP_ONLY_JOBS: (typeof REQUIRED_JOBS)[number][] = [
    [".github/workflows/ci.yml", "codex-node-checks"],
    [".github/workflows/preview-assert.yml", "preview-assert"],
  ];

  it("never-skip required jobs carry no job-level if: and no needs", () => {
    for (const [workflowPath, jobId] of NEVER_SKIP_JOBS) {
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

  it("merge-group-only required jobs carry the EXACT #3263 if: and no needs", () => {
    for (const [workflowPath, jobId] of MERGE_GROUP_ONLY_JOBS) {
      const job = requiredJob(workflowPath, jobId);
      // release-proof precedent: requiredness is judged on the queue's
      // gh-readonly-queue ref, where the event is always merge_group, so the
      // context always reports a real verdict when the queue consults it. A
      // skipped PR-head run is exactly the state the ruleset never reads.
      expect(
        job.if,
        `${workflowPath}:${jobId} must carry the pinned merge-queue if: (issue #3263)`,
      ).toBe(MERGE_GROUP_ONLY_IF);
      expect(
        job.needs,
        `${workflowPath}:${jobId} \`needs\` skips the job when its dependency fails`,
      ).toBeUndefined();
    }
  });

  it("merge-group-only required workflows still trigger on the queue ref and dispatch", () => {
    // The pinned if: is only load-bearing while the workflow still fires on
    // the merge-group ref (where the ruleset's required check is judged) and
    // on authorized dispatch candidates. If a trigger were removed, the
    // required context would never report and the queue would fail closed
    // after its 360-minute check_response_timeout.
    for (const [workflowPath] of MERGE_GROUP_ONLY_JOBS) {
      const parsed = parse(readFileSync(workflowPath, "utf8")) as {
        on: Record<string, unknown>;
      };
      expect(
        parsed.on?.merge_group,
        `${workflowPath} must keep its merge_group trigger`,
      ).toBeDefined();
      // And UNFILTERED: the queue's only event is merge_group, so a paths:
      // filter there would leave the required context unreported on queue
      // refs - the fail-closed after 360 minutes described above, with this
      // test still green. A bare key parses as null.
      expect(
        parsed.on?.merge_group,
        `${workflowPath} merge_group must stay bare/unfiltered`,
      ).toBeNull();
      expect(
        parsed.on?.workflow_dispatch,
        `${workflowPath} must keep its workflow_dispatch trigger`,
      ).toBeDefined();
    }
  });

  // The authorize/checkout contracts below hold for BOTH shapes, so they
  // iterate the union of never-skip and merge-group-only required jobs.
  const ALL_REQUIRED_JOBS: (typeof REQUIRED_JOBS)[number][] = [
    ...NEVER_SKIP_JOBS,
    ...MERGE_GROUP_ONLY_JOBS,
  ];

  it("required jobs authorize in-step, first step, and never swallow failure", () => {
    for (const [workflowPath, jobId] of ALL_REQUIRED_JOBS) {
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
    for (const [workflowPath, jobId] of ALL_REQUIRED_JOBS) {
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
