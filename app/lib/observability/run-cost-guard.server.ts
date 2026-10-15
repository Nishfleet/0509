import { captureMessage } from "@sentry/cloudflare";

import { insertCostAlerts } from "../data/cost_alert.server";
import { countVerdictsOnDay } from "../data/jev_verdict.server";
import { readBrowserMsForDay } from "../site/browser-budget.server";
import { fetchDailyUsage } from "./cost-analytics.server";
import { LOCAL_LINES, evaluateCost } from "./cost-guard";
import type { CostBreach, DailyUsage } from "./cost-guard";

function reportMissingAnalyticsToken(apiToken: string | undefined): void {
  if (apiToken !== undefined) return;
  captureMessage("cost guard skipped D1 and R2: CLOUDFLARE_API_TOKEN unset", {
    level: "error",
    fingerprint: ["cost-guard-token-missing"],
  });
}

export async function runCostGuard(
  db: D1Database,
  apiToken: string | undefined,
  day: string,
): Promise<{
  usage: DailyUsage;
  onBrands: number;
  breaches: readonly CostBreach[];
  alertIds: readonly string[];
}> {
  reportMissingAnalyticsToken(apiToken);
  const [cloudflare, browserMs, aiCalls] = await Promise.all([
    apiToken === undefined ? { day, d1RowsWritten: 0, r2ClassAOps: 0 } : fetchDailyUsage(day, apiToken),
    readBrowserMsForDay(day),
    countVerdictsOnDay(db, day),
  ]);
  const usage: DailyUsage = { ...cloudflare, browserMs, aiCalls };
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM entity WHERE role = 'competitor' AND state = 'on'")
    .first<{ n: number }>();
  const onBrands = row?.n ?? 0;
  const breaches = evaluateCost(usage, onBrands, apiToken === undefined ? LOCAL_LINES : undefined);
  const alertIds = await insertCostAlerts(db, breaches);
  if (alertIds.length > 0) {
    captureMessage(`cost guard breach on ${day}: ${breaches.map((breach) => breach.line).join(", ")}`, {
      level: "error",
      fingerprint: ["cost-guard-breach"],
    });
  }
  return { usage, onBrands, breaches, alertIds };
}

export function runNightlyCostGuard(db: D1Database, apiToken: string | undefined, scheduledTime: number) {
  const day = new Date(scheduledTime - 86_400_000).toISOString().slice(0, 10);
  return runCostGuard(db, apiToken === "" ? undefined : apiToken, day);
}
