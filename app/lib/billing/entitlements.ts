import { z } from "zod";

import { PLANS } from "./plans";

export interface Entitlements {
  competitors: number;
  site_pages_scope: "home_pricing" | "all";
  own_site_alerts: boolean;
  paid_scraper_sources: boolean;
  marks_history_days: number;
  standing_history_weeks: number;
  workspaces_max: number | null;
  api_access: boolean;
}

export const ENTITLEMENT_KEYS = [
  "competitors",
  "site_pages_scope",
  "own_site_alerts",
  "paid_scraper_sources",
  "marks_history_days",
  "standing_history_weeks",
  "workspaces_max",
  "api_access",
] as const;

export const MOST_RESTRICTIVE: Entitlements = {
  competitors: 0,
  site_pages_scope: "home_pricing",
  own_site_alerts: false,
  paid_scraper_sources: false,
  marks_history_days: 0,
  standing_history_weeks: 0,
  workspaces_max: 1,
  api_access: false,
};

const nonNegativeInteger = z.number().int().nonnegative();
const siteScope = z.enum(["home_pricing", "all"]);

function overrides(base: Entitlements) {
  return z.object({
    competitors: nonNegativeInteger.catch(base.competitors),
    site_pages_scope: siteScope.catch(base.site_pages_scope),
    own_site_alerts: z.boolean().catch(base.own_site_alerts),
    paid_scraper_sources: z.boolean().catch(base.paid_scraper_sources),
    marks_history_days: nonNegativeInteger.catch(base.marks_history_days),
    standing_history_weeks: nonNegativeInteger.catch(base.standing_history_weeks),
    workspaces_max: nonNegativeInteger.nullable().catch(base.workspaces_max),
    api_access: z.boolean().catch(base.api_access),
  });
}

function parseLimits(limitsJson: string): unknown {
  try {
    return JSON.parse(limitsJson);
  } catch {
    return {};
  }
}

export function resolveEntitlements(tier: string, limitsJson: string): Entitlements {
  const plan = PLANS.find((entry) => entry.id === tier);
  const base: Entitlements = plan ? plan.limits : MOST_RESTRICTIVE;
  const schema = overrides(base);
  const parsed = schema.safeParse(parseLimits(limitsJson));
  return parsed.success ? parsed.data : schema.parse({});
}
