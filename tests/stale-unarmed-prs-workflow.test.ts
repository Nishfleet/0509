import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflowPath = ".github/workflows/stale-unarmed-prs.yml";
const source = readFileSync(workflowPath, "utf8");

const parsed = parse(source) as {
  on?: {
    workflow_dispatch?: unknown;
    schedule?: Array<{ cron?: string }>;
  };
  permissions?: Record<string, string>;
  jobs?: Record<
    string,
    {
      "runs-on"?: string;
      "timeout-minutes"?: number;
      steps?: Array<{
        name?: string;
        uses?: string;
        with?: Record<string, unknown>;
      }>;
    }
  >;
};

describe("stale unarmed PRs workflow (0509#1901)", () => {
  const job = parsed.jobs?.stale;
  if (!job) throw new Error("stale-unarmed-prs.yml is missing the stale job");

  it("nudges on a 12h schedule and never closes", () => {
    expect(parsed.on?.schedule).toEqual([{ cron: "17 */12 * * *" }]);
    expect(parsed.on?.workflow_dispatch).toBeDefined();
    expect(job["runs-on"]).toEqual("ubuntu-latest");
    expect(job["timeout-minutes"]).toBe(10);
  });

  it("only writes issue and pull-request labels", () => {
    expect(parsed.permissions).toEqual({
      issues: "write",
      "pull-requests": "write",
    });
  });

  it("pins actions/stale and refuses automatic close", () => {
    const stale = job.steps?.find((step) => step.name === "Mark stale unarmed PRs");
    expect(stale?.uses).toBe(
      "actions/stale@4391f3da665fdf50b6810c1a66712fb9ba21aa93",
    );
    expect(stale?.with?.["days-before-close"]).toBe(-1);
    expect(stale?.with?.["days-before-issue-stale"]).toBe(-1);
    expect(stale?.with?.["days-before-pr-stale"]).toBe(1);
    expect(stale?.with?.["only-pr-labels"]).toBe("stale-unarmed-candidate");
    expect(stale?.with?.["stale-pr-label"]).toBe("stale-unarmed");
  });
});
