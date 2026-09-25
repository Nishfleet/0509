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

type Override = Partial<Record<(typeof ENTITLEMENT_KEYS)[number], unknown>>;

const isNonNegativeInteger = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0;

const isSiteScope = (value: unknown): value is Entitlements["site_pages_scope"] =>
  value === "home_pricing" || value === "all";

const isUnlimitedOrNonNegativeInteger = (
  value: unknown,
): value is number | null => value === null || isNonNegativeInteger(value);

function isValidFor(key: (typeof ENTITLEMENT_KEYS)[number], value: unknown): boolean {
  switch (key) {
    case "competitors":
    case "marks_history_days":
    case "standing_history_weeks":
      return isNonNegativeInteger(value);
    case "own_site_alerts":
    case "paid_scraper_sources":
    case "api_access":
      return typeof value === "boolean";
    case "site_pages_scope":
      return isSiteScope(value);
    case "workspaces_max":
      return isUnlimitedOrNonNegativeInteger(value);
  }
}

export function resolveEntitlements(tier: string, limitsJson: string): Entitlements {
  const plan = PLANS.find((entry) => entry.id === tier);
  const base: Entitlements = plan ? plan.limits : MOST_RESTRICTIVE;

  let overrides: Override;
  try {
    const parsed: unknown = JSON.parse(limitsJson);
    overrides =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    overrides = {};
  }

  const resolved = {} as Record<(typeof ENTITLEMENT_KEYS)[number], unknown>;
  for (const key of ENTITLEMENT_KEYS) {
    const value = overrides[key];
    resolved[key] = isValidFor(key, value) ? value : base[key];
  }
  return resolved as Entitlements;
}
