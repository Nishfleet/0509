import { describe, expect, it } from "vitest";

import {
  buildGhIssueCommand,
  buildIssueBody,
  buildScreenshotRateQuery,
  mapScreenshotRateRows,
  parseArgs,
  rowsFromWranglerJson,
  validateScreenshotRate,
} from "../scripts/canary-proof-screenshot-rate.mjs";

describe("canary-proof-screenshot-rate (#1327)", () => {
  describe("parseArgs", () => {
    it("returns defaults for an empty argv", () => {
      expect(parseArgs([])).toEqual({
        local: false,
        json: false,
        windowHours: 48,
        threshold: 80,
        minSample: 20,
        fileIssue: false,
        dryRun: false,
      });
    });

    it("accepts --local, --json, --window-hours, --threshold, --min-sample, --file-issue, --dry-run", () => {
      expect(
        parseArgs([
          "--local",
          "--json",
          "--file-issue",
          "--dry-run",
          "--window-hours",
          "72",
          "--threshold",
          "90",
          "--min-sample",
          "25",
        ]),
      ).toEqual({
        local: true,
        json: true,
        windowHours: 72,
        threshold: 90,
        minSample: 25,
        fileIssue: true,
        dryRun: true,
      });
    });

    it("ignores non-positive / out-of-range numeric values", () => {
      expect(parseArgs(["--window-hours", "0", "--threshold", "250", "--min-sample", "-1"])).toMatchObject({
        windowHours: 48,
        threshold: 80,
        minSample: 20,
      });
    });

    it("throws on an unknown flag", () => {
      expect(() => parseArgs(["--bogus"])).toThrow(/Unknown argument/);
    });
  });

  describe("buildScreenshotRateQuery", () => {
    it("embeds the requested window-hours with integer concatenation (no SQL interpolation)", () => {
      const sql = buildScreenshotRateQuery(48);
      expect(sql).toMatch(/datetime\('now', '-' \|\| 48 \|\| ' hours'\)/);
      expect(sql).toMatch(/status = 'succeeded'/);
      expect(sql).toMatch(/json_extract\(capture_metadata_json, '\$\.kind'\)/);
      expect(sql).toMatch(/GROUP BY json_extract\(capture_metadata_json, '\$\.kind'\)/);
    });

    it("rounds fractional hours to an integer", () => {
      expect(buildScreenshotRateQuery(48.9)).toMatch(/'-' \|\| 48 \|\| ' hours'/);
    });
  });

  describe("rowsFromWranglerJson", () => {
    it("accepts the bare results[] shape", () => {
      expect(
        rowsFromWranglerJson(JSON.stringify([{ results: [{ kind: null, total: 3 }] }])),
      ).toEqual([{ kind: null, total: 3 }]);
    });

    it("accepts the result.results shape", () => {
      expect(
        rowsFromWranglerJson(JSON.stringify([{ result: { results: [{ kind: null }] } }])),
      ).toEqual([{ kind: null }]);
    });

    it("returns an empty array on empty output", () => {
      expect(rowsFromWranglerJson("")).toEqual([]);
      expect(rowsFromWranglerJson("   \n  ")).toEqual([]);
    });
  });

  describe("mapScreenshotRateRows", () => {
    it("splits watcher (kind null) from launch-gate (kind=launch_readiness_real_capture) buckets", () => {
      const buckets = mapScreenshotRateRows([
        { kind: null, total: 5, with_shot: 5 },
        { kind: "launch_readiness_real_capture", total: 9, with_shot: 0 },
        { kind: null, total: 5, with_shot: 3 },
      ]);
      expect(buckets.real).toEqual({ kind: null, total: 10, withShot: 8, pct: 80 });
      expect(buckets.canary).toEqual({
        kind: "launch_readiness_real_capture",
        total: 9,
        withShot: 0,
        pct: 0,
      });
      expect(buckets.all).toEqual({ total: 19, withShot: 8, pct: 42.1 });
    });
  });

  describe("validateScreenshotRate", () => {
    const base = {
      canary: { total: 0, withShot: 0, pct: 0 },
      all: { total: 0, withShot: 0, pct: 0 },
      windowHours: 48,
      threshold: 80,
      minSample: 20,
    };

    it("passes when the real rate is at/above threshold with a sufficient sample", () => {
      const result = validateScreenshotRate({
        ...base,
        real: { total: 40, withShot: 36, pct: 90 },
      });
      expect(result.verdict).toBe("pass");
      expect(result.failures).toEqual([]);
      expect(result.skips).toEqual([]);
    });

    it("fails when the real rate drops below threshold with a sufficient sample", () => {
      const result = validateScreenshotRate({
        ...base,
        real: { total: 34, withShot: 0, pct: 0 },
      });
      expect(result.verdict).toBe("fail");
      expect(result.failures[0]).toMatch(/dropped below 80%/);
      expect(result.failures[0]).toMatch(/0\/34/);
    });

    it("skips (insufficient sample) below min-sample and never fails", () => {
      const result = validateScreenshotRate({
        ...base,
        real: { total: 5, withShot: 0, pct: 0 },
      });
      expect(result.verdict).toBe("skip");
      expect(result.failures).toEqual([]);
      expect(result.skips[0]).toMatch(/n=5 \(< min-sample 20\)/);
    });

    it("skips (no activity) when there are zero real captures and never fails", () => {
      const result = validateScreenshotRate({
        ...base,
        real: { total: 0, withShot: 0, pct: 0 },
      });
      expect(result.verdict).toBe("skip");
      expect(result.failures).toEqual([]);
      expect(result.skips[0]).toMatch(/n=0/);
    });
  });

  describe("buildIssueBody", () => {
    it("carries rate, sample size, and the capture-path code link (acceptance 3c)", () => {
      const body = buildIssueBody({
        real: { kind: null, total: 34, withShot: 0, pct: 0 },
        canary: { kind: "launch_readiness_real_capture", total: 9, withShot: 0, pct: 0 },
        all: { total: 43, withShot: 0, pct: 0 },
        windowHours: 48,
        threshold: 80,
        minSample: 20,
        checkedAt: "2026-09-04T00:00:00Z",
      });
      expect(body).toMatch(/rate \(real watcher captures\):\*\* 0%/);
      expect(body).toMatch(/\*\*sample size:\*\* 0\/34 succeeded captures/);
      expect(body).toMatch(/app\/lib\/browser-run\.server\.ts/);
      expect(body).toMatch(/app\/lib\/proof-artifact-retention\.server\.ts/);
      expect(body).toMatch(/screenshot-rate-guard-incident: true, window_hours: 48, rate: 0, n: 34/);
    });
  });

  describe("buildGhIssueCommand", () => {
    it("builds a gh issue create argv against Nishfleet/0509", () => {
      const command = buildGhIssueCommand({
        body: "body",
        title: "title",
        repo: "Nishfleet/0509",
      });
      expect(command).toEqual(["issue", "create", "-R", "Nishfleet/0509", "--title", "title", "--body", "body"]);
    });
  });
});