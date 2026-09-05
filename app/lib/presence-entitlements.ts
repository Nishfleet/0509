/**
 * Presence tracking limits — named configurable caps, not monetary values.
 * Gated by plan family features only; evidence top-ups do NOT unlock presence.
 */

import {
  canUsePlanFeature,
  type PlanFamily,
  type PlanFeature,
} from "~/lib/plan-entitlements";

export const PRESENCE_PLAN_FEATURES = [
  "presence_competitor_tracking",
  "presence_self_tracking",
  "presence_website_sources",
  "presence_social_connect",
  "presence_digest_alerts",
] as const;

export type PresencePlanFeature = (typeof PRESENCE_PLAN_FEATURES)[number];

export interface PresenceLimits {
  maxTrackedEntities: number;
  maxSelfEntities: number;
  maxCompetitorEntities: number;
  maxWebsiteSourcesPerEntity: number;
  maxSocialSourcesPerEntity: number;
}

const PRESENCE_LIMITS: Record<PlanFamily, PresenceLimits> = {
  free: {
    maxTrackedEntities: 0,
    maxSelfEntities: 0,
    maxCompetitorEntities: 0,
    maxWebsiteSourcesPerEntity: 0,
    maxSocialSourcesPerEntity: 0,
  },
  scout: {
    maxTrackedEntities: 3,
    maxSelfEntities: 0,
    maxCompetitorEntities: 3,
    maxWebsiteSourcesPerEntity: 2,
    maxSocialSourcesPerEntity: 0,
  },
  starter: {
    maxTrackedEntities: 8,
    maxSelfEntities: 2,
    maxCompetitorEntities: 8,
    maxWebsiteSourcesPerEntity: 4,
    maxSocialSourcesPerEntity: 2,
  },
  agency: {
    maxTrackedEntities: 30,
    maxSelfEntities: 10,
    maxCompetitorEntities: 30,
    maxWebsiteSourcesPerEntity: 8,
    maxSocialSourcesPerEntity: 4,
  },
};

export function getPresenceLimits(planFamily: PlanFamily): PresenceLimits {
  return PRESENCE_LIMITS[planFamily];
}

export function canUsePresenceFeature(planFamily: PlanFamily, feature: PresencePlanFeature): boolean {
  return canUsePlanFeature(planFamily, feature as PlanFeature);
}

export function presenceModeAllowed(
  planFamily: PlanFamily,
  mode: "self" | "competitor",
): boolean {
  if (mode === "self") {
    return canUsePresenceFeature(planFamily, "presence_self_tracking");
  }
  return canUsePresenceFeature(planFamily, "presence_competitor_tracking");
}

/** Evidence top-up grants must never unlock presence capabilities. */
export function presenceUnlockedByEvidenceTopUp(): false {
  return false;
}
