import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FULLSITE_RUNS_GRACE_UNTIL,
  buildFullSiteRunsQuery,
  evaluateFullSiteRuns,
  parseArgs,
  rowsFromWranglerJson,
  scanCountFromRows,
} from "../scripts/check-d1-fullsite-runs.mjs";

describe("check-d1-fullsite-runs (#2110)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pins the grace instant the canary fails after", () => {
    expect(FULLSITE_RUNS_GRACE_UNTIL).toBe("2026-09-11T00:00:00Z");
  });

  describe("grace logic (fake clock)", () => {
    it("warns and stays green on 0 rows before the grace instant", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-10T12:00:00Z"));
      const verdict = evaluateFullSiteRuns({ rowCount: 0, now: new Date() });
      expect(verdict).toEqual({ ok: true, warned: true, pastGrace: false, rowCount: 0 });
    });

    it("fails on 0 rows once now is past the grace instant", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-11T00:00:01Z"));
      const verdict = evaluateFullSiteRuns({ rowCount: 0, now: new Date() });
      expect(verdict).toEqual({ ok: false, warned: false, pastGrace: true, rowCount: 0 });
    });

    it("treats the exact grace instant as not yet past (still WARN)", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(FULLSITE_RUNS_GRACE_UNTIL));
      const verdict = evaluateFullSiteRuns({ rowCount: 0, now: new Date() });
      expect(verdict.ok).toBe(true);
      expect(verdict.warned).toBe(true);
      expect(verdict.pastGrace).toBe(false);
    });

    it("is green on rows regardless of the clock", () => {
      for (const instant of ["2026-09-09T00:00:00Z", "2026-09-20T00:00:00Z"]) {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(instant));
        const verdict = evaluateFullSiteRuns({ rowCount: 3, now: new Date() });
        expect(verdict.ok).toBe(true);
        expect(verdict.warned).toBe(false);
        expect(verdict.rowCount).toBe(3);
        vi.useRealTimers();
      }
    });
  });

  describe("parseArgs", () => {
    it("returns defaults for an empty argv", () => {
      expect(parseArgs([])).toEqual({ local: false, json: false, help: false });
    });

    it("accepts --local, --json, and --help", () => {
      expect(parseArgs(["--local", "--json", "--help"])).toEqual({
        local: true,
        json: true,
        help: true,
      });
      expect(parseArgs(["-h"]).help).toBe(true);
    });

    it("throws on an unknown flag", () => {
      expect(() => parseArgs(["--bogus"])).toThrow(/Unknown argument/);
    });
  });

  describe("buildFullSiteRunsQuery", () => {
    it("is a constant read-only COUNT over website_site_scan", () => {
      const sql = buildFullSiteRunsQuery();
      expect(sql).toMatch(/^\s*SELECT\s+COUNT\(\*\)\s+AS\s+scan_count\s+FROM\s+website_site_scan\s*;/i);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|PRAGMA)\b/i);
    });
  });

  describe("rowsFromWranglerJson + scanCountFromRows", () => {
    it("reads the count from wrangler --json output", () => {
      const output = JSON.stringify([{ results: [{ scan_count: 7 }] }]);
      expect(scanCountFromRows(rowsFromWranglerJson(output))).toBe(7);
    });

    it("reads a zero count as zero, not as a parse failure", () => {
      const output = JSON.stringify([{ results: [{ scan_count: 0 }] }]);
      expect(scanCountFromRows(rowsFromWranglerJson(output))).toBe(0);
    });

    it("fails closed when the wrangler JSON has no trustworthy scan_count", () => {
      expect(() => scanCountFromRows([])).toThrow(/scan_count/);
      expect(() => scanCountFromRows([{ scan_count: "not-a-number" }])).toThrow(/scan_count/);
      expect(() => scanCountFromRows([{ scan_count: -2 }])).toThrow(/scan_count/);
    });
  });
});
