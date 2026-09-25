import type { Entitlements } from "./entitlements";

export const PLANS = [
  {
    id: "scout",
    name: "Scout",
    monthlyPriceEur: 10,
    competitors: 5,
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
    competitors: 15,
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
    competitors: 50,
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

export const TRIAL_TERMS =
  "Every plan starts with a 7-day trial. Your card is taken up front and charged on day 8 unless you cancel.";

export function monthlyPrice(eur: number): string {
  return `€${String(eur)}/mo`;
}
