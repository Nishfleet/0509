/**
 * Authoritative plan entitlement catalog.
 * Contains limits, allowances, cadence, priority, and feature flags only — no prices or provider IDs.
 */

export const PLAN_FAMILIES = ["free", "scout", "starter", "agency"] as const;
export type PlanFamily = (typeof PLAN_FAMILIES)[number];
export type PaidPlanFamily = Exclude<PlanFamily, "free">;

export function isPaidPlanFamily(plan: PlanFamily): plan is PaidPlanFamily {
  return plan !== "free";
}

export type PlanResource = "watchlists" | "collections";

export type DigestCadencePolicy = "none" | "weekly" | "daily_and_weekly";

export type ScheduledScanCadence = "none" | "weekly" | "every_6h" | "every_3h";

export type MonitoringQueuePriority = 0 | 1 | 2;

export const MONITORING_QUEUE_PRIORITY: Record<PlanFamily, MonitoringQueuePriority> = {
  free: 2,
  agency: 0,
  starter: 1,
  scout: 2,
};

export const PLAN_FEATURES = [
  "competitor_research",
  "weekly_digest",
  "daily_digest",
  "high_priority_alerts",
  "landing_page_evidence",
  "email_delivery",
  "slack_delivery",
  "ad_text_multilingual",
  "english_translation",
  "export_csv",
  "export_json",
  "export_slack_ready",
  "client_reports",
  "share_links",
  "pdf_reports",
  "agency_branding",
  "api_access",
  "mcp_access",
  "mcp_account_actions",
  "team_workspace",
  "presence_competitor_tracking",
  "presence_self_tracking",
  "presence_website_sources",
  "presence_social_connect",
  "presence_digest_alerts",
] as const;

export type PlanFeature = (typeof PLAN_FEATURES)[number];

export interface PlanEntitlements {
  planFamily: PlanFamily;
  watchlists: number;
  collections: number;
  includedEvidenceChecksPerMonth: number;
  workspaceSeats: number;
  digestCadence: DigestCadencePolicy;
  scheduledScanCadence: ScheduledScanCadence;
  /**
   * WP-37: agency margin backstop. First N active watchlists (by created_at)
   * scan at the plan's full cadence; overflow slots only on 6h-aligned runs.
   * null = every watchlist uses full cadence (Scout/Starter/Free).
   */
  priorityScanSlots: number | null;
  monitoringQueuePriority: MonitoringQueuePriority;
  metaSourceStatus: "unavailable" | "limited" | "priority";
  features: ReadonlySet<PlanFeature>;
}

// Free Weekly Competitor Watch (PLG wedge): the weekly digest email is the
// product demo. Free gets exactly the weekly brief + the email lane it rides
// on — no instant alerts, Slack, evidence, exports, or collections.
const FREE_FEATURES: PlanFeature[] = ["weekly_digest", "email_delivery"];

const SCOUT_FEATURES: PlanFeature[] = [
  "competitor_research",
  "weekly_digest",
  "email_delivery",
  "presence_competitor_tracking",
  "presence_website_sources",
  "presence_digest_alerts",
];

const STARTER_FEATURES: PlanFeature[] = [
  ...SCOUT_FEATURES,
  "daily_digest",
  "high_priority_alerts",
  "landing_page_evidence",
  "slack_delivery",
  "ad_text_multilingual",
  "english_translation",
  "export_csv",
  "export_json",
  "export_slack_ready",
  // WP-29: watermarked share links for free acquisition (agency_branding stays
  // Agency-only so Starter shares keep "Made with Five to Nine").
  "share_links",
  "presence_self_tracking",
  "presence_social_connect",
];

const AGENCY_FEATURES: PlanFeature[] = [
  ...STARTER_FEATURES,
  "client_reports",
  "pdf_reports",
  "agency_branding",
  "api_access",
  "mcp_access",
  "mcp_account_actions",
  "team_workspace",
];

const ENTITLEMENTS: Record<PlanFamily, PlanEntitlements> = {
  free: {
    planFamily: "free",
    // Free Weekly Competitor Watch: one watchlist scanned once a week (the
    // Monday slot of the regular cron; see isWeeklyAlignedScan) feeding the
    // weekly digest email. Evidence/collections/instant budgets stay 0 —
    // paid plans unlock 3–6 hour cadence and everything else.
    watchlists: 1,
    collections: 0,
    includedEvidenceChecksPerMonth: 0,
    workspaceSeats: 1,
    digestCadence: "weekly",
    scheduledScanCadence: "weekly",
    priorityScanSlots: null,
    monitoringQueuePriority: 2,
    metaSourceStatus: "unavailable",
    features: new Set(FREE_FEATURES),
  },
  scout: {
    planFamily: "scout",
    watchlists: 3,
    collections: 10,
    includedEvidenceChecksPerMonth: 50,
    workspaceSeats: 1,
    digestCadence: "weekly",
    scheduledScanCadence: "every_6h",
    priorityScanSlots: null,
    monitoringQueuePriority: 2,
    metaSourceStatus: "limited",
    features: new Set(SCOUT_FEATURES),
  },
  starter: {
    planFamily: "starter",
    watchlists: 10,
    collections: 25,
    includedEvidenceChecksPerMonth: 250,
    workspaceSeats: 1,
    digestCadence: "daily_and_weekly",
    scheduledScanCadence: "every_3h",
    priorityScanSlots: null,
    monitoringQueuePriority: 1,
    metaSourceStatus: "limited",
    features: new Set(STARTER_FEATURES),
  },
  agency: {
    planFamily: "agency",
    watchlists: 75,
    collections: 250,
    includedEvidenceChecksPerMonth: 2500,
    workspaceSeats: 3,
    digestCadence: "daily_and_weekly",
    scheduledScanCadence: "every_3h",
    // First 25 at 3h; watchlists 26–75 only on 6h-aligned cron slots.
    priorityScanSlots: 25,
    monitoringQueuePriority: 0,
    metaSourceStatus: "priority",
    features: new Set(AGENCY_FEATURES),
  },
};

export function parsePlanFamily(value: string | null | undefined): PlanFamily {
  if (value === "scout" || value === "starter" || value === "agency" || value === "free") {
    return value;
  }
  return "free";
}

export function getPlanEntitlements(planFamily: PlanFamily): PlanEntitlements {
  return ENTITLEMENTS[planFamily];
}

export function getPlanLimit(planFamily: PlanFamily, resource: PlanResource): number {
  const entitlements = getPlanEntitlements(planFamily);
  return resource === "watchlists" ? entitlements.watchlists : entitlements.collections;
}

export function canUsePlanFeature(planFamily: PlanFamily, feature: PlanFeature): boolean {
  return getPlanEntitlements(planFamily).features.has(feature);
}

export function getIncludedEvidenceAllowance(planFamily: PlanFamily): number {
  return getPlanEntitlements(planFamily).includedEvidenceChecksPerMonth;
}

export function getWorkspaceSeatLimit(planFamily: PlanFamily): number {
  return getPlanEntitlements(planFamily).workspaceSeats;
}

export function getScheduledMonitoringPolicy(planFamily: PlanFamily) {
  const entitlements = getPlanEntitlements(planFamily);
  return {
    scheduledScanCadence: entitlements.scheduledScanCadence,
    monitoringQueuePriority: entitlements.monitoringQueuePriority,
    watchlistLimit: entitlements.watchlists,
    priorityScanSlots: entitlements.priorityScanSlots,
  };
}

export function planAllowsDigestCadence(planFamily: PlanFamily, cadence: "daily" | "weekly"): boolean {
  const policy = getPlanEntitlements(planFamily).digestCadence;
  if (policy === "none") return false;
  if (cadence === "daily") return policy === "daily_and_weekly";
  return policy === "weekly" || policy === "daily_and_weekly";
}

export function isSixHourAlignedScan(scheduledAt: Date): boolean {
  return scheduledAt.getUTCHours() % 6 === 0;
}

// Weekly-cadence plans ride exactly one tick of the regular 3-hour cron:
// Monday 03:00 UTC — two hours before the Monday 05:00 UTC weekly digest
// cron, so the brief always includes that morning's fresh scan.
export const WEEKLY_SCAN_UTC_DAY = 1;
export const WEEKLY_SCAN_UTC_HOUR = 3;

export function isWeeklyAlignedScan(scheduledAt: Date): boolean {
  return (
    scheduledAt.getUTCDay() === WEEKLY_SCAN_UTC_DAY &&
    scheduledAt.getUTCHours() === WEEKLY_SCAN_UTC_HOUR
  );
}

export function shouldSchedulePlanInRegularScan(planFamily: PlanFamily, scheduledAt: Date): boolean {
  const cadence = getPlanEntitlements(planFamily).scheduledScanCadence;
  if (cadence === "none") return false;
  if (cadence === "weekly") return isWeeklyAlignedScan(scheduledAt);
  if (cadence === "every_6h") return isSixHourAlignedScan(scheduledAt);
  return true;
}

/**
 * Per-watchlist schedule gate for WP-37 priority slots.
 * `watchlistRank` is 0-based among the workspace's active watchlists ordered by
 * created_at ASC, id ASC.
 */
export function shouldScheduleWatchlistInRegularScan(input: {
  planFamily: PlanFamily;
  scheduledAt: Date;
  watchlistRank: number;
}): boolean {
  if (!shouldSchedulePlanInRegularScan(input.planFamily, input.scheduledAt)) {
    return false;
  }
  const slots = getPlanEntitlements(input.planFamily).priorityScanSlots;
  if (slots == null) {
    return true;
  }
  if (!Number.isFinite(input.watchlistRank) || input.watchlistRank < 0) {
    return isSixHourAlignedScan(input.scheduledAt);
  }
  if (input.watchlistRank < slots) {
    return true;
  }
  return isSixHourAlignedScan(input.scheduledAt);
}

/** @deprecated Use shouldSchedulePlanInRegularScan for all plan families. */
export function shouldScheduleScoutOnDate(planFamily: PlanFamily, scheduledAt: Date): boolean {
  return shouldSchedulePlanInRegularScan(planFamily, scheduledAt);
}

/** @deprecated Import from plan-entitlements; kept for transitional imports. */
export const PLAN_LIMITS = Object.fromEntries(
  PLAN_FAMILIES.map((plan) => {
    const entitlements = ENTITLEMENTS[plan];
    return [
      plan,
      {
        watchlists: entitlements.watchlists,
        collections: entitlements.collections,
        digests: entitlements.digestCadence !== "none",
        digestCadence: entitlements.digestCadence,
        proofCapturesPerMonth: entitlements.includedEvidenceChecksPerMonth,
        metaSourceStatus: entitlements.metaSourceStatus,
      },
    ];
  }),
) as Record<
  PlanFamily,
  {
    watchlists: number;
    collections: number;
    digests: boolean;
    digestCadence: DigestCadencePolicy;
    proofCapturesPerMonth: number;
    metaSourceStatus: PlanEntitlements["metaSourceStatus"];
  }
>;

export function entitlementFeatureMatrix(): Array<{
  feature: PlanFeature;
  scout: boolean;
  starter: boolean;
  agency: boolean;
}> {
  return PLAN_FEATURES.filter((feature) => feature !== "competitor_research").map((feature) => ({
    feature,
    scout: canUsePlanFeature("scout", feature),
    starter: canUsePlanFeature("starter", feature),
    agency: canUsePlanFeature("agency", feature),
  }));
}
