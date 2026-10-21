import { describe, expect, it } from "vitest";

import {
  ACCOUNT_DAY_LIMIT,
  BROWSER_ONLY_LINES,
  COST_GUARD_FACTOR,
  EXPECTED_PER_BRAND_DAY,
  evaluateCost,
} from "../../app/lib/observability/cost-guard";
import type { DailyUsage } from "../../app/lib/observability/cost-guard";

const AT_FACTOR: DailyUsage = {
  day: "2026-09-21",
  d1RowsWritten: 0,
  r2StoredBytes: 0,
  r2ClassAOps: 300,
  browserMs: 450_000,
  aiCalls: 1_200,
};

const QUIET: DailyUsage = {
  day: "2026-09-21",
  d1RowsWritten: 0,
  r2StoredBytes: 0,
  r2ClassAOps: 0,
  browserMs: 0,
  aiCalls: 0,
};

describe("evaluateCost per-brand lines", () => {
  it("reads the documented per-brand figures and the factor of three", () => {
    expect(COST_GUARD_FACTOR).toBe(3);
    expect(EXPECTED_PER_BRAND_DAY).toEqual({
      r2_class_a_ops: 10,
      browser_ms_0509: 15_000,
      ai_calls_0509: 40,
    });
  });

  it("returns no breach at exactly three times the documented per-brand figure", () => {
    expect(evaluateCost(AT_FACTOR, 10)).toEqual([]);
  });

  it("reports browser_ms_0509 when one extra millisecond puts the line strictly over the factor", () => {
    expect(evaluateCost({ ...AT_FACTOR, browserMs: 450_001 }, 10)).toEqual([
      {
        day: "2026-09-21",
        line: "browser_ms_0509",
        scope: "per_brand",
        measuredPerBrand: 45_000.1,
        expectedPerBrand: 15_000,
        limit: 45_000,
        onBrands: 10,
      },
    ]);
  });

  it("reports r2_class_a_ops when one extra operation puts the line strictly over the factor", () => {
    expect(evaluateCost({ ...AT_FACTOR, r2ClassAOps: 301 }, 10)).toEqual([
      {
        day: "2026-09-21",
        line: "r2_class_a_ops",
        scope: "per_brand",
        measuredPerBrand: 30.1,
        expectedPerBrand: 10,
        limit: 30,
        onBrands: 10,
      },
    ]);
  });

  it("reports ai_calls_0509 when one extra call puts the line strictly over the factor", () => {
    expect(evaluateCost({ ...AT_FACTOR, aiCalls: 1_201 }, 10)).toEqual([
      {
        day: "2026-09-21",
        line: "ai_calls_0509",
        scope: "per_brand",
        measuredPerBrand: 120.1,
        expectedPerBrand: 40,
        limit: 120,
        onBrands: 10,
      },
    ]);
  });

  it("divides by one when no brand is ON, so the floor still reports", () => {
    expect(evaluateCost({ ...QUIET, r2ClassAOps: 223287 }, 0)).toEqual([
      {
        day: "2026-09-21",
        line: "r2_class_a_ops",
        scope: "per_brand",
        measuredPerBrand: 223287,
        expectedPerBrand: 10,
        limit: 30,
        onBrands: 0,
      },
    ]);
  });

  it("does not throw when the usage object is frozen", () => {
    expect(() => evaluateCost(Object.freeze({ ...AT_FACTOR }), 10)).not.toThrow();
  });
});

describe("evaluateCost account-wide lines", () => {
  it("sets the daily limits under the included monthly allowances", () => {
    expect(ACCOUNT_DAY_LIMIT).toEqual({
      d1_rows_written_account: 1_500_000,
      r2_stored_bytes_account: 30_000_000_000,
    });
  });

  it("returns no breach for either line at exactly its limit", () => {
    const usage = { ...QUIET, d1RowsWritten: 1_500_000, r2StoredBytes: 30_000_000_000 };
    expect(evaluateCost(usage, 10)).toEqual([]);
  });

  it("reports d1_rows_written_account one row over the limit, undivided by brands", () => {
    expect(evaluateCost({ ...QUIET, d1RowsWritten: 1_500_001 }, 10)).toEqual([
      {
        day: "2026-09-21",
        line: "d1_rows_written_account",
        scope: "account",
        measuredPerBrand: 1_500_001,
        expectedPerBrand: 1_500_000,
        limit: 1_500_000,
        onBrands: 10,
      },
    ]);
  });

  it("reports r2_stored_bytes_account one byte over the limit, undivided by brands", () => {
    expect(evaluateCost({ ...QUIET, r2StoredBytes: 30_000_000_001 }, 1_000)).toEqual([
      {
        day: "2026-09-21",
        line: "r2_stored_bytes_account",
        scope: "account",
        measuredPerBrand: 30_000_000_001,
        expectedPerBrand: 30_000_000_000,
        limit: 30_000_000_000,
        onBrands: 1_000,
      },
    ]);
  });

  it("does not breach on the 2026-10-15 shape that used to trip the per-brand line", () => {
    const usage = { ...QUIET, d1RowsWritten: 227_324, r2StoredBytes: 21_457_036_566 };
    expect(evaluateCost(usage, 133)).toEqual([]);
    expect(evaluateCost({ ...usage, d1RowsWritten: 20_172 }, 133)).toEqual([]);
  });

  it("does not breach with no brand ON on a few thousand rows", () => {
    expect(evaluateCost({ ...QUIET, d1RowsWritten: 5_000 }, 0)).toEqual([]);
  });

  it("returns every over line in the fixed order", () => {
    const usage = {
      day: "2026-09-21",
      d1RowsWritten: 1_500_001,
      r2StoredBytes: 30_000_000_001,
      r2ClassAOps: 301,
      browserMs: 450_001,
      aiCalls: 1_201,
    };
    expect(evaluateCost(usage, 10).map((breach) => breach.line)).toEqual([
      "d1_rows_written_account",
      "r2_stored_bytes_account",
      "r2_class_a_ops",
      "browser_ms_0509",
      "ai_calls_0509",
    ]);
  });
});

describe("evaluateCost with a line subset", () => {
  it("evaluates only the requested lines", () => {
    const usage = {
      day: "2026-09-21",
      d1RowsWritten: 1_500_001,
      r2StoredBytes: 30_000_000_001,
      r2ClassAOps: 301,
      browserMs: 450_001,
      aiCalls: 1_201,
    };
    expect(evaluateCost(usage, 10, BROWSER_ONLY_LINES).map((breach) => breach.line)).toEqual(["browser_ms_0509"]);
  });
});
