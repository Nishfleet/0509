import { describe, expect, it } from "vitest";

import {
  buildBudgetSkipSurfaceQuery,
  mapBudgetSkipRows,
  parseArgs,
  rowsFromWranglerJson,
  validateBudgetSkipSurface,
} from "../scripts/canary-proof-budget-skip-surface.mjs";

describe("canary-proof-budget-skip-surface (#1287)", () => {
  describe("parseArgs", () => {
    it("returns defaults for an empty argv", () => {
      expect(parseArgs([])).toEqual({
        local: false,
        json: false,
        windowHours: 72,
        paidThreshold: 100,
      });
    });

    it("accepts --local, --json, --window-hours, and --paid-threshold", () => {
      expect(
        parseArgs([
          "--local",
          "--json",
          "--window-hours",
          "48",
          "--paid-threshold",
          "25",
        ]),
      ).toEqual({
        local: true,
        json: true,
        windowHours: 48,
        paidThreshold: 25,
      });
    });

    it("ignores non-positive window and threshold values", () => {
      expect(
        parseArgs(["--window-hours", "0", "--paid-threshold", "-1"]),
      ).toMatchObject({
        windowHours: 72,
        paidThreshold: 100,
      });
    });

    it("throws on an unknown flag", () => {
      expect(() => parseArgs(["--bogus"])).toThrow(/Unknown argument/);
    });
  });

  describe("buildBudgetSkipSurfaceQuery", () => {
    it("embeds the requested window-hours and joins watchlist + user_plan", () => {
      const sql = buildBudgetSkipSurfaceQuery(72);
      expect(sql).toMatch(/datetime\('now', '-' \|\| 72 \|\| ' hours'\)/);
      expect(sql).toMatch(/INNER JOIN proof_target pt ON pt\.id = pc\.proof_target_id/);
      expect(sql).toMatch(/INNER JOIN watchlist w ON w\.id = pt\.watchlist_id/);
      expect(sql).toMatch(/LEFT JOIN user_plan up ON up\.user_id = w\.user_id/);
      expect(sql).toMatch(/pc\.status = 'skipped_due_to_budget'/);
      expect(sql).toMatch(/pc\.skip_reason IS NULL/);
    });

    it("rounds fractional hours to an integer (the SQL is bound, not interpolated)", () => {
      expect(buildBudgetSkipSurfaceQuery(72.9)).toMatch(/'-' \|\| 72 \|\| ' hours'/);
    });
  });

  describe("rowsFromWranglerJson", () => {
    it("accepts the bare results[] shape", () => {
      expect(
        rowsFromWranglerJson(JSON.stringify([{ results: [{ a: 1, b: 2 }] }])),
      ).toEqual([{ a: 1, b: 2 }]);
    });

    it("accepts the result.results shape", () => {
      expect(
        rowsFromWranglerJson(
          JSON.stringify([{ result: { results: [{ a: 1 }] } }]),
        ),
      ).toEqual([{ a: 1 }]);
    });

    it("returns an empty array on empty output", () => {
      expect(rowsFromWranglerJson("")).toEqual([]);
      expect(rowsFromWranglerJson("   \n  ")).toEqual([]);
    });
  });

  describe("mapBudgetSkipRows", () => {
    it("normalizes snake_case row keys and drops non-budget rows", () => {
      const rows = mapBudgetSkipRows([
        {
          workspace_user_id: "user-1",
          plan: "starter",
          budget_skips_total: 5,
          budget_skips_silent: 0,
          first_budget_skip_at: "2026-08-26T00:00:00Z",
          last_budget_skip_at: "2026-08-27T00:00:00Z",
        },
        {
          workspace_user_id: "user-2",
          plan: "free",
          budget_skips_total: 0,
          budget_skips_silent: 0,
          first_budget_skip_at: null,
          last_budget_skip_at: null,
        },
      ]);
      expect(rows).toEqual([
        {
          workspaceUserId: "user-1",
          plan: "starter",
          budgetSkipsTotal: 5,
          budgetSkipsSilent: 0,
          firstBudgetSkipAt: "2026-08-26T00:00:00Z",
          lastBudgetSkipAt: "2026-08-27T00:00:00Z",
        },
      ]);
    });

    it("treats null skip counts as 0 and missing timestamps as null", () => {
      expect(
        mapBudgetSkipRows([
          {
            workspace_user_id: "user-x",
            plan: "agency",
            budget_skips_total: 2,
            budget_skips_silent: null,
            first_budget_skip_at: null,
            last_budget_skip_at: null,
          },
        ]),
      ).toEqual([
        {
          workspaceUserId: "user-x",
          plan: "agency",
          budgetSkipsTotal: 2,
          budgetSkipsSilent: 0,
          firstBudgetSkipAt: null,
          lastBudgetSkipAt: null,
        },
      ]);
    });
  });

  describe("validateBudgetSkipSurface", () => {
    it("passes when every row is non-silent and within the paid threshold", () => {
      const result = validateBudgetSkipSurface({
        windowHours: 72,
        paidThreshold: 100,
        rows: [
          {
            workspaceUserId: "user-1",
            plan: "starter",
            budgetSkipsTotal: 12,
            budgetSkipsSilent: 0,
            firstBudgetSkipAt: null,
            lastBudgetSkipAt: null,
          },
        ],
      });
      expect(result.ok).toBe(true);
      expect(result.failures).toEqual([]);
      expect(result.silentRows).toEqual([]);
      expect(result.overVolumeRows).toEqual([]);
    });

    it("fails on any silent budget skip row", () => {
      const result = validateBudgetSkipSurface({
        windowHours: 72,
        paidThreshold: 100,
        rows: [
          {
            workspaceUserId: "user-1",
            plan: "starter",
            budgetSkipsTotal: 3,
            budgetSkipsSilent: 1,
            firstBudgetSkipAt: "2026-08-26T00:00:00Z",
            lastBudgetSkipAt: "2026-08-27T00:00:00Z",
          },
        ],
      });
      expect(result.ok).toBe(false);
      expect(result.silentRows).toHaveLength(1);
      expect(result.failures[0]).toMatch(/silent budget skips detected/);
      expect(result.failures[0]).toMatch(/user-1/);
    });

    it("fails on a paid workspace over the volume threshold", () => {
      const result = validateBudgetSkipSurface({
        windowHours: 72,
        paidThreshold: 5,
        rows: [
          {
            workspaceUserId: "user-1",
            plan: "starter",
            budgetSkipsTotal: 7,
            budgetSkipsSilent: 0,
            firstBudgetSkipAt: null,
            lastBudgetSkipAt: null,
          },
        ],
      });
      expect(result.ok).toBe(false);
      expect(result.overVolumeRows).toHaveLength(1);
      expect(result.failures[0]).toMatch(/exceeded 5 budget skips/);
    });

    it("ignores free-plan over-volume (free customers may hit their 1 check cap)", () => {
      const result = validateBudgetSkipSurface({
        windowHours: 72,
        paidThreshold: 5,
        rows: [
          {
            workspaceUserId: "user-1",
            plan: "free",
            budgetSkipsTotal: 12,
            budgetSkipsSilent: 0,
            firstBudgetSkipAt: null,
            lastBudgetSkipAt: null,
          },
        ],
      });
      expect(result.ok).toBe(true);
      expect(result.overVolumeRows).toEqual([]);
    });

    it("flags both silent AND over-volume in the same pass", () => {
      const result = validateBudgetSkipSurface({
        windowHours: 72,
        paidThreshold: 5,
        rows: [
          {
            workspaceUserId: "user-1",
            plan: "starter",
            budgetSkipsTotal: 7,
            budgetSkipsSilent: 1,
            firstBudgetSkipAt: null,
            lastBudgetSkipAt: null,
          },
        ],
      });
      expect(result.ok).toBe(false);
      expect(result.failures).toHaveLength(2);
      expect(result.silentRows).toHaveLength(1);
      expect(result.overVolumeRows).toHaveLength(1);
    });
  });
});
