type PerBrandLine = "r2_class_a_ops" | "browser_ms_0509" | "ai_calls_0509";

type AccountLine = "d1_rows_written_account" | "r2_stored_bytes_account";

export type CostLine = AccountLine | PerBrandLine;

export interface DailyUsage {
  day: string;
  d1RowsWritten: number;
  r2StoredBytes: number;
  r2ClassAOps: number;
  browserMs: number;
  aiCalls: number;
}

export type CloudflareUsage = Omit<DailyUsage, "browserMs" | "aiCalls">;

export const EXPECTED_PER_BRAND_DAY: Readonly<Record<PerBrandLine, number>> = {
  r2_class_a_ops: 10,
  browser_ms_0509: 15_000,
  ai_calls_0509: 40,
};

export const ACCOUNT_DAY_LIMIT: Readonly<Record<AccountLine, number>> = {
  d1_rows_written_account: 1_500_000,
  r2_stored_bytes_account: 30_000_000_000,
};

export const COST_GUARD_FACTOR = 3;

export interface CostBreach {
  day: string;
  line: CostLine;
  scope: "per_brand" | "account";
  measuredPerBrand: number;
  expectedPerBrand: number;
  limit: number;
  onBrands: number;
}

export const BROWSER_ONLY_LINES: readonly CostLine[] = ["browser_ms_0509"];

export const LOCAL_LINES: readonly CostLine[] = ["browser_ms_0509", "ai_calls_0509"];

const LINES: readonly CostLine[] = [
  "d1_rows_written_account",
  "r2_stored_bytes_account",
  "r2_class_a_ops",
  "browser_ms_0509",
  "ai_calls_0509",
];

const MEASURED: Readonly<Record<CostLine, (usage: DailyUsage) => number>> = {
  d1_rows_written_account: (usage) => usage.d1RowsWritten,
  r2_stored_bytes_account: (usage) => usage.r2StoredBytes,
  r2_class_a_ops: (usage) => usage.r2ClassAOps,
  browser_ms_0509: (usage) => usage.browserMs,
  ai_calls_0509: (usage) => usage.aiCalls,
};

function isAccountLine(line: CostLine): line is AccountLine {
  return line === "d1_rows_written_account" || line === "r2_stored_bytes_account";
}

export function evaluateCost(
  usage: DailyUsage,
  onBrands: number,
  lines: readonly CostLine[] = LINES,
): readonly CostBreach[] {
  const divisor = Math.max(onBrands, 1);
  const breaches: CostBreach[] = [];
  for (const line of lines) {
    const measured = MEASURED[line](usage);
    if (isAccountLine(line)) {
      const limit = ACCOUNT_DAY_LIMIT[line];
      if (measured > limit) {
        breaches.push({
          day: usage.day,
          line,
          scope: "account",
          measuredPerBrand: measured,
          expectedPerBrand: limit,
          limit,
          onBrands,
        });
      }
      continue;
    }
    const expectedPerBrand = EXPECTED_PER_BRAND_DAY[line];
    const limit = COST_GUARD_FACTOR * expectedPerBrand;
    const measuredPerBrand = measured / divisor;
    if (measuredPerBrand > limit) {
      breaches.push({ day: usage.day, line, scope: "per_brand", measuredPerBrand, expectedPerBrand, limit, onBrands });
    }
  }
  return breaches;
}
