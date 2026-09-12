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

/**
 * How many briefs a plan receives. `first_only` (Free) files the activation
 * scan's first evidence-linked brief once and then stops — no recurring
 * digests. `recurring` (paid) keeps the plan's digest cadence.
 */
export type BriefPolicy = "first_only" | "recurring";

/**
 * Source ids a plan may attach to a competitor. `meta` is the existing Meta
 * Ad Library source; the rest are the seam (#2218) source ids. `"all"` means
 * every source the registry enables. The seam reads
 * `getPlanEntitlements(plan).sources ?? "all"`.
 */
export type PlanSourceId =
  | "meta"
  | "google"
  | "google_ads"
  | "linkedin"
  | "tiktok"
  | "subdomains"
  | "hiring";
export type PlanSources = PlanSourceId[] | "all";

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
  "teams_delivery",
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
  "api_write_access",
  "mcp_access",
  "mcp_read_access",
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
  /**
   * Brief entitlement: `first_only` (Free) files the first brief once and
   * stops; `recurring` (paid) keeps the digest cadence. `planAllowsDigestCadence`
   * returns false for `first_only` so the digest cron never files a second
   * brief, while the activation-scan first-brief path (which does not consult
   * the cadence) still files the one included brief.
   */
  briefs: BriefPolicy;
  /**
   * Sources a plan may attach to a competitor. Free is Meta-only; paid plans
   * get every source. The seam (#2218) registry reads this to filter enabled
   * adapters.
   */
  sources: PlanSources;
  scheduledScanCadence: ScheduledScanCadence;
  /**
   * WP-37: agency margin backstop. First N active watchlists (by created_at)
   * scan at the plan's full cadence; overflow slots only on 6h-aligned runs.
   * null = every watchlist uses full cadence (Scout/Starter/Free).
   */
  priorityScanSlots: number | null;
  monitoringQueuePriority: MonitoringQueuePriority;
  metaSourceStatus: "unavailable" | "limited" | "priority";
  /**
   * Full-Site Watch rotating-batch page cap (packet 5). Free/Scout stay low;
   * Starter and Agency step up. Hard-capped by DEFAULT_PAGE_BUDGET in the
   * scanner so a catalog typo cannot fetch thousands of pages.
   */
  sitePageBudget: number;
  features: ReadonlySet<PlanFeature>;
}

// Free tier (barebones, Nish 2026-09-10): one competitor, one first check,
// one first brief, Meta only, nothing recurring. The activation scan files
// the one evidence-linked first brief; after that no scan is scheduled and no
// digest is generated (monitoring-fanout skips free after firstScanQuotaReserved;
// planAllowsDigestCadence returns false for first_only). No Collections, no
// exports, no API/MCP, no team. The email lane rides the first brief.
const FREE_FEATURES: PlanFeature[] = [
  "weekly_digest",
  "email_delivery",
  // Epic #3171 / #3179: Free tracks ONE self brand. The presence-eMail lane
  // stays off (no presence_digest_alerts) — briefs: first_only, nothing
  // recurring on Free. presence_social_connect is what lets the FREE
  // self-brand attach its ONE (query-type) mention source; the count cap is
  // PRESENCE_LIMITS.free.maxSocialSourcesPerEntity = 1.
  "presence_self_tracking",
  "presence_social_connect",
];

const SCOUT_FEATURES: PlanFeature[] = [
  "competitor_research",
  "weekly_digest",
  "email_delivery",
  "presence_competitor_tracking",
  "presence_website_sources",
  "presence_digest_alerts",
  "api_access",
  "mcp_read_access",
];

const STARTER_FEATURES: PlanFeature[] = [
  ...SCOUT_FEATURES,
  "daily_digest",
  "high_priority_alerts",
  "landing_page_evidence",
  "slack_delivery",
  "teams_delivery",
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
  "api_access",
  "mcp_read_access",
  "api_write_access",
];

const AGENCY_FEATURES: PlanFeature[] = [
  ...STARTER_FEATURES,
  "client_reports",
  "pdf_reports",
  "agency_branding",
  "api_access",
  "api_write_access",
  "mcp_access",
  "mcp_read_access",
  "mcp_account_actions",
  "team_workspace",
];

const ENTITLEMENTS: Record<PlanFamily, PlanEntitlements> = {
  free: {
    planFamily: "free",
    // Free tier (barebones): one watchlist scanned once on creation (the
    // activation scan) which files the one evidence-linked first brief. No
    // recurring scheduled scans (monitoring-fanout skips free after
    // firstScanQuotaReserved) and no recurring digests (briefs: first_only).
    // No Collections, no exports, no API/MCP, no team. The email lane rides
    // the first brief.
    watchlists: 1,
    collections: 0,
    includedEvidenceChecksPerMonth: 1,
    workspaceSeats: 1,
    digestCadence: "weekly",
    briefs: "first_only",
    sources: ["meta"],
    scheduledScanCadence: "weekly",
    priorityScanSlots: null,
    monitoringQueuePriority: 2,
    metaSourceStatus: "unavailable",
    sitePageBudget: 5,
    features: new Set(FREE_FEATURES),
  },
  scout: {
    planFamily: "scout",
    watchlists: 3,
    collections: 10,
    includedEvidenceChecksPerMonth: 50,
    workspaceSeats: 1,
    digestCadence: "weekly",
    briefs: "recurring",
    sources: "all",
    scheduledScanCadence: "every_6h",
    priorityScanSlots: null,
    monitoringQueuePriority: 2,
    metaSourceStatus: "limited",
    sitePageBudget: 10,
    features: new Set(SCOUT_FEATURES),
  },
  starter: {
    planFamily: "starter",
    watchlists: 10,
    collections: 25,
    includedEvidenceChecksPerMonth: 250,
    workspaceSeats: 1,
    digestCadence: "daily_and_weekly",
    briefs: "recurring",
    sources: "all",
    scheduledScanCadence: "every_3h",
    priorityScanSlots: null,
    monitoringQueuePriority: 1,
    metaSourceStatus: "limited",
    sitePageBudget: 25,
    features: new Set(STARTER_FEATURES),
  },
  agency: {
    planFamily: "agency",
    watchlists: 75,
    collections: 250,
    includedEvidenceChecksPerMonth: 2500,
    workspaceSeats: 3,
    digestCadence: "daily_and_weekly",
    briefs: "recurring",
    sources: "all",
    scheduledScanCadence: "every_3h",
    // First 25 at 3h; watchlists 26–75 only on 6h-aligned cron slots.
    priorityScanSlots: 25,
    monitoringQueuePriority: 0,
    metaSourceStatus: "priority",
    sitePageBudget: 50,
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

/** Full-Site Watch page budget for this plan. Never reads DEFAULT_PAGE_BUDGET. */
export function getSitePageBudget(planFamily: PlanFamily): number {
  return getPlanEntitlements(planFamily).sitePageBudget;
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
  const entitlements = getPlanEntitlements(planFamily);
  // first_only (Free) files the activation-scan first brief once and then
  // stops — the digest cron must never file a second brief. The first-brief
  // path does not consult this function, so the one included brief still
  // files.
  if (entitlements.briefs === "first_only") return false;
  const policy = entitlements.digestCadence;
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
