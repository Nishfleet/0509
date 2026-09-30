import type { Entitlements } from "./entitlements";

export const PLANS = [
  {
    id: "scout",
    name: "Scout",
    monthlyPriceEur: 10,
    limits: {
      competitors: 5,
      site_pages_scope: "home_pricing",
      own_site_alerts: false,
      paid_scraper_sources: false,
      marks_history_days: 90,
      standing_history_weeks: 4,
      workspaces_max: 1,
      api_access: true,
    } satisfies Entitlements,
  },
  {
    id: "starter",
    name: "Starter",
    monthlyPriceEur: 46,
    limits: {
      competitors: 15,
      site_pages_scope: "all",
      own_site_alerts: true,
      paid_scraper_sources: true,
      marks_history_days: 365,
      standing_history_weeks: 52,
      workspaces_max: 1,
      api_access: true,
    } satisfies Entitlements,
  },
  {
    id: "agency",
    name: "Agency",
    monthlyPriceEur: 136,
    limits: {
      competitors: 50,
      site_pages_scope: "all",
      own_site_alerts: true,
      paid_scraper_sources: true,
      marks_history_days: 365,
      standing_history_weeks: 52,
      workspaces_max: null,
      api_access: true,
    } satisfies Entitlements,
  },
] as const;

export type PlanId = (typeof PLANS)[number]["id"];

export interface PlanSummary {
  tier: PlanId;
  status: string;
  currentPeriodEnd: string | null;
  billed: boolean;
}

export const TRIAL_DAYS = 7;

export const TRIAL_TERMS = `Every plan starts with a ${String(TRIAL_DAYS)}-day trial. Your card is taken up front and charged on day ${String(TRIAL_DAYS + 1)} unless you cancel.`;

export function isPlanId(value: unknown): value is PlanId {
  return PLANS.some((plan) => plan.id === value);
}

export function nextPlan(tier: string): (typeof PLANS)[number] | null {
  const index = PLANS.findIndex((plan) => plan.id === tier);
  return index < 0 ? null : (PLANS[index + 1] ?? null);
}

export function monthlyPrice(eur: number): string {
  return `€${String(eur)}/mo`;
}
