import type { CostBreach } from "../observability/cost-guard";

const INSERT_ALERT = `INSERT INTO cost_alert (id, day, line, measured_per_brand, expected_per_brand, on_brands, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(day, line) DO NOTHING RETURNING id`;

export async function insertCostAlerts(
  db: D1Database,
  breaches: readonly CostBreach[],
): Promise<readonly string[]> {
  if (breaches.length === 0) return [];
  const createdAt = new Date().toISOString();
  const statements = breaches.map((breach) =>
    db
      .prepare(INSERT_ALERT)
      .bind(
        crypto.randomUUID(),
        breach.day,
        breach.line,
        breach.measuredPerBrand,
        breach.expectedPerBrand,
        breach.onBrands,
        createdAt,
      ),
  );
  const results = await db.batch<{ id: string }>(statements);
  return results.flatMap((result) => result.results.map((row) => row.id));
}
