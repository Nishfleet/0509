import { insertCostAlerts } from "../data/cost_alert.server";
import { readBrowserMsForDay } from "../site/browser-budget.server";
import { fetchDailyUsage } from "./cost-analytics.server";
import { evaluateCost } from "./cost-guard";
import type { CostBreach, DailyUsage } from "./cost-guard";

export async function runCostGuard(
  db: D1Database,
  apiToken: string,
  day: string,
): Promise<{
  usage: DailyUsage;
  onBrands: number;
  breaches: readonly CostBreach[];
  alertIds: readonly string[];
}> {
  const [cloudflare, browserMs] = await Promise.all([fetchDailyUsage(day, apiToken), readBrowserMsForDay(day)]);
  const usage: DailyUsage = { ...cloudflare, browserMs };
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM entity WHERE role = 'competitor' AND state = 'on'")
    .first<{ n: number }>();
  const onBrands = row?.n ?? 0;
  const breaches = evaluateCost(usage, onBrands);
  const alertIds = await insertCostAlerts(db, breaches);
  return { usage, onBrands, breaches, alertIds };
}
