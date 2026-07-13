import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  canUsePlanFeature,
  getIncludedEvidenceAllowance,
  getPlanEntitlements,
  getPlanLimit,
  getScheduledMonitoringPolicy,
  getWorkspaceSeatLimit,
  PLAN_FAMILIES,
  planAllowsDigestCadence,
  shouldSchedulePlanInRegularScan,
} from "~/lib/plan-entitlements";

describe("plan entitlements catalog", () => {
  it("gives free one activation watchlist with no scheduled scans or digests", () => {
    const entitlements = getPlanEntitlements("free");
    expect(getPlanLimit("free", "watchlists")).toBe(1);
    expect(getPlanLimit("free", "collections")).toBe(0);
    expect(getIncludedEvidenceAllowance("free")).toBe(0);
    expect(entitlements.scheduledScanCadence).toBe("none");
    expect(entitlements.digestCadence).toBe("none");
    expect(planAllowsDigestCadence("free", "weekly")).toBe(false);
    expect(shouldSchedulePlanInRegularScan("free", new Date("2026-07-03T00:00:00.000Z"))).toBe(false);
  });

  it.each([
    ["scout", 3, 10, 50, 1, "every_6h", 2],
    ["starter", 10, 25, 250, 1, "every_3h", 1],
    ["agency", 75, 250, 2500, 3, "every_3h", 0],
  ] as const)(
    "defines %s limits and monitoring policy",
  (plan, watchlists, boards, checks, seats, cadence, priority) => {
      const entitlements = getPlanEntitlements(plan);
      expect(getPlanLimit(plan, "watchlists")).toBe(watchlists);
      expect(getPlanLimit(plan, "collections")).toBe(boards);
      expect(getIncludedEvidenceAllowance(plan)).toBe(checks);
      expect(getWorkspaceSeatLimit(plan)).toBe(seats);
      expect(getScheduledMonitoringPolicy(plan).scheduledScanCadence).toBe(cadence);
      expect(getScheduledMonitoringPolicy(plan).monitoringQueuePriority).toBe(priority);
      expect(entitlements.features.size).toBeGreaterThan(0);
    },
  );

  it("gives Starter daily and weekly digests", () => {
    expect(planAllowsDigestCadence("starter", "daily")).toBe(true);
    expect(planAllowsDigestCadence("starter", "weekly")).toBe(true);
    expect(planAllowsDigestCadence("scout", "daily")).toBe(false);
    expect(planAllowsDigestCadence("agency", "daily")).toBe(true);
  });

  it("includes Scout only on the six-hour regular scan slots", () => {
    expect(shouldSchedulePlanInRegularScan("scout", new Date("2026-07-03T00:00:00.000Z"))).toBe(true);
    expect(shouldSchedulePlanInRegularScan("scout", new Date("2026-07-03T03:00:00.000Z"))).toBe(false);
    expect(shouldSchedulePlanInRegularScan("starter", new Date("2026-07-03T03:00:00.000Z"))).toBe(true);
    expect(shouldSchedulePlanInRegularScan("agency", new Date("2026-07-03T03:00:00.000Z"))).toBe(true);
  });

  it("gates agency-only capabilities", () => {
    expect(canUsePlanFeature("starter", "mcp_access")).toBe(false);
    expect(canUsePlanFeature("agency", "mcp_access")).toBe(true);
    expect(canUsePlanFeature("agency", "team_workspace")).toBe(true);
  });

  it("contains no monetary values", () => {
    const source = readFileSync(
      join(process.cwd(), "app/lib/plan-entitlements.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\b(INR|USD|EUR|₹|\$)\b/);
    expect(source).not.toMatch(/amount_minor|minor_amount|unit_amount/i);
  });
});

describe("duplicate entitlement table guard", () => {
  it("does not define a second public PLAN_LIMITS table outside the catalog", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "legacy") continue;
          walk(path);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        if (path.endsWith("plan-entitlements.ts") || path.endsWith("plan.server.ts")) continue;
        const content = readFileSync(path, "utf8");
        if (/export const PLAN_LIMITS\s*=/.test(content)) {
          offenders.push(path);
        }
      }
    };
    walk(join(process.cwd(), "app"));
    expect(offenders).toEqual([]);
  });

  it("covers every paid plan family", () => {
    expect(PLAN_FAMILIES).toContain("scout");
    expect(PLAN_FAMILIES).toContain("starter");
    expect(PLAN_FAMILIES).toContain("agency");
  });
});
