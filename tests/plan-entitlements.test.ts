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
  shouldScheduleWatchlistInRegularScan,
} from "~/lib/plan-entitlements";

describe("plan entitlements catalog", () => {
  it("gives free one watchlist, one Collection, and one evidence check on a weekly rhythm", () => {
    const entitlements = getPlanEntitlements("free");
    expect(getPlanLimit("free", "watchlists")).toBe(1);
    // Honest 1-coll: the free tier includes exactly one Collection.
    expect(getPlanLimit("free", "collections")).toBe(1);
    // One included evidence check per month keeps the free weekly brief
    // genuinely proof-backed at least once a month.
    expect(getIncludedEvidenceAllowance("free")).toBe(1);
    expect(entitlements.scheduledScanCadence).toBe("weekly");
    expect(entitlements.digestCadence).toBe("weekly");
    expect(planAllowsDigestCadence("free", "weekly")).toBe(true);
    expect(planAllowsDigestCadence("free", "daily")).toBe(false);
    // Free carries the weekly digest + its email lane, and BET 6 adds the
    // read-only API/MCP surface (no exports, instant alerts, Slack, or
    // agent actions).
    expect([...entitlements.features].sort()).toEqual([
      "api_access",
      "email_delivery",
      "mcp_access",
      "weekly_digest",
    ]);
    // A Friday 00:00 UTC tick is a 6h-aligned slot for paid plans but must
    // never include free — free scans only on the weekly Monday slot.
    expect(shouldSchedulePlanInRegularScan("free", new Date("2026-07-03T00:00:00.000Z"))).toBe(false);
  });

  it("schedules free exactly once per week: only the Monday 03:00 UTC tick of the regular cron", () => {
    // Walk every 3-hour tick of a full week (2026-06-29 is a Monday).
    const weekStart = Date.parse("2026-06-29T00:00:00.000Z");
    const included: string[] = [];
    for (let tick = 0; tick < 7 * 8; tick += 1) {
      const at = new Date(weekStart + tick * 3 * 60 * 60 * 1000);
      if (shouldSchedulePlanInRegularScan("free", at)) {
        included.push(at.toISOString());
      }
    }
    expect(included).toEqual(["2026-06-29T03:00:00.000Z"]);
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

  it("gives Agency 25 priority scan slots; overflow only on 6h-aligned runs (WP-37)", () => {
    expect(getPlanEntitlements("agency").priorityScanSlots).toBe(25);
    expect(getScheduledMonitoringPolicy("agency").priorityScanSlots).toBe(25);
    expect(getPlanEntitlements("starter").priorityScanSlots).toBeNull();
    expect(getPlanEntitlements("scout").priorityScanSlots).toBeNull();

    const threeHourSlot = new Date("2026-07-03T03:00:00.000Z");
    const sixHourSlot = new Date("2026-07-03T06:00:00.000Z");

    expect(
      shouldScheduleWatchlistInRegularScan({
        planFamily: "agency",
        scheduledAt: threeHourSlot,
        watchlistRank: 0,
      }),
    ).toBe(true);
    expect(
      shouldScheduleWatchlistInRegularScan({
        planFamily: "agency",
        scheduledAt: threeHourSlot,
        watchlistRank: 24,
      }),
    ).toBe(true);
    expect(
      shouldScheduleWatchlistInRegularScan({
        planFamily: "agency",
        scheduledAt: threeHourSlot,
        watchlistRank: 25,
      }),
    ).toBe(false);
    expect(
      shouldScheduleWatchlistInRegularScan({
        planFamily: "agency",
        scheduledAt: sixHourSlot,
        watchlistRank: 74,
      }),
    ).toBe(true);
    // Starter has no overflow tier — all slots at full cadence.
    expect(
      shouldScheduleWatchlistInRegularScan({
        planFamily: "starter",
        scheduledAt: threeHourSlot,
        watchlistRank: 9,
      }),
    ).toBe(true);
  });

  it("gates agency-only capabilities — and BET 6 keeps the read surface open", () => {
    // BET 6: read-only API/MCP access is free + Scout; agent actions and
    // write-enabled keys stay paid.
    expect(canUsePlanFeature("free", "mcp_access")).toBe(true);
    expect(canUsePlanFeature("scout", "mcp_access")).toBe(true);
    expect(canUsePlanFeature("starter", "mcp_access")).toBe(true);
    expect(canUsePlanFeature("free", "mcp_account_actions")).toBe(false);
    expect(canUsePlanFeature("scout", "mcp_account_actions")).toBe(false);
    expect(canUsePlanFeature("starter", "write_enabled_api_keys")).toBe(true);
    expect(canUsePlanFeature("free", "write_enabled_api_keys")).toBe(false);
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
