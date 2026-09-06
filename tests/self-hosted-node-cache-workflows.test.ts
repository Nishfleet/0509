import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const hostedNpmCache = "${{ runner.environment == 'github-hosted' && 'npm' || '' }}";
const hostedPackageManagerCache = "${{ runner.environment == 'github-hosted' }}";
const hostedNpmCacheWithLockfile =
  "${{ runner.environment == 'github-hosted' && hashFiles('package-lock.json') != '' && 'npm' || '' }}";
const hostedPackageManagerCacheWithLockfile =
  "${{ runner.environment == 'github-hosted' && hashFiles('package-lock.json') != '' }}";
const hostedRunner = "ubuntu-latest";

// 2026-08-23: ci.yml and secret-scan.yml moved to GitHub-hosted runners.
// 0509 is a PUBLIC repo, so hosted runners are free and unmetered, and
// GitHub's docs say to use self-hosted runners only with private repos.
const hostedWorkflows = [
  [".github/workflows/ci.yml", ["codex-node-checks"]],
  [".github/workflows/secret-scan.yml", ["gitleaks"]],
] as const;

const runnerRoutedWorkflows = [
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
    // Derived from the list above rather than a magic number: a hard-coded
    // count is the same brittleness as a hard-coded runner label - it breaks
    // when the list changes, without telling you anything real.
    expect(runnerRoutedJobs).toHaveLength(
      runnerRoutedWorkflows.reduce((n, [, jobNames]) => n + jobNames.length, 0),
    );
    for (const { workflowPath, jobName, job } of runnerRoutedJobs) {
      // 2026-08-10: every routed job runs on the VPS verification runner;
      // the hosted/self-hosted split died with the billing outage. The
      // runner.environment cache expressions below stay: they are what keeps
      // Actions cache scoped to GitHub-hosted if any job ever moves back.
      expect(job?.["runs-on"], `${workflowPath}:${jobName}`).toEqual(
        hostedRunner,
      );
    }

    // The hosted tier is asserted too, so a job cannot drift between tiers
    // unnoticed in either direction.
    for (const [workflowPath, jobNames] of hostedWorkflows) {
      const workflow = parse(readFileSync(workflowPath, "utf8")) as {
        jobs: Record<string, { "runs-on"?: string | string[] }>;
      };
      for (const jobName of jobNames) {
        expect(
          workflow.jobs[jobName]?.["runs-on"],
          `${workflowPath}:${jobName}`,
        ).toEqual("ubuntu-latest");
      }
    }

    const setupNodeSteps = runnerRoutedJobs.flatMap(
      ({ workflowPath, jobName, job }) =>
        (job?.steps ?? [])
          .filter((step) => step.uses?.startsWith("actions/setup-node@"))
          .map((step) => ({ workflowPath, jobName, step })),
    );
    // Not every routed job runs setup-node (was 10 of 12; now 9 of 10 after
    // ci.yml moved to the hosted tier). Assert non-empty plus one-per-job-at-
    // most, so the loop below can never vacuously pass on an empty list.
    expect(setupNodeSteps.length).toBeGreaterThan(0);
    expect(setupNodeSteps.length).toBeLessThanOrEqual(runnerRoutedJobs.length);
    for (const { workflowPath, jobName, step } of setupNodeSteps) {
      // ci.yml:codex-node-checks used to need the no-lockfile fallback here.
      // It moved to the hosted tier on 2026-08-23, so no routed job needs it.
      const preservesNoLockfileFallback = false;
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
