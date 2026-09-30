import { describe, expect, it } from "vitest";

import {
  BROWSER_ONLY_LINES,
  COST_GUARD_FACTOR,
  EXPECTED_PER_BRAND_DAY,
  evaluateCost,
} from "../../app/lib/observability/cost-guard";
import type { CostLine, DailyUsage } from "../../app/lib/observability/cost-guard";

const AT_FACTOR: DailyUsage = {
  day: "2026-09-21",
  d1RowsWritten: 300,
  r2ClassAOps: 300,
  browserMs: 450_000,
};

const LINES: readonly CostLine[] = ["d1_rows_written", "r2_class_a_ops", "browser_ms_0509"];

describe("evaluateCost", () => {
  it("reads the documented per-brand figures and the factor of three", () => {
    expect(COST_GUARD_FACTOR).toBe(3);
    expect(LINES.map((line) => EXPECTED_PER_BRAND_DAY[line])).toEqual([10, 10, 15_000]);
  });

  it("returns no breach at exactly three times the documented per-brand figure", () => {
    expect(evaluateCost(AT_FACTOR, 10)).toEqual([]);
  });

  it("reports browser_ms_0509 when one extra millisecond puts the line strictly over the factor", () => {
    expect(evaluateCost({ ...AT_FACTOR, browserMs: 450_001 }, 10)).toEqual([
      {
        day: "2026-09-21",
        line: "browser_ms_0509",
        measuredPerBrand: 45_000.1,
        expectedPerBrand: 15_000,
        onBrands: 10,
      },
    ]);
  });

  it("reports d1 when one extra row puts the line strictly over the factor", () => {
    expect(evaluateCost({ ...AT_FACTOR, d1RowsWritten: 301 }, 10)).toEqual([
      {
        day: "2026-09-21",
        line: "d1_rows_written",
        measuredPerBrand: 30.1,
        expectedPerBrand: 10,
        onBrands: 10,
      },
    ]);
  });

  it("divides by one when no brand is ON, so the floor still reports", () => {
    expect(evaluateCost({ day: "2026-09-21", d1RowsWritten: 223287, r2ClassAOps: 0, browserMs: 0 }, 0)).toEqual([
      {
        day: "2026-09-21",
        line: "d1_rows_written",
        measuredPerBrand: 223287,
        expectedPerBrand: 10,
        onBrands: 0,
      },
    ]);
  });

  it("returns every over line in the fixed order", () => {
    expect(evaluateCost({ day: "2026-09-21", d1RowsWritten: 301, r2ClassAOps: 301, browserMs: 450_001 }, 10)).toEqual([
      {
        day: "2026-09-21",
        line: "d1_rows_written",
        measuredPerBrand: 30.1,
        expectedPerBrand: 10,
        onBrands: 10,
      },
      {
        day: "2026-09-21",
        line: "r2_class_a_ops",
        measuredPerBrand: 30.1,
        expectedPerBrand: 10,
        onBrands: 10,
      },
      {
        day: "2026-09-21",
        line: "browser_ms_0509",
        measuredPerBrand: 45_000.1,
        expectedPerBrand: 15_000,
        onBrands: 10,
      },
    ]);
  });

  it("does not throw when the usage object is frozen", () => {
    expect(() => evaluateCost(Object.freeze({ ...AT_FACTOR }), 10)).not.toThrow();
  });
});

describe("evaluateCost with a line subset", () => {
  it("evaluates only the requested lines", () => {
    const usage = { day: "2026-09-21", d1RowsWritten: 301, r2ClassAOps: 301, browserMs: 450_001 };
    expect(evaluateCost(usage, 10, BROWSER_ONLY_LINES).map((breach) => breach.line)).toEqual(["browser_ms_0509"]);
  });
});
