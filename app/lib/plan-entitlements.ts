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

export type ScheduledScanCadence = "none" | "weekly_monday" | "daily";

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
  monitoringQueuePriority: MonitoringQueuePriority;
  metaSourceStatus: "unavailable" | "beta_limited" | "beta_priority";
  features: ReadonlySet<PlanFeature>;
}

const SCOUT_FEATURES: PlanFeature[] = [
  "competitor_research",
  "weekly_digest",
  "email_delivery",
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
];

const AGENCY_FEATURES: PlanFeature[] = [
  ...STARTER_FEATURES,
  "client_reports",
  "share_links",
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
    watchlists: 0,
    collections: 0,
    includedEvidenceChecksPerMonth: 0,
    workspaceSeats: 1,
    digestCadence: "none",
    scheduledScanCadence: "none",
    monitoringQueuePriority: 2,
    metaSourceStatus: "unavailable",
    features: new Set(),
  },
  scout: {
    planFamily: "scout",
    watchlists: 3,
    collections: 10,
    includedEvidenceChecksPerMonth: 50,
    workspaceSeats: 1,
    digestCadence: "weekly",
    scheduledScanCadence: "weekly_monday",
    monitoringQueuePriority: 2,
    metaSourceStatus: "beta_limited",
    features: new Set(SCOUT_FEATURES),
  },
  starter: {
    planFamily: "starter",
    watchlists: 10,
    collections: 25,
    includedEvidenceChecksPerMonth: 250,
    workspaceSeats: 1,
    digestCadence: "daily_and_weekly",
    scheduledScanCadence: "daily",
    monitoringQueuePriority: 1,
    metaSourceStatus: "beta_limited",
    features: new Set(STARTER_FEATURES),
  },
  agency: {
    planFamily: "agency",
    watchlists: 75,
    collections: 250,
    includedEvidenceChecksPerMonth: 2500,
    workspaceSeats: 3,
    digestCadence: "daily_and_weekly",
    scheduledScanCadence: "daily",
    monitoringQueuePriority: 0,
    metaSourceStatus: "beta_priority",
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
  };
}

export function planAllowsDigestCadence(planFamily: PlanFamily, cadence: "daily" | "weekly"): boolean {
  const policy = getPlanEntitlements(planFamily).digestCadence;
  if (policy === "none") return false;
  if (cadence === "daily") return policy === "daily_and_weekly";
  return policy === "weekly" || policy === "daily_and_weekly";
}

export function shouldScheduleScoutOnDate(planFamily: PlanFamily, scheduledAt: Date): boolean {
  if (getPlanEntitlements(planFamily).scheduledScanCadence !== "weekly_monday") {
    return true;
  }
  return scheduledAt.getUTCDay() === 1;
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
