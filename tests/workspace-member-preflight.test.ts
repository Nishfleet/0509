import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseWorkspaceMembershipPreflightOutput } from "../scripts/workspace-member-preflight.lib.mjs";

describe("workspace member migration preflight", () => {
  it("accepts the documented Wrangler JSON result when no duplicate membership exists", () => {
    expect(
      parseWorkspaceMembershipPreflightOutput(
        JSON.stringify([
          {
            results: [{ duplicate_membership_count: 0 }],
            success: true,
            meta: { duration: 0.1 },
          },
        ]),
      ),
    ).toEqual({ duplicateMembershipCount: 0 });
  });

  it("returns the duplicate count so the executable gate can fail closed", () => {
    expect(
      parseWorkspaceMembershipPreflightOutput(
        JSON.stringify([
          {
            results: [{ duplicate_membership_count: 2 }],
            success: true,
          },
        ]),
      ),
    ).toEqual({ duplicateMembershipCount: 2 });
  });

  it.each([
    ["malformed JSON", "not-json"],
    ["failed query", JSON.stringify([{ results: [], success: false }])],
    ["missing result", JSON.stringify([{ results: [], success: true }])],
    [
      "invalid count",
      JSON.stringify([
        { results: [{ duplicate_membership_count: "unknown" }], success: true },
      ]),
    ],
  ])("rejects %s", (_label, output) => {
    expect(() => parseWorkspaceMembershipPreflightOutput(output)).toThrow();
  });

  it("is a required deployment gate before the migration-sync check", () => {
    const deployPlanSource = readFileSync(resolve("scripts/deploy-production-plan.mjs"), "utf8");
    const preflightIndex = deployPlanSource.indexOf("check-workspace-member-invariants.mjs");
    const migrationIndex = deployPlanSource.indexOf("check-d1-migrations-synced.mjs");

    expect(preflightIndex).toBeGreaterThan(-1);
    expect(preflightIndex).toBeLessThan(migrationIndex);
  });
});
