import { describe, expect, it } from "vitest";

import {
  buildReasonQuery,
  mapReasonRows,
  parseArgs,
  renderHumanReport,
  rowsFromWranglerJson,
  summarize,
  validateReasons,
} from "../scripts/canary-proof-screenshot-reasons.mjs";

describe("canary-proof-screenshot-reasons (#2082)", () => {
  describe("parseArgs", () => {
    it("returns defaults for an empty argv (window=48h)", () => {
      expect(parseArgs([])).toEqual({
        local: false,
        json: false,
        windowHours: 48,
      });
    });

    it("accepts --local, --json, --window-hours", () => {
      expect(
        parseArgs(["--local", "--json", "--window-hours", "72"]),
      ).toEqual({
        local: true,
        json: true,
        windowHours: 72,
      });
    });

    it("ignores a non-positive window-hours value", () => {
      expect(parseArgs(["--window-hours", "0"])).toMatchObject({
        windowHours: 48,
      });
    });

    it("throws on an unknown flag", () => {
      expect(() => parseArgs(["--bogus"])).toThrow(/Unknown argument/);
    });
  });

  describe("buildReasonQuery", () => {
    it("embeds the requested window-hours with integer concatenation (no SQL interpolation)", () => {
      const sql = buildReasonQuery(48);
      expect(sql).toMatch(/datetime\('now', '-' \|\| 48 \|\| ' hours'\)/);
    });

    it("rounds fractional hours to an integer", () => {
      expect(buildReasonQuery(48.9)).toMatch(/'-' \|\| 48 \|\| ' hours'/);
    });

    it("classifies launch_readiness_real_capture succeeded rows as launch_canary_stripped", () => {
      const sql = buildReasonQuery(48);
      expect(sql).toMatch(/launch_readiness_real_capture/);
      expect(sql).toMatch(/launch_canary_stripped/);
    });

    it("excludes succeeded captures that carry a screenshot key", () => {
      const sql = buildReasonQuery(48);
      expect(sql).toMatch(/screenshot_artifact_key IS NOT NULL/);
      expect(sql).toMatch(/TRIM\(screenshot_artifact_key\) != ''/);
    });

    it("classifies failed captures by failure_code and budget skips by skip_reason", () => {
      const sql = buildReasonQuery(48);
      expect(sql).toMatch(/failed_unclassified/);
      expect(sql).toMatch(/budget_skip_unclassified/);
      expect(sql).toMatch(/COALESCE\(NULLIF\(failure_code, ''\), 'failed_unclassified'\)/);
    });
  });

  describe("rowsFromWranglerJson", () => {
    it("parses a wrangler d1 execute result array", () => {
      const output = JSON.stringify([
        { results: [{ reason: "launch_canary_stripped", n: 61 }], success: true },
      ]);
      expect(rowsFromWranglerJson(output)).toEqual([
        { reason: "launch_canary_stripped", n: 61 },
      ]);
    });

    it("returns [] for empty output", () => {
      expect(rowsFromWranglerJson("")).toEqual([]);
    });
  });

  describe("mapReasonRows", () => {
    it("sorts reasons by count descending and drops zero rows", () => {
      const rows = [
        { reason: "budget_skip", n: 0 },
        { reason: "launch_canary_stripped", n: 61 },
        { reason: "budget_skip", n: 7 },
      ];
      expect(mapReasonRows(rows)).toEqual([
        { reason: "launch_canary_stripped", n: 61 },
        { reason: "budget_skip", n: 7 },
      ]);
    });

    it("defaults a missing reason to unclassified", () => {
      expect(mapReasonRows([{ n: 3 }])).toEqual([
        { reason: "unclassified", n: 3 },
      ]);
    });
  });

  describe("validateReasons", () => {
    it("passes when every screenshot-less capture carries a recorded reason", () => {
      const result = validateReasons({
        reasons: [
          { reason: "launch_canary_stripped", n: 61 },
          { reason: "budget_skip", n: 7 },
        ],
        windowHours: 48,
      });
      expect(result.verdict).toBe("pass");
      expect(result.failures).toEqual([]);
      expect(result.silent).toEqual([]);
    });

    it("fails when any screenshot-less capture carries no recorded reason", () => {
      const result = validateReasons({
        reasons: [
          { reason: "launch_canary_stripped", n: 61 },
          { reason: "succeeded_no_screenshot_unclassified", n: 1 },
        ],
        windowHours: 48,
      });
      expect(result.verdict).toBe("fail");
      expect(result.failures.length).toBeGreaterThan(0);
      expect(result.failures[0]).toMatch(/silent screenshot degradation/);
      expect(result.silent).toEqual([
        { reason: "succeeded_no_screenshot_unclassified", n: 1 },
      ]);
    });

    it("fails on an unclassified failed capture", () => {
      const result = validateReasons({
        reasons: [{ reason: "failed_unclassified", n: 2 }],
        windowHours: 48,
      });
      expect(result.verdict).toBe("fail");
    });

    it("skips when there are no screenshot-less captures in the window", () => {
      const result = validateReasons({ reasons: [], windowHours: 48 });
      expect(result.verdict).toBe("skip");
      expect(result.skips.length).toBeGreaterThan(0);
    });
  });

  describe("summarize", () => {
    it("reports top3 reasons with counts", () => {
      const report = summarize({
        reasons: [
          { reason: "launch_canary_stripped", n: 61 },
          { reason: "budget_skip", n: 7 },
          { reason: "landing_blocked", n: 3 },
          { reason: "landing_error_page", n: 1 },
        ],
        windowHours: 48,
        checkedAt: "2026-09-09T00:00:00.000Z",
        local: false,
      });
      expect(report.verdict).toBe("pass");
      expect(report.total).toBe(72);
      expect(report.top3).toEqual([
        { reason: "launch_canary_stripped", n: 61 },
        { reason: "budget_skip", n: 7 },
        { reason: "landing_blocked", n: 3 },
      ]);
      expect(report.ok).toBe(true);
    });

    it("ok=true when only structural reasons are present", () => {
      const report = summarize({
        reasons: [{ reason: "launch_canary_stripped", n: 61 }],
        windowHours: 48,
        checkedAt: "2026-09-09T00:00:00.000Z",
        local: false,
      });
      expect(report.ok).toBe(true);
    });

    it("ok=false when a silent reason is present", () => {
      const report = summarize({
        reasons: [
          { reason: "launch_canary_stripped", n: 61 },
          { reason: "succeeded_no_screenshot_unclassified", n: 1 },
        ],
        windowHours: 48,
        checkedAt: "2026-09-09T00:00:00.000Z",
        local: false,
      });
      expect(report.ok).toBe(false);
      expect(report.verdict).toBe("fail");
      expect(report.silent).toEqual([
        { reason: "succeeded_no_screenshot_unclassified", n: 1 },
      ]);
    });
  });

  describe("renderHumanReport", () => {
    it("tags the real budget skip_reason value as structural", () => {
      const report = renderHumanReport({
        reasons: [
          { reason: "launch_canary_stripped", n: 61 },
          { reason: "skipped_due_to_budget", n: 7 },
        ],
        windowHours: 48,
        checkedAt: "2026-09-09T00:00:00.000Z",
        local: false,
      });
      expect(report).toMatch(/skipped_due_to_budget \[structural\]: 7/);
      expect(report).toMatch(/launch_canary_stripped \[structural\]: 61/);
    });
  });
});