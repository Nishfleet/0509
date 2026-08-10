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

const runnerRoutedWorkflows = [
  [".github/workflows/ci.yml", ["codex-node-checks"]],
  [".github/workflows/cross-browser-matrix.yml", ["matrix"]],
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

    expect(runnerRoutedJobs).toHaveLength(12);
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
    expect(setupNodeSteps).toHaveLength(10);
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
});
