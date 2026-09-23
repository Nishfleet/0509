export type CostLine = "d1_rows_written" | "r2_class_a_ops" | "browser_ms";

export interface DailyUsage {
  day: string;
  d1RowsWritten: number;
  r2ClassAOps: number;
  browserMs: number;
}

export const EXPECTED_PER_BRAND_DAY: Readonly<Record<CostLine, number>> = {
  d1_rows_written: 10,
  r2_class_a_ops: 10,
  browser_ms: 15_000,
};

export const COST_GUARD_FACTOR = 3;

export interface CostBreach {
  day: string;
  line: CostLine;
  measuredPerBrand: number;
  expectedPerBrand: number;
  onBrands: number;
}

const LINES: readonly CostLine[] = ["d1_rows_written", "r2_class_a_ops", "browser_ms"];

const MEASURED: Readonly<Record<CostLine, (usage: DailyUsage) => number>> = {
  d1_rows_written: (usage) => usage.d1RowsWritten,
  r2_class_a_ops: (usage) => usage.r2ClassAOps,
  browser_ms: (usage) => usage.browserMs,
};

export function evaluateCost(usage: DailyUsage, onBrands: number): readonly CostBreach[] {
  const divisor = Math.max(onBrands, 1);
  return LINES.map((line) => ({
    day: usage.day,
    line,
    measuredPerBrand: MEASURED[line](usage) / divisor,
    expectedPerBrand: EXPECTED_PER_BRAND_DAY[line],
    onBrands,
  })).filter((breach) => breach.measuredPerBrand > COST_GUARD_FACTOR * breach.expectedPerBrand);
}
