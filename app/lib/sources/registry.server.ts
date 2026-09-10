import type { AppEnv } from "~/lib/env.server";
import { getPlanEntitlements, type PlanFamily } from "~/lib/plan-entitlements";
import type { SourceAdapter, SourceId } from "~/lib/sources/types";
import { googleSearchAdapter } from "~/lib/sources/google-search.server";
import { googleAdsAdapter } from "~/lib/sources/google-ads.server";
import { linkedinAdsAdapter } from "~/lib/sources/linkedin-ads.server";
import { tiktokAdsAdapter } from "~/lib/sources/tiktok-ads.server";
import { subdomainsAdapter } from "~/lib/sources/subdomains.server";
import { hiringAdapter } from "~/lib/sources/hiring.server";

/**
 * The static registry of all competitor-monitoring source adapters. The
 * seam (#2218) owns this array and the six stub modules it imports; each
 * source ticket replaces one stub in place, so this file never changes
 * after the seam merges.
 */
export const SOURCES: readonly SourceAdapter[] = [
  googleSearchAdapter,
  googleAdsAdapter,
  linkedinAdsAdapter,
  tiktokAdsAdapter,
  subdomainsAdapter,
  hiringAdapter,
];

export function getSourceAdapter(id: SourceId): SourceAdapter | undefined {
  return SOURCES.find((adapter) => adapter.id === id);
}

/**
 * Filter the registry by env (adapter.requiresEnv) and by plan entitlements.
 * The plan's `sources` entitlement is added by #2212 in plan.server.ts; until
 * then the field is absent and "all sources" is the default (the issue's
 * explicit contract: "a missing `sources` field means 'all sources'").
 */
export function getEnabledSources(env: AppEnv, plan: PlanFamily): SourceAdapter[] {
  const entitlements = getPlanEntitlements(plan) as { sources?: SourceId[] | "all" };
  const allowed = entitlements.sources ?? "all";
  const allowedSet = allowed === "all" ? null : new Set(allowed);

  return SOURCES.filter((adapter) => {
    if (!adapter.requiresEnv(env)) return false;
    if (allowedSet && !allowedSet.has(adapter.id)) return false;
    return true;
  });
}
