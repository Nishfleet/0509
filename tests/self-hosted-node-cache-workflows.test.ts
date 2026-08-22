import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const hostedNpmCache = "${{ runner.environment == 'github-hosted' && 'npm' || '' }}";
const hostedPackageManagerCache = "${{ runner.environment == 'github-hosted' }}";
const hostedNpmCacheWithLockfile =
  "${{ runner.environment == 'github-hosted' && hashFiles('package-lock.json') != '' && 'npm' || '' }}";
const hostedPackageManagerCacheWithLockfile =
  "${{ runner.environment == 'github-hosted' && hashFiles('package-lock.json') != '' }}";
const verificationRunner = ["self-hosted", "linux", "x64", "vps-verify"];


// 2026-08-22 (Nish): ci.yml and cross-browser-matrix.yml moved BACK to
// GitHub-hosted. The 2026-08-10 reason above was a billing outage that killed
// hosted jobs at start -- but 0509 is a PUBLIC repo now, so standard hosted
// runners carry no billing at all and cannot fail that way. Measured the same
// day: the CI workflow completes in ~2.6 min hosted against a ~20.5 min median
// on the shared VPS pool, because every heavy step there serialises behind
// scripts/deploy-window-lock.sh. Everything credential-bearing (deploy, D1
// backup/restore, soak, uptime, secret-scan) deliberately STAYS on the VPS.
const hostedRunner = "ubuntu-latest";

// Deliberately GitHub-hosted (see note above). Still checked for the same
// setup-node cache expressions -- on a hosted runner those expressions are
// what actually switches the Actions cache ON.
const hostedRoutedWorkflows = [
  [".github/workflows/ci.yml", ["codex-node-checks"]],
  [".github/workflows/cross-browser-matrix.yml", ["matrix"]],
] as const;

const runnerRoutedWorkflows = [
  [".github/workflows/d1-backup-r2.yml", ["backup"]],
  [".github/workflows/d1-backup-validate.yml", ["validate"]],
  [
    ".github/workflows/d1-remote-restore-evidence.yml",
    ["restore", "cleanup", "apply_and_restore"],
  ],
  [
    ".github/workflows/deploy-production.yml",
    ["prepare_remote_restore_evidence", "deploy"],
  ],
  [".github/workflows/finalize-production-soak.yml", ["finalize"]],
  [".github/workflows/secret-scan.yml", ["gitleaks"]],
  [".github/workflows/uptime-health.yml", ["health"]],
] as const;

type SetupNodeStep = {
  uses?: string;
  with?: {
    cache?: string;
    "package-manager-cache"?: string;
  };
};

describe("runner-routed setup-node cache workflows", () => {
  it("uses Actions cache only on GitHub-hosted runners", () => {
    const runnerRoutedJobs = runnerRoutedWorkflows.flatMap(
      ([workflowPath, jobNames]) => {
        const workflow = parse(readFileSync(workflowPath, "utf8")) as {
          jobs: Record<
            string,
            { "runs-on"?: string | string[]; steps?: SetupNodeStep[] }
          >;
        };

        return jobNames.map((jobName) => ({
          workflowPath,
          jobName,
          job: workflow.jobs[jobName],
        }));
      },
    );

    expect(runnerRoutedJobs).toHaveLength(10);
    for (const { workflowPath, jobName, job } of runnerRoutedJobs) {
      // 2026-08-10: every routed job runs on the VPS verification runner;
      // the hosted/self-hosted split died with the billing outage. The
      // runner.environment cache expressions below stay: they are what keeps
      // Actions cache scoped to GitHub-hosted if any job ever moves back.
      expect(job?.["runs-on"], `${workflowPath}:${jobName}`).toEqual(
        verificationRunner,
      );
    }

    const setupNodeSteps = runnerRoutedJobs.flatMap(
      ({ workflowPath, jobName, job }) =>
        (job?.steps ?? [])
          .filter((step) => step.uses?.startsWith("actions/setup-node@"))
          .map((step) => ({ workflowPath, jobName, step })),
    );
    expect(setupNodeSteps).toHaveLength(8);
    for (const { workflowPath, jobName, step } of setupNodeSteps) {
      const preservesNoLockfileFallback =
        workflowPath === ".github/workflows/ci.yml" &&
        jobName === "codex-node-checks";
      expect(step.with, `${workflowPath}:${jobName}`).toMatchObject({
        cache: preservesNoLockfileFallback
          ? hostedNpmCacheWithLockfile
          : hostedNpmCache,
        "package-manager-cache": preservesNoLockfileFallback
          ? hostedPackageManagerCacheWithLockfile
          : hostedPackageManagerCache,
      });
    }
  });

  it("routes the hosted pair to ubuntu-latest and keeps their cache expressions", () => {
    for (const [workflowPath, jobNames] of hostedRoutedWorkflows) {
      const workflow = parse(readFileSync(workflowPath, "utf8")) as {
        jobs: Record<
          string,
          { "runs-on"?: string | string[]; steps?: SetupNodeStep[] }
        >;
      };
      for (const jobName of jobNames) {
        const job = workflow.jobs[jobName];
        expect(job?.["runs-on"], `${workflowPath}:${jobName}`).toEqual(
          hostedRunner,
        );
        const setupNode = (job?.steps ?? []).filter((step) =>
          step.uses?.startsWith("actions/setup-node@"),
        );
        expect(setupNode, `${workflowPath}:${jobName}`).toHaveLength(1);
        // On a hosted runner these expressions evaluate TRUE, which is the
        // whole point: the Actions cache switches on by itself.
        expect(setupNode[0]?.with?.cache, `${workflowPath}:${jobName}`).toMatch(
          /runner\.environment == 'github-hosted'/,
        );
      }
    }
  });
});
