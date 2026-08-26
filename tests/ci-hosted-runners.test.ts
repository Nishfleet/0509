import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// Issue #916: ci.yml and cross-browser-matrix.yml must stay on GitHub-hosted
// runners. PR #902 already moved them to ubuntu-latest and deleted the
// self-hosted pool plus scripts/deploy-window-lock.sh. Rebasing stale PR #882
// would have put those wrappers back. This lock is the mechanical prevention.
const HOSTED_CI_WORKFLOWS = [
  ".github/workflows/ci.yml",
  ".github/workflows/cross-browser-matrix.yml",
] as const;

const hostedRunner = "ubuntu-latest";

type WorkflowJob = {
  "runs-on"?: string | string[];
};

type Workflow = {
  jobs?: Record<string, WorkflowJob>;
};

function hostedCiWorkflowViolations(source: string): string[] {
  const parsed = parse(source) as Workflow;
  const violations: string[] = [];
  if (source.includes("self-hosted")) {
    violations.push("self-hosted runner label");
  }
  if (source.includes("deploy-window-lock")) {
    violations.push("deploy-window-lock wrapper");
  }
  const jobs = parsed.jobs ?? {};
  if (Object.keys(jobs).length === 0) {
    violations.push("no jobs");
  }
  for (const [id, job] of Object.entries(jobs)) {
    if (job?.["runs-on"] !== hostedRunner) {
      violations.push(`${id} runs-on`);
    }
  }
  return violations;
}

describe("GitHub-hosted CI runners", () => {
  it("rejects self-hosted labels, deploy-window-lock wrappers, and non-hosted runs-on", () => {
    expect(
      hostedCiWorkflowViolations(`
jobs:
  matrix:
    runs-on: [self-hosted, linux, x64]
    steps:
      - run: ./scripts/deploy-window-lock.sh run -- npm test
`),
    ).toEqual([
      "self-hosted runner label",
      "deploy-window-lock wrapper",
      "matrix runs-on",
    ]);

    expect(
      hostedCiWorkflowViolations(`
jobs:
  checks:
    runs-on: ubuntu-latest
`),
    ).toEqual([]);
  });

  it("keeps ci.yml and cross-browser-matrix.yml on ubuntu-latest with no self-hosted leftovers", () => {
    for (const workflowPath of HOSTED_CI_WORKFLOWS) {
      const source = readFileSync(workflowPath, "utf8");
      expect(hostedCiWorkflowViolations(source), workflowPath).toEqual([]);
      const parsed = parse(source) as Workflow;
      expect(
        Object.keys(parsed.jobs ?? {}).length,
        `${workflowPath} must have jobs`,
      ).toBeGreaterThan(0);
    }
  });
});
