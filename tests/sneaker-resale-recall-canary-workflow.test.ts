import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("Sneaker-resale recall canary workflow", () => {
  const workflow = readFileSync(".github/workflows/sneaker-resale-recall-canary.yml", "utf8");
  const parsed = parse(workflow) as {
    on: {
      workflow_dispatch?: unknown;
      schedule?: Array<{ cron?: string }>;
    };
    permissions?: Record<string, string>;
    concurrency?: { group?: string; "cancel-in-progress"?: boolean };
    jobs: {
      recall?: {
        "runs-on"?: string;
        "timeout-minutes"?: number;
        steps?: Array<{
          name?: string;
          run?: string;
          uses?: string;
          with?: Record<string, unknown>;
        }>;
      };
    };
  };

  // Issue #1945: the sneaker-resale cluster is the strongest, most-consistent
  // buyer signal across the daily market reports, but its 25 seed-list brands
  // had no recall guard at all — the existing search-tier-canary guards only
  // the §1.8 six-domain set and is not scheduled. This workflow schedules the
  // recall canary every 3h so a silent recall/alias regression on the strongest
  // cluster self-files rather than going unmeasured.

  it("schedules the recall canary every 3 hours on the scheduled-canary rails", () => {
    expect(parsed.on.schedule).toEqual([{ cron: "47 */3 * * *" }]);
    expect(parsed.on.workflow_dispatch).toBeDefined();
    expect(parsed.permissions).toEqual({ contents: "read" });
    expect(parsed.concurrency?.["cancel-in-progress"]).toBe(false);
  });

  it("runs the recall canary script on a hosted runner and fails loud on non-zero exit", () => {
    const job = parsed.jobs.recall;
    expect(job?.["runs-on"]).toBe("ubuntu-latest");
    const runStep = job?.steps?.find((step) => step.run?.includes("canary-sneaker-resale-recall.mjs"));
    expect(runStep?.run).toBe("node scripts/canary-sneaker-resale-recall.mjs");
    // A non-zero exit from the canary (a dead-end or blanket-unmatched
    // coverage-bearing brand) fails the job — the canary never exits 0 on a
    // regression it cannot confirm.
    expect(job?.["timeout-minutes"]).toBeGreaterThan(0);
  });
});
