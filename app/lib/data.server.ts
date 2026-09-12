/**
 * Named barrel for D1 persistence — lazy facade.
 *
 * Product importers and Vitest mocks keep using `~/lib/data.server` (the
 * mock surface is unchanged), but this module no longer statically pulls the
 * heavy D1 leaves. Sync helpers and the one overloaded export are re-exported
 * statically from their (small) defining leaves; every async D1 function is a
 * forwarder that `await import()`s its defining leaf on first call.
 *
 * Why: `~/lib/data.server` is statically imported by hot modules and
 * dynamically imported by dozens of loaders. When this file re-exported the
 * leaves statically, the whole leaf closure (~342 kB) sat in the cold-start
 * graph and every `await import("~/lib/data.server")` bought nothing
 * (INEFFECTIVE_DYNAMIC_IMPORT). With the facade, the leaves load on first
 * data access instead.
 *
 * Rules (enforced by tests/data-barrel-lazy-facade.test.ts):
 * - leaves must not import this barrel (cycle);
 * - no static value re-export from a heavy leaf — add sync helpers to
 *   `~/lib/data/helpers.server` or re-export them from their defining leaf;
 * - every async export stays a forwarder so the deferral holds.
 */

// ── Static: sync helpers and tiny leaves (cold-start floor) ──────────────
export {
  nowIso,
  createId,
} from "~/lib/data/helpers.server";

export {
  buildCapacitySkipIdempotencyKey,
  isSoftScanFailure,
  countLeadingFailures,
} from "~/lib/data/watchlist-runs.server";


export {
  legacyWatchEventImportanceScore,
} from "~/lib/data/watch-events.server";

export {
  DODO_WEBHOOK_PROCESSING_LEASE_MS,
} from "~/lib/data/billing-webhook-ledger.server";

export {
  DODO_PLAN_CHECKOUT_LOCK_MINUTES,
  DODO_SUBSCRIPTION_PLAN_CHANGE_LOCK_MINUTES,
  DODO_SUBSCRIPTION_PLAN_CHANGE_PENDING_STATUS,
  DODO_SUBSCRIPTION_PLAN_CHANGE_SCHEDULED_STATUS,
  isDodoSubscriptionPlanChangeStatus,
  isBlockingDodoSubscriptionPlanChangeStatus,
} from "~/lib/data/billing-checkout.server";

export {
  isDodoSubscriptionPlanChangeReconciliationDue,
} from "~/lib/data/billing-plan-change-reconciliation.server";

export {
  partialRefundLedgerKey,
  partialRefundReconciliationKey,
} from "~/lib/data/billing-refund-reconciliation.server";

export {
  legacyWorkspaceDeliveryDefaults,
} from "~/lib/data/delivery-records-workspace.server";

export {
  buildBillingLifecycleOutboxStatement,
} from "~/lib/data/delivery-records-attempts.server";

export {
  DIGEST_ITEM_SET_PROVENANCE,
  claimDigestStrategyGenerationLease,
  completeDigestStrategyGeneration,
  createDigestRun,
  clearDigestItems,
  addDigestItem,
  upsertDigestDelivery,
  updateDigestRunSummary,
  listDigests,
  getDigest,
  getDigestByPeriod,
  getLatestDigestRunSummaryForWatchlist,
  listRetryableDigestRuns,
  enqueueDigestScheduleJobs,
  listDigestScheduleJobTimezones,
  listRetryableDigestScheduleJobs,
  exhaustStaleMaxAttemptDigestScheduleJobs,
  claimDigestScheduleJob,
  completeDigestScheduleJob,
  failDigestScheduleJob,
  listExhaustedDigestScheduleJobs,
  listDigestScheduleJobsAwaitingAlert,
  claimDigestScheduleJobExhaustionAlert,
  settleDigestScheduleJobExhaustionAlert,
} from "~/lib/data/digests.server";

export {
  createDigestScheduleJobRequeueKey,
} from "~/lib/data/digest-schedule-recovery.server";

export {
  SHARE_LINK_DEFAULT_TTL_DAYS,
} from "~/lib/data/shares.server";

export {
  BILLING_EMAIL_EVIDENCE_CLASSIFICATIONS,
  INSTANT_SLACK_EVIDENCE_CLASSIFICATIONS,
  INSTANT_WHATSAPP_EVIDENCE_CLASSIFICATIONS,
  createBillingEmailReconciliationKey,
  createDigestEmailReconciliationKey,
  createInstantChannelReconciliationKey,
  createInstantEmailReconciliationKey,
} from "~/lib/data/operator-delivery-reconciliation.server";

export {
  WORKSPACE_BRAND_NAME_MAX_LENGTH,
  WORKSPACE_BRAND_WEBSITE_MAX_LENGTH,
  WORKSPACE_BRAND_LOGO_MAX_LENGTH,
  normalizeWorkspaceBrandLogo,
} from "~/lib/data/workspace-branding.server";

export {
  personalOrgIdForUser,
} from "~/lib/data/org.server";

// ── Types (erased at build; zero runtime cost) ───────────────────────────
export type {
  CreateWatchlistInput,
  CreateWatchlistWithinLimitResult,
  FirstScanRunState,
  BeginWebsiteSiteScanInput,
  UpsertWebsiteSiteScanPageInput,
  UpsertWebsitePageObservationInput,
  FinalizeWebsiteSiteScanInput,
  WebsiteScanLease,
  WebsiteSiteScanBaseline,
  ObservationRow,
} from "~/lib/data/watchlists.server";

export type {
  DodoPlanChangeReconciliationInput,
  DodoPlanChangeReconciliationOutcome,
  DodoWebhookLedgerOutcome,
  DodoWebhookLedgerFinalize,
  DodoWebhookProcessingClaim,
  UserPlanBillingInfo,
} from "~/lib/data/billing.server";

export type {
  PartialRefundReconciliationDecision,
  PendingPartialRefundReconciliation,
} from "~/lib/data/billing-refund-reconciliation.server";

export type {
  BillingLifecycleEmailOutboxSpec,
  BillingLifecycleOutboxGate,
  InstantDeliveryAttemptClaimInput,
} from "~/lib/data/delivery-records.server";

export type {
  BillingLifecycleEmailReconciliationInput,
  BillingLifecycleEmailReconciliationResult,
  BillingLifecycleReconciliationCandidate,
  BillingLifecycleReconciliationOutcome,
} from "~/lib/data/billing-lifecycle-reconciliation.server";

export type {
  LaunchCanaryCleanupInput,
  LaunchCanaryCleanupResult,
} from "~/lib/data/launch-canary-cleanup.server";

export type {
  DigestScheduleJob,
} from "~/lib/data/digests.server";

export type {
  CreateCollectionWithinLimitResult,
} from "~/lib/data/collections.server";

export type {
  BillingEmailEvidenceClassification,
  InstantDeliveryChannel,
  InstantDeliveryEvidenceClassification,
} from "~/lib/data/operator-delivery-reconciliation.server";

export type {
  OperatorRiskSummary,
  WeeklyBusinessSummary,
} from "~/lib/data/workspace.server";

export type {
  OrgRecord,
} from "~/lib/data/org.server";

// ── Lazy forwarders: heavy D1 leaves load on first call ──────────────────
export const listAdsByIds: typeof import("~/lib/ad-persistence.server").listAdsByIds = (
  ...args: Parameters<typeof import("~/lib/ad-persistence.server").listAdsByIds>
) => import("~/lib/ad-persistence.server").then((m) => m.listAdsByIds(...args));

export const replaceAnalysisFields: typeof import("~/lib/ad-persistence.server").replaceAnalysisFields = (
  ...args: Parameters<typeof import("~/lib/ad-persistence.server").replaceAnalysisFields>
) => import("~/lib/ad-persistence.server").then((m) => m.replaceAnalysisFields(...args));

export const hydrateAdsWithPersistedCreatives: typeof import("~/lib/data/ads.server").hydrateAdsWithPersistedCreatives = (
  ...args: Parameters<typeof import("~/lib/data/ads.server").hydrateAdsWithPersistedCreatives>
) => import("~/lib/data/ads.server").then((m) => m.hydrateAdsWithPersistedCreatives(...args));

export const upsertAd: typeof import("~/lib/data/ads.server").upsertAd = (
  ...args: Parameters<typeof import("~/lib/data/ads.server").upsertAd>
) => import("~/lib/data/ads.server").then((m) => m.upsertAd(...args));

export const createLandingPageSnapshot: typeof import("~/lib/data/ads.server").createLandingPageSnapshot = (
  ...args: Parameters<typeof import("~/lib/data/ads.server").createLandingPageSnapshot>
) => import("~/lib/data/ads.server").then((m) => m.createLandingPageSnapshot(...args));

export const upsertDiscoveryCacheEntry: typeof import("~/lib/data/ads.server").upsertDiscoveryCacheEntry = (
  ...args: Parameters<typeof import("~/lib/data/ads.server").upsertDiscoveryCacheEntry>
) => import("~/lib/data/ads.server").then((m) => m.upsertDiscoveryCacheEntry(...args));

export const getDiscoveryCacheEntry: typeof import("~/lib/data/ads.server").getDiscoveryCacheEntry = (
  ...args: Parameters<typeof import("~/lib/data/ads.server").getDiscoveryCacheEntry>
) => import("~/lib/data/ads.server").then((m) => m.getDiscoveryCacheEntry(...args));

export const createDiscoveryFetchLog: typeof import("~/lib/data/ads.server").createDiscoveryFetchLog = (
  ...args: Parameters<typeof import("~/lib/data/ads.server").createDiscoveryFetchLog>
) => import("~/lib/data/ads.server").then((m) => m.createDiscoveryFetchLog(...args));

export const upsertDiscoveryProviderState: typeof import("~/lib/data/ads.server").upsertDiscoveryProviderState = (
  ...args: Parameters<typeof import("~/lib/data/ads.server").upsertDiscoveryProviderState>
) => import("~/lib/data/ads.server").then((m) => m.upsertDiscoveryProviderState(...args));

export const getDiscoveryProviderState: typeof import("~/lib/data/ads.server").getDiscoveryProviderState = (
  ...args: Parameters<typeof import("~/lib/data/ads.server").getDiscoveryProviderState>
) => import("~/lib/data/ads.server").then((m) => m.getDiscoveryProviderState(...args));

export const listWatchlistsPage: typeof import("~/lib/data/watchlists-core.server").listWatchlistsPage = (
  ...args: Parameters<typeof import("~/lib/data/watchlists-core.server").listWatchlistsPage>
) => import("~/lib/data/watchlists-core.server").then((m) => m.listWatchlistsPage(...args));

export const listWatchlists: typeof import("~/lib/data/watchlists-core.server").listWatchlists = (
  ...args: Parameters<typeof import("~/lib/data/watchlists-core.server").listWatchlists>
) => import("~/lib/data/watchlists-core.server").then((m) => m.listWatchlists(...args));

export const listActiveWatchlistsPage: typeof import("~/lib/data/watchlists-core.server").listActiveWatchlistsPage = (
  ...args: Parameters<typeof import("~/lib/data/watchlists-core.server").listActiveWatchlistsPage>
) => import("~/lib/data/watchlists-core.server").then((m) => m.listActiveWatchlistsPage(...args));

export const listActiveWatchlists: typeof import("~/lib/data/watchlists-core.server").listActiveWatchlists = (
  ...args: Parameters<typeof import("~/lib/data/watchlists-core.server").listActiveWatchlists>
) => import("~/lib/data/watchlists-core.server").then((m) => m.listActiveWatchlists(...args));

export const getWatchlist: typeof import("~/lib/data/watchlists-core.server").getWatchlist = (
  ...args: Parameters<typeof import("~/lib/data/watchlists-core.server").getWatchlist>
) => import("~/lib/data/watchlists-core.server").then((m) => m.getWatchlist(...args));

export const createWatchlistWithinLimit: typeof import("~/lib/data/watchlists-core.server").createWatchlistWithinLimit = (
  ...args: Parameters<typeof import("~/lib/data/watchlists-core.server").createWatchlistWithinLimit>
) => import("~/lib/data/watchlists-core.server").then((m) => m.createWatchlistWithinLimit(...args));

export const createWatchlist: typeof import("~/lib/data/watchlists-core.server").createWatchlist = (
  ...args: Parameters<typeof import("~/lib/data/watchlists-core.server").createWatchlist>
) => import("~/lib/data/watchlists-core.server").then((m) => m.createWatchlist(...args));

export const deleteUnscannedWatchlistCreatedByFailedAgentAction: typeof import("~/lib/data/watchlists-core.server").deleteUnscannedWatchlistCreatedByFailedAgentAction = (
  ...args: Parameters<typeof import("~/lib/data/watchlists-core.server").deleteUnscannedWatchlistCreatedByFailedAgentAction>
) => import("~/lib/data/watchlists-core.server").then((m) => m.deleteUnscannedWatchlistCreatedByFailedAgentAction(...args));

export const updateWatchlist: typeof import("~/lib/data/watchlists-core.server").updateWatchlist = (
  ...args: Parameters<typeof import("~/lib/data/watchlists-core.server").updateWatchlist>
) => import("~/lib/data/watchlists-core.server").then((m) => m.updateWatchlist(...args));

export const setWatchlistActive: typeof import("~/lib/data/watchlists-core.server").setWatchlistActive = (
  ...args: Parameters<typeof import("~/lib/data/watchlists-core.server").setWatchlistActive>
) => import("~/lib/data/watchlists-core.server").then((m) => m.setWatchlistActive(...args));

export const listWebMentionTargets: typeof import("~/lib/data/watchlist-web-mentions.server").listWebMentionTargets = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-web-mentions.server").listWebMentionTargets>
) => import("~/lib/data/watchlist-web-mentions.server").then((m) => m.listWebMentionTargets(...args));

export const listWebMentionObservations: typeof import("~/lib/data/watchlist-web-mentions.server").listWebMentionObservations = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-web-mentions.server").listWebMentionObservations>
) => import("~/lib/data/watchlist-web-mentions.server").then((m) => m.listWebMentionObservations(...args));

export const syncWebMentionTargetsForUser: typeof import("~/lib/data/watchlist-web-mentions.server").syncWebMentionTargetsForUser = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-web-mentions.server").syncWebMentionTargetsForUser>
) => import("~/lib/data/watchlist-web-mentions.server").then((m) => m.syncWebMentionTargetsForUser(...args));

export const deactivateWatchlistsBeyondPlanLimit: typeof import("~/lib/data/watchlist-plan-reconcile.server").deactivateWatchlistsBeyondPlanLimit = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-plan-reconcile.server").deactivateWatchlistsBeyondPlanLimit>
) => import("~/lib/data/watchlist-plan-reconcile.server").then((m) => m.deactivateWatchlistsBeyondPlanLimit(...args));

export const reactivateWatchlistsUpToPlanLimit: typeof import("~/lib/data/watchlist-plan-reconcile.server").reactivateWatchlistsUpToPlanLimit = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-plan-reconcile.server").reactivateWatchlistsUpToPlanLimit>
) => import("~/lib/data/watchlist-plan-reconcile.server").then((m) => m.reactivateWatchlistsUpToPlanLimit(...args));

export const hasInFlightWatchlistRun: typeof import("~/lib/data/watchlist-runs.server").hasInFlightWatchlistRun = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-runs.server").hasInFlightWatchlistRun>
) => import("~/lib/data/watchlist-runs.server").then((m) => m.hasInFlightWatchlistRun(...args));

export const listWatchlistRunPairsForEventIds: typeof import("~/lib/data/watchlist-runs.server").listWatchlistRunPairsForEventIds = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-runs.server").listWatchlistRunPairsForEventIds>
) => import("~/lib/data/watchlist-runs.server").then((m) => m.listWatchlistRunPairsForEventIds(...args));

export const listFirstScanRunStates: typeof import("~/lib/data/watchlist-runs.server").listFirstScanRunStates = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-runs.server").listFirstScanRunStates>
) => import("~/lib/data/watchlist-runs.server").then((m) => m.listFirstScanRunStates(...args));

export const createWatchlistRun: typeof import("~/lib/data/watchlist-runs.server").createWatchlistRun = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-runs.server").createWatchlistRun>
) => import("~/lib/data/watchlist-runs.server").then((m) => m.createWatchlistRun(...args));

export const finishWatchlistRun: typeof import("~/lib/data/watchlist-runs.server").finishWatchlistRun = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-runs.server").finishWatchlistRun>
) => import("~/lib/data/watchlist-runs.server").then((m) => m.finishWatchlistRun(...args));

export const getRecentSuccessfulRuns: typeof import("~/lib/data/watchlist-runs.server").getRecentSuccessfulRuns = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-runs.server").getRecentSuccessfulRuns>
) => import("~/lib/data/watchlist-runs.server").then((m) => m.getRecentSuccessfulRuns(...args));

export const recordWatchlistCapacitySkip: typeof import("~/lib/data/watchlist-runs.server").recordWatchlistCapacitySkip = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-runs.server").recordWatchlistCapacitySkip>
) => import("~/lib/data/watchlist-runs.server").then((m) => m.recordWatchlistCapacitySkip(...args));

export const listWatchlistRuns: typeof import("~/lib/data/watchlist-runs.server").listWatchlistRuns = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-runs.server").listWatchlistRuns>
) => import("~/lib/data/watchlist-runs.server").then((m) => m.listWatchlistRuns(...args));

export const touchWatchlistScanned: typeof import("~/lib/data/watchlist-runs.server").touchWatchlistScanned = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-runs.server").touchWatchlistScanned>
) => import("~/lib/data/watchlist-runs.server").then((m) => m.touchWatchlistScanned(...args));

export const getSuccessfulRunStatsForUserBetween: typeof import("~/lib/data/watchlist-runs.server").getSuccessfulRunStatsForUserBetween = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-runs.server").getSuccessfulRunStatsForUserBetween>
) => import("~/lib/data/watchlist-runs.server").then((m) => m.getSuccessfulRunStatsForUserBetween(...args));

export const countWatchlistRunsForUserSince: typeof import("~/lib/data/watchlist-runs.server").countWatchlistRunsForUserSince = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-runs.server").countWatchlistRunsForUserSince>
) => import("~/lib/data/watchlist-runs.server").then((m) => m.countWatchlistRunsForUserSince(...args));

export const createAdObservation: typeof import("~/lib/data/watchlist-runs.server").createAdObservation = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-runs.server").createAdObservation>
) => import("~/lib/data/watchlist-runs.server").then((m) => m.createAdObservation(...args));

export const listObservationsForRunPage: typeof import("~/lib/data/watchlist-runs.server").listObservationsForRunPage = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-runs.server").listObservationsForRunPage>
) => import("~/lib/data/watchlist-runs.server").then((m) => m.listObservationsForRunPage(...args));

export const listObservationsForRun: typeof import("~/lib/data/watchlist-runs.server").listObservationsForRun = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-runs.server").listObservationsForRun>
) => import("~/lib/data/watchlist-runs.server").then((m) => m.listObservationsForRun(...args));

export const listWatchEvents: typeof import("~/lib/data/watch-events.server").listWatchEvents = (
  ...args: Parameters<typeof import("~/lib/data/watch-events.server").listWatchEvents>
) => import("~/lib/data/watch-events.server").then((m) => m.listWatchEvents(...args));

export const listWatchEventsByIds: typeof import("~/lib/data/watch-events.server").listWatchEventsByIds = (
  ...args: Parameters<typeof import("~/lib/data/watch-events.server").listWatchEventsByIds>
) => import("~/lib/data/watch-events.server").then((m) => m.listWatchEventsByIds(...args));

export const listEventCandidates: typeof import("~/lib/data/watch-events.server").listEventCandidates = (
  ...args: Parameters<typeof import("~/lib/data/watch-events.server").listEventCandidates>
) => import("~/lib/data/watch-events.server").then((m) => m.listEventCandidates(...args));

export const listWatchEventsBetween: typeof import("~/lib/data/watch-events.server").listWatchEventsBetween = (
  ...args: Parameters<typeof import("~/lib/data/watch-events.server").listWatchEventsBetween>
) => import("~/lib/data/watch-events.server").then((m) => m.listWatchEventsBetween(...args));

export const createWatchEvent: typeof import("~/lib/data/watch-events.server").createWatchEvent = (
  ...args: Parameters<typeof import("~/lib/data/watch-events.server").createWatchEvent>
) => import("~/lib/data/watch-events.server").then((m) => m.createWatchEvent(...args));

export const createEventCandidate: typeof import("~/lib/data/watch-events.server").createEventCandidate = (
  ...args: Parameters<typeof import("~/lib/data/watch-events.server").createEventCandidate>
) => import("~/lib/data/watch-events.server").then((m) => m.createEventCandidate(...args));

export const listRecentWorkspaceWatchEvents: typeof import("~/lib/data/watch-events.server").listRecentWorkspaceWatchEvents = (
  ...args: Parameters<typeof import("~/lib/data/watch-events.server").listRecentWorkspaceWatchEvents>
) => import("~/lib/data/watch-events.server").then((m) => m.listRecentWorkspaceWatchEvents(...args));

export const listWatchEventsPage: typeof import("~/lib/data/watch-events.server").listWatchEventsPage = (
  ...args: Parameters<typeof import("~/lib/data/watch-events.server").listWatchEventsPage>
) => import("~/lib/data/watch-events.server").then((m) => m.listWatchEventsPage(...args));

export const listWatchEventsForRun: typeof import("~/lib/data/watch-events.server").listWatchEventsForRun = (
  ...args: Parameters<typeof import("~/lib/data/watch-events.server").listWatchEventsForRun>
) => import("~/lib/data/watch-events.server").then((m) => m.listWatchEventsForRun(...args));

export const getProofTargetByIdentity: typeof import("~/lib/data/watchlist-proof.server").getProofTargetByIdentity = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-proof.server").getProofTargetByIdentity>
) => import("~/lib/data/watchlist-proof.server").then((m) => m.getProofTargetByIdentity(...args));

export const upsertProofTarget: typeof import("~/lib/data/watchlist-proof.server").upsertProofTarget = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-proof.server").upsertProofTarget>
) => import("~/lib/data/watchlist-proof.server").then((m) => m.upsertProofTarget(...args));

export const listProofCapturesForTarget: typeof import("~/lib/data/watchlist-proof.server").listProofCapturesForTarget = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-proof.server").listProofCapturesForTarget>
) => import("~/lib/data/watchlist-proof.server").then((m) => m.listProofCapturesForTarget(...args));

export const listProofCapturesForTargets: typeof import("~/lib/data/watchlist-proof.server").listProofCapturesForTargets = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-proof.server").listProofCapturesForTargets>
) => import("~/lib/data/watchlist-proof.server").then((m) => m.listProofCapturesForTargets(...args));

export const listProofCapturesByIds: typeof import("~/lib/data/watchlist-proof.server").listProofCapturesByIds = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-proof.server").listProofCapturesByIds>
) => import("~/lib/data/watchlist-proof.server").then((m) => m.listProofCapturesByIds(...args));

export const listProofCapturePairsForEventIds: typeof import("~/lib/data/watchlist-proof.server").listProofCapturePairsForEventIds = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-proof.server").listProofCapturePairsForEventIds>
) => import("~/lib/data/watchlist-proof.server").then((m) => m.listProofCapturePairsForEventIds(...args));

export const listSuccessfulProofCapturesForAd: typeof import("~/lib/data/watchlist-proof.server").listSuccessfulProofCapturesForAd = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-proof.server").listSuccessfulProofCapturesForAd>
) => import("~/lib/data/watchlist-proof.server").then((m) => m.listSuccessfulProofCapturesForAd(...args));

export const listLastSuccessfulProofCapturesForAds: typeof import("~/lib/data/watchlist-proof.server").listLastSuccessfulProofCapturesForAds = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-proof.server").listLastSuccessfulProofCapturesForAds>
) => import("~/lib/data/watchlist-proof.server").then((m) => m.listLastSuccessfulProofCapturesForAds(...args));

export const listRecentProofCapturesForWatchlist: typeof import("~/lib/data/watchlist-proof.server").listRecentProofCapturesForWatchlist = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-proof.server").listRecentProofCapturesForWatchlist>
) => import("~/lib/data/watchlist-proof.server").then((m) => m.listRecentProofCapturesForWatchlist(...args));

export const countProofCapturesForWatchlistSince: typeof import("~/lib/data/watchlist-proof.server").countProofCapturesForWatchlistSince = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-proof.server").countProofCapturesForWatchlistSince>
) => import("~/lib/data/watchlist-proof.server").then((m) => m.countProofCapturesForWatchlistSince(...args));

export const countProofCapturesForWorkspaceSince: typeof import("~/lib/data/watchlist-proof.server").countProofCapturesForWorkspaceSince = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-proof.server").countProofCapturesForWorkspaceSince>
) => import("~/lib/data/watchlist-proof.server").then((m) => m.countProofCapturesForWorkspaceSince(...args));

export const countRecentSucceededProofScreenshotShare: typeof import("~/lib/data/watchlist-proof.server").countRecentSucceededProofScreenshotShare = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-proof.server").countRecentSucceededProofScreenshotShare>
) => import("~/lib/data/watchlist-proof.server").then((m) => m.countRecentSucceededProofScreenshotShare(...args));

export const getSuccessfulProofCaptureStatsForUser: typeof import("~/lib/data/watchlist-proof.server").getSuccessfulProofCaptureStatsForUser = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-proof.server").getSuccessfulProofCaptureStatsForUser>
) => import("~/lib/data/watchlist-proof.server").then((m) => m.getSuccessfulProofCaptureStatsForUser(...args));

export const listRecentWorkspaceProofCaptures: typeof import("~/lib/data/watchlist-proof.server").listRecentWorkspaceProofCaptures = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-proof.server").listRecentWorkspaceProofCaptures>
) => import("~/lib/data/watchlist-proof.server").then((m) => m.listRecentWorkspaceProofCaptures(...args));

export const createProofCapture: typeof import("~/lib/data/watchlist-proof.server").createProofCapture = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-proof.server").createProofCapture>
) => import("~/lib/data/watchlist-proof.server").then((m) => m.createProofCapture(...args));

export const getWatchlistDeliveryConfig: typeof import("~/lib/data/watchlist-delivery-config.server").getWatchlistDeliveryConfig = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-delivery-config.server").getWatchlistDeliveryConfig>
) => import("~/lib/data/watchlist-delivery-config.server").then((m) => m.getWatchlistDeliveryConfig(...args));

export const upsertWatchlistDeliveryConfig: typeof import("~/lib/data/watchlist-delivery-config.server").upsertWatchlistDeliveryConfig = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-delivery-config.server").upsertWatchlistDeliveryConfig>
) => import("~/lib/data/watchlist-delivery-config.server").then((m) => m.upsertWatchlistDeliveryConfig(...args));

export const beginWebsiteSiteScan: typeof import("~/lib/data/watchlist-site-pages.server").beginWebsiteSiteScan = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-site-pages.server").beginWebsiteSiteScan>
) => import("~/lib/data/watchlist-site-pages.server").then((m) => m.beginWebsiteSiteScan(...args));

export const upsertWebsiteSiteScanPage: typeof import("~/lib/data/watchlist-site-pages.server").upsertWebsiteSiteScanPage = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-site-pages.server").upsertWebsiteSiteScanPage>
) => import("~/lib/data/watchlist-site-pages.server").then((m) => m.upsertWebsiteSiteScanPage(...args));

export const upsertWebsitePageObservation: typeof import("~/lib/data/watchlist-site-pages.server").upsertWebsitePageObservation = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-site-pages.server").upsertWebsitePageObservation>
) => import("~/lib/data/watchlist-site-pages.server").then((m) => m.upsertWebsitePageObservation(...args));

export const finalizeWebsiteSiteScan: typeof import("~/lib/data/watchlist-site-pages.server").finalizeWebsiteSiteScan = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-site-pages.server").finalizeWebsiteSiteScan>
) => import("~/lib/data/watchlist-site-pages.server").then((m) => m.finalizeWebsiteSiteScan(...args));

export const listWebsiteSiteScanPagesForRun: typeof import("~/lib/data/watchlist-site-pages.server").listWebsiteSiteScanPagesForRun = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-site-pages.server").listWebsiteSiteScanPagesForRun>
) => import("~/lib/data/watchlist-site-pages.server").then((m) => m.listWebsiteSiteScanPagesForRun(...args));

export const listWebsitePageObservationsForRun: typeof import("~/lib/data/watchlist-site-pages.server").listWebsitePageObservationsForRun = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-site-pages.server").listWebsitePageObservationsForRun>
) => import("~/lib/data/watchlist-site-pages.server").then((m) => m.listWebsitePageObservationsForRun(...args));

export const getLatestWebsiteSiteScanForWatchlist: typeof import("~/lib/data/watchlist-site-pages.server").getLatestWebsiteSiteScanForWatchlist = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-site-pages.server").getLatestWebsiteSiteScanForWatchlist>
) => import("~/lib/data/watchlist-site-pages.server").then((m) => m.getLatestWebsiteSiteScanForWatchlist(...args));

export const getLatestCompleteWebsiteScanBaseline: typeof import("~/lib/data/watchlist-site-pages.server").getLatestCompleteWebsiteScanBaseline = (
  ...args: Parameters<typeof import("~/lib/data/watchlist-site-pages.server").getLatestCompleteWebsiteScanBaseline>
) => import("~/lib/data/watchlist-site-pages.server").then((m) => m.getLatestCompleteWebsiteScanBaseline(...args));

export const grantProofUsageCredit: typeof import("~/lib/data/billing-credits.server").grantProofUsageCredit = (
  ...args: Parameters<typeof import("~/lib/data/billing-credits.server").grantProofUsageCredit>
) => import("~/lib/data/billing-credits.server").then((m) => m.grantProofUsageCredit(...args));

export const applyDodoProofCreditGrantWithLedger: typeof import("~/lib/data/billing-credits.server").applyDodoProofCreditGrantWithLedger = (
  ...args: Parameters<typeof import("~/lib/data/billing-credits.server").applyDodoProofCreditGrantWithLedger>
) => import("~/lib/data/billing-credits.server").then((m) => m.applyDodoProofCreditGrantWithLedger(...args));

export const grantDodoPlanAccess: typeof import("~/lib/data/billing-plan.server").grantDodoPlanAccess = (
  ...args: Parameters<typeof import("~/lib/data/billing-plan.server").grantDodoPlanAccess>
) => import("~/lib/data/billing-plan.server").then((m) => m.grantDodoPlanAccess(...args));

export const revokeDodoPlanAccess: typeof import("~/lib/data/billing-plan.server").revokeDodoPlanAccess = (
  ...args: Parameters<typeof import("~/lib/data/billing-plan.server").revokeDodoPlanAccess>
) => import("~/lib/data/billing-plan.server").then((m) => m.revokeDodoPlanAccess(...args));

export const markDodoPlanPaymentIssue: typeof import("~/lib/data/billing-plan.server").markDodoPlanPaymentIssue = (
  ...args: Parameters<typeof import("~/lib/data/billing-plan.server").markDodoPlanPaymentIssue>
) => import("~/lib/data/billing-plan.server").then((m) => m.markDodoPlanPaymentIssue(...args));

export const revokeDodoAccessForRefundedPayment: typeof import("~/lib/data/billing-plan.server").revokeDodoAccessForRefundedPayment = (
  ...args: Parameters<typeof import("~/lib/data/billing-plan.server").revokeDodoAccessForRefundedPayment>
) => import("~/lib/data/billing-plan.server").then((m) => m.revokeDodoAccessForRefundedPayment(...args));

export const getUserIdForDodoPayment: typeof import("~/lib/data/billing-plan.server").getUserIdForDodoPayment = (
  ...args: Parameters<typeof import("~/lib/data/billing-plan.server").getUserIdForDodoPayment>
) => import("~/lib/data/billing-plan.server").then((m) => m.getUserIdForDodoPayment(...args));

export const getUserIdForDodoLifecycle: typeof import("~/lib/data/billing-plan.server").getUserIdForDodoLifecycle = (
  ...args: Parameters<typeof import("~/lib/data/billing-plan.server").getUserIdForDodoLifecycle>
) => import("~/lib/data/billing-plan.server").then((m) => m.getUserIdForDodoLifecycle(...args));

export const getUserPlanBillingInfo: typeof import("~/lib/data/billing-plan.server").getUserPlanBillingInfo = (
  ...args: Parameters<typeof import("~/lib/data/billing-plan.server").getUserPlanBillingInfo>
) => import("~/lib/data/billing-plan.server").then((m) => m.getUserPlanBillingInfo(...args));

export const applyDodoCancellationReversalWithLedger: typeof import("~/lib/data/billing-reconcile.server").applyDodoCancellationReversalWithLedger = (
  ...args: Parameters<typeof import("~/lib/data/billing-reconcile.server").applyDodoCancellationReversalWithLedger>
) => import("~/lib/data/billing-reconcile.server").then((m) => m.applyDodoCancellationReversalWithLedger(...args));

export const applyDodoPlanGrantWithWatchlistReconcile: typeof import("~/lib/data/billing-reconcile.server").applyDodoPlanGrantWithWatchlistReconcile = (
  ...args: Parameters<typeof import("~/lib/data/billing-reconcile.server").applyDodoPlanGrantWithWatchlistReconcile>
) => import("~/lib/data/billing-reconcile.server").then((m) => m.applyDodoPlanGrantWithWatchlistReconcile(...args));

export const applyDodoPlanRevokeWithWatchlistReconcile: typeof import("~/lib/data/billing-reconcile.server").applyDodoPlanRevokeWithWatchlistReconcile = (
  ...args: Parameters<typeof import("~/lib/data/billing-reconcile.server").applyDodoPlanRevokeWithWatchlistReconcile>
) => import("~/lib/data/billing-reconcile.server").then((m) => m.applyDodoPlanRevokeWithWatchlistReconcile(...args));

export const applyDodoRefundWithWatchlistReconcile: typeof import("~/lib/data/billing-reconcile.server").applyDodoRefundWithWatchlistReconcile = (
  ...args: Parameters<typeof import("~/lib/data/billing-reconcile.server").applyDodoRefundWithWatchlistReconcile>
) => import("~/lib/data/billing-reconcile.server").then((m) => m.applyDodoRefundWithWatchlistReconcile(...args));

export const applyDodoPlanPaymentIssueWithLedger: typeof import("~/lib/data/billing-reconcile.server").applyDodoPlanPaymentIssueWithLedger = (
  ...args: Parameters<typeof import("~/lib/data/billing-reconcile.server").applyDodoPlanPaymentIssueWithLedger>
) => import("~/lib/data/billing-reconcile.server").then((m) => m.applyDodoPlanPaymentIssueWithLedger(...args));

export const finalizeDodoWebhookLedgerOnly: typeof import("~/lib/data/billing-webhook-ledger.server").finalizeDodoWebhookLedgerOnly = (
  ...args: Parameters<typeof import("~/lib/data/billing-webhook-ledger.server").finalizeDodoWebhookLedgerOnly>
) => import("~/lib/data/billing-webhook-ledger.server").then((m) => m.finalizeDodoWebhookLedgerOnly(...args));

export const beginDodoWebhookEventProcessing: typeof import("~/lib/data/billing-webhook-ledger.server").beginDodoWebhookEventProcessing = (
  ...args: Parameters<typeof import("~/lib/data/billing-webhook-ledger.server").beginDodoWebhookEventProcessing>
) => import("~/lib/data/billing-webhook-ledger.server").then((m) => m.beginDodoWebhookEventProcessing(...args));

export const claimDodoWebhookEvent: typeof import("~/lib/data/billing-webhook-ledger.server").claimDodoWebhookEvent = (
  ...args: Parameters<typeof import("~/lib/data/billing-webhook-ledger.server").claimDodoWebhookEvent>
) => import("~/lib/data/billing-webhook-ledger.server").then((m) => m.claimDodoWebhookEvent(...args));

export const failDodoWebhookEventProcessing: typeof import("~/lib/data/billing-webhook-ledger.server").failDodoWebhookEventProcessing = (
  ...args: Parameters<typeof import("~/lib/data/billing-webhook-ledger.server").failDodoWebhookEventProcessing>
) => import("~/lib/data/billing-webhook-ledger.server").then((m) => m.failDodoWebhookEventProcessing(...args));

export const failDodoWebhookEventForLifecycleEmailRetry: typeof import("~/lib/data/billing-webhook-ledger.server").failDodoWebhookEventForLifecycleEmailRetry = (
  ...args: Parameters<typeof import("~/lib/data/billing-webhook-ledger.server").failDodoWebhookEventForLifecycleEmailRetry>
) => import("~/lib/data/billing-webhook-ledger.server").then((m) => m.failDodoWebhookEventForLifecycleEmailRetry(...args));

export const markDodoWebhookEventFinished: typeof import("~/lib/data/billing-webhook-ledger.server").markDodoWebhookEventFinished = (
  ...args: Parameters<typeof import("~/lib/data/billing-webhook-ledger.server").markDodoWebhookEventFinished>
) => import("~/lib/data/billing-webhook-ledger.server").then((m) => m.markDodoWebhookEventFinished(...args));

export const claimDodoSubscriptionPlanChange: typeof import("~/lib/data/billing-checkout.server").claimDodoSubscriptionPlanChange = (
  ...args: Parameters<typeof import("~/lib/data/billing-checkout.server").claimDodoSubscriptionPlanChange>
) => import("~/lib/data/billing-checkout.server").then((m) => m.claimDodoSubscriptionPlanChange(...args));

export const clearDodoSubscriptionPlanChangeClaim: typeof import("~/lib/data/billing-checkout.server").clearDodoSubscriptionPlanChangeClaim = (
  ...args: Parameters<typeof import("~/lib/data/billing-checkout.server").clearDodoSubscriptionPlanChangeClaim>
) => import("~/lib/data/billing-checkout.server").then((m) => m.clearDodoSubscriptionPlanChangeClaim(...args));

export const markDodoSubscriptionPlanChangeScheduled: typeof import("~/lib/data/billing-checkout.server").markDodoSubscriptionPlanChangeScheduled = (
  ...args: Parameters<typeof import("~/lib/data/billing-checkout.server").markDodoSubscriptionPlanChangeScheduled>
) => import("~/lib/data/billing-checkout.server").then((m) => m.markDodoSubscriptionPlanChangeScheduled(...args));

export const claimDodoPlanCheckout: typeof import("~/lib/data/billing-checkout.server").claimDodoPlanCheckout = (
  ...args: Parameters<typeof import("~/lib/data/billing-checkout.server").claimDodoPlanCheckout>
) => import("~/lib/data/billing-checkout.server").then((m) => m.claimDodoPlanCheckout(...args));

export const clearDodoPlanCheckout: typeof import("~/lib/data/billing-checkout.server").clearDodoPlanCheckout = (
  ...args: Parameters<typeof import("~/lib/data/billing-checkout.server").clearDodoPlanCheckout>
) => import("~/lib/data/billing-checkout.server").then((m) => m.clearDodoPlanCheckout(...args));

export const listStaleDodoSubscriptionPlanChangeClaims: typeof import("~/lib/data/billing-plan-change-reconciliation.server").listStaleDodoSubscriptionPlanChangeClaims = (
  ...args: Parameters<typeof import("~/lib/data/billing-plan-change-reconciliation.server").listStaleDodoSubscriptionPlanChangeClaims>
) => import("~/lib/data/billing-plan-change-reconciliation.server").then((m) => m.listStaleDodoSubscriptionPlanChangeClaims(...args));

export const reconcileDodoSubscriptionPlanChangeWithAudit: typeof import("~/lib/data/billing-plan-change-reconciliation.server").reconcileDodoSubscriptionPlanChangeWithAudit = (
  ...args: Parameters<typeof import("~/lib/data/billing-plan-change-reconciliation.server").reconcileDodoSubscriptionPlanChangeWithAudit>
) => import("~/lib/data/billing-plan-change-reconciliation.server").then((m) => m.reconcileDodoSubscriptionPlanChangeWithAudit(...args));

export const listPendingPartialRefundReconciliations: typeof import("~/lib/data/billing-refund-reconciliation.server").listPendingPartialRefundReconciliations = (
  ...args: Parameters<typeof import("~/lib/data/billing-refund-reconciliation.server").listPendingPartialRefundReconciliations>
) => import("~/lib/data/billing-refund-reconciliation.server").then((m) => m.listPendingPartialRefundReconciliations(...args));

export const reconcilePartialRefundWithAudit: typeof import("~/lib/data/billing-refund-reconciliation.server").reconcilePartialRefundWithAudit = (
  ...args: Parameters<typeof import("~/lib/data/billing-refund-reconciliation.server").reconcilePartialRefundWithAudit>
) => import("~/lib/data/billing-refund-reconciliation.server").then((m) => m.reconcilePartialRefundWithAudit(...args));

export const ensureNewWorkspaceDeliveryDefaults: typeof import("~/lib/data/delivery-records-workspace.server").ensureNewWorkspaceDeliveryDefaults = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-workspace.server").ensureNewWorkspaceDeliveryDefaults>
) => import("~/lib/data/delivery-records-workspace.server").then((m) => m.ensureNewWorkspaceDeliveryDefaults(...args));

export const migrateAutoProvisionedEmailTargets: typeof import("~/lib/data/delivery-records-workspace.server").migrateAutoProvisionedEmailTargets = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-workspace.server").migrateAutoProvisionedEmailTargets>
) => import("~/lib/data/delivery-records-workspace.server").then((m) => m.migrateAutoProvisionedEmailTargets(...args));

export const getWorkspaceDeliveryConfig: typeof import("~/lib/data/delivery-records-workspace.server").getWorkspaceDeliveryConfig = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-workspace.server").getWorkspaceDeliveryConfig>
) => import("~/lib/data/delivery-records-workspace.server").then((m) => m.getWorkspaceDeliveryConfig(...args));

export const upsertWorkspaceDeliveryConfig: typeof import("~/lib/data/delivery-records-workspace.server").upsertWorkspaceDeliveryConfig = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-workspace.server").upsertWorkspaceDeliveryConfig>
) => import("~/lib/data/delivery-records-workspace.server").then((m) => m.upsertWorkspaceDeliveryConfig(...args));

export const enableWorkspaceDeliveryChannel: typeof import("~/lib/data/delivery-records-workspace.server").enableWorkspaceDeliveryChannel = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-workspace.server").enableWorkspaceDeliveryChannel>
) => import("~/lib/data/delivery-records-workspace.server").then((m) => m.enableWorkspaceDeliveryChannel(...args));

export const getUserDeliveryProfile: typeof import("~/lib/data/delivery-records-workspace.server").getUserDeliveryProfile = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-workspace.server").getUserDeliveryProfile>
) => import("~/lib/data/delivery-records-workspace.server").then((m) => m.getUserDeliveryProfile(...args));

export const listRetryableInstantAttempts: typeof import("~/lib/data/delivery-records-attempts.server").listRetryableInstantAttempts = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-attempts.server").listRetryableInstantAttempts>
) => import("~/lib/data/delivery-records-attempts.server").then((m) => m.listRetryableInstantAttempts(...args));

export const listStaleBillingLifecycleEmailAttempts: typeof import("~/lib/data/delivery-records-attempts.server").listStaleBillingLifecycleEmailAttempts = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-attempts.server").listStaleBillingLifecycleEmailAttempts>
) => import("~/lib/data/delivery-records-attempts.server").then((m) => m.listStaleBillingLifecycleEmailAttempts(...args));

export const listOutstandingBillingLifecycleProviderUnknownAttempts: typeof import("~/lib/data/delivery-records-attempts.server").listOutstandingBillingLifecycleProviderUnknownAttempts = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-attempts.server").listOutstandingBillingLifecycleProviderUnknownAttempts>
) => import("~/lib/data/delivery-records-attempts.server").then((m) => m.listOutstandingBillingLifecycleProviderUnknownAttempts(...args));

export const listOutstandingDigestProviderUnknownAttempts: typeof import("~/lib/data/delivery-records-attempts.server").listOutstandingDigestProviderUnknownAttempts = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-attempts.server").listOutstandingDigestProviderUnknownAttempts>
) => import("~/lib/data/delivery-records-attempts.server").then((m) => m.listOutstandingDigestProviderUnknownAttempts(...args));

export const listOutstandingInstantProviderUnknownAttempts: typeof import("~/lib/data/delivery-records-attempts.server").listOutstandingInstantProviderUnknownAttempts = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-attempts.server").listOutstandingInstantProviderUnknownAttempts>
) => import("~/lib/data/delivery-records-attempts.server").then((m) => m.listOutstandingInstantProviderUnknownAttempts(...args));

export const listDeliveryAttempts: typeof import("~/lib/data/delivery-records-attempts.server").listDeliveryAttempts = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-attempts.server").listDeliveryAttempts>
) => import("~/lib/data/delivery-records-attempts.server").then((m) => m.listDeliveryAttempts(...args));

export const getDeliveryAttemptByIdempotencyKey: typeof import("~/lib/data/delivery-records-attempts.server").getDeliveryAttemptByIdempotencyKey = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-attempts.server").getDeliveryAttemptByIdempotencyKey>
) => import("~/lib/data/delivery-records-attempts.server").then((m) => m.getDeliveryAttemptByIdempotencyKey(...args));

export const claimInstantDeliveryAttempt: typeof import("~/lib/data/delivery-records-attempts.server").claimInstantDeliveryAttempt = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-attempts.server").claimInstantDeliveryAttempt>
) => import("~/lib/data/delivery-records-attempts.server").then((m) => m.claimInstantDeliveryAttempt(...args));

export const markInstantDeliveryDispatchStarted: typeof import("~/lib/data/delivery-records-attempts.server").markInstantDeliveryDispatchStarted = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-attempts.server").markInstantDeliveryDispatchStarted>
) => import("~/lib/data/delivery-records-attempts.server").then((m) => m.markInstantDeliveryDispatchStarted(...args));

export const reconcileDeliveryAttemptByProviderMessageId: typeof import("~/lib/data/delivery-records-attempts.server").reconcileDeliveryAttemptByProviderMessageId = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-attempts.server").reconcileDeliveryAttemptByProviderMessageId>
) => import("~/lib/data/delivery-records-attempts.server").then((m) => m.reconcileDeliveryAttemptByProviderMessageId(...args));

export const createDeliveryAttempt: typeof import("~/lib/data/delivery-records-attempts.server").createDeliveryAttempt = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-attempts.server").createDeliveryAttempt>
) => import("~/lib/data/delivery-records-attempts.server").then((m) => m.createDeliveryAttempt(...args));

export const updateDeliveryAttemptResult: typeof import("~/lib/data/delivery-records-attempts.server").updateDeliveryAttemptResult = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-attempts.server").updateDeliveryAttemptResult>
) => import("~/lib/data/delivery-records-attempts.server").then((m) => m.updateDeliveryAttemptResult(...args));

export const listDeliveryTargets: typeof import("~/lib/data/delivery-records-targets.server").listDeliveryTargets = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-targets.server").listDeliveryTargets>
) => import("~/lib/data/delivery-records-targets.server").then((m) => m.listDeliveryTargets(...args));

export const hasSuppressedEmailTargetForUserAndAddress: typeof import("~/lib/data/delivery-records-targets.server").hasSuppressedEmailTargetForUserAndAddress = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-targets.server").hasSuppressedEmailTargetForUserAndAddress>
) => import("~/lib/data/delivery-records-targets.server").then((m) => m.hasSuppressedEmailTargetForUserAndAddress(...args));

export const provisionVerifiedAccountEmailTargetIfUnsuppressed: typeof import("~/lib/data/delivery-records-targets.server").provisionVerifiedAccountEmailTargetIfUnsuppressed = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-targets.server").provisionVerifiedAccountEmailTargetIfUnsuppressed>
) => import("~/lib/data/delivery-records-targets.server").then((m) => m.provisionVerifiedAccountEmailTargetIfUnsuppressed(...args));

export const getDeliveryTargetReadinessStats: typeof import("~/lib/data/delivery-records-targets.server").getDeliveryTargetReadinessStats = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-targets.server").getDeliveryTargetReadinessStats>
) => import("~/lib/data/delivery-records-targets.server").then((m) => m.getDeliveryTargetReadinessStats(...args));

export const upsertDeliveryTarget: typeof import("~/lib/data/delivery-records-targets.server").upsertDeliveryTarget = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-targets.server").upsertDeliveryTarget>
) => import("~/lib/data/delivery-records-targets.server").then((m) => m.upsertDeliveryTarget(...args));

export const getDeliveryTargetById: typeof import("~/lib/data/delivery-records-targets.server").getDeliveryTargetById = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-targets.server").getDeliveryTargetById>
) => import("~/lib/data/delivery-records-targets.server").then((m) => m.getDeliveryTargetById(...args));

export const getDeliveryTargetByProviderIdentifier: typeof import("~/lib/data/delivery-records-targets.server").getDeliveryTargetByProviderIdentifier = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-targets.server").getDeliveryTargetByProviderIdentifier>
) => import("~/lib/data/delivery-records-targets.server").then((m) => m.getDeliveryTargetByProviderIdentifier(...args));

export const claimEmailTargetForDispatch: typeof import("~/lib/data/delivery-records-targets.server").claimEmailTargetForDispatch = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-targets.server").claimEmailTargetForDispatch>
) => import("~/lib/data/delivery-records-targets.server").then((m) => m.claimEmailTargetForDispatch(...args));

export const suppressEmailTargetsForUserAndAddress: typeof import("~/lib/data/delivery-records-targets.server").suppressEmailTargetsForUserAndAddress = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-targets.server").suppressEmailTargetsForUserAndAddress>
) => import("~/lib/data/delivery-records-targets.server").then((m) => m.suppressEmailTargetsForUserAndAddress(...args));

export const resumeEmailTargetsForUserAndAddress: typeof import("~/lib/data/delivery-records-targets.server").resumeEmailTargetsForUserAndAddress = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-targets.server").resumeEmailTargetsForUserAndAddress>
) => import("~/lib/data/delivery-records-targets.server").then((m) => m.resumeEmailTargetsForUserAndAddress(...args));

export const reconcileWhatsAppSetupTargetFromAttempt: typeof import("~/lib/data/delivery-records-targets.server").reconcileWhatsAppSetupTargetFromAttempt = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-targets.server").reconcileWhatsAppSetupTargetFromAttempt>
) => import("~/lib/data/delivery-records-targets.server").then((m) => m.reconcileWhatsAppSetupTargetFromAttempt(...args));

export const reconcileWhatsAppSetupTargetByProviderMessageId: typeof import("~/lib/data/delivery-records-targets.server").reconcileWhatsAppSetupTargetByProviderMessageId = (
  ...args: Parameters<typeof import("~/lib/data/delivery-records-targets.server").reconcileWhatsAppSetupTargetByProviderMessageId>
) => import("~/lib/data/delivery-records-targets.server").then((m) => m.reconcileWhatsAppSetupTargetByProviderMessageId(...args));

export const listBillingLifecycleReconciliationCandidates: typeof import("~/lib/data/billing-lifecycle-reconciliation.server").listBillingLifecycleReconciliationCandidates = (
  ...args: Parameters<typeof import("~/lib/data/billing-lifecycle-reconciliation.server").listBillingLifecycleReconciliationCandidates>
) => import("~/lib/data/billing-lifecycle-reconciliation.server").then((m) => m.listBillingLifecycleReconciliationCandidates(...args));

export const reconcileBillingLifecycleEmailAttempt: typeof import("~/lib/data/billing-lifecycle-reconciliation.server").reconcileBillingLifecycleEmailAttempt = (
  ...args: Parameters<typeof import("~/lib/data/billing-lifecycle-reconciliation.server").reconcileBillingLifecycleEmailAttempt>
) => import("~/lib/data/billing-lifecycle-reconciliation.server").then((m) => m.reconcileBillingLifecycleEmailAttempt(...args));

export const cleanupLaunchReadinessCanary: typeof import("~/lib/data/launch-canary-cleanup.server").cleanupLaunchReadinessCanary = (
  ...args: Parameters<typeof import("~/lib/data/launch-canary-cleanup.server").cleanupLaunchReadinessCanary>
) => import("~/lib/data/launch-canary-cleanup.server").then((m) => m.cleanupLaunchReadinessCanary(...args));

export const requeueExhaustedDigestScheduleJobWithAudit: typeof import("~/lib/data/digest-schedule-recovery.server").requeueExhaustedDigestScheduleJobWithAudit = (
  ...args: Parameters<typeof import("~/lib/data/digest-schedule-recovery.server").requeueExhaustedDigestScheduleJobWithAudit>
) => import("~/lib/data/digest-schedule-recovery.server").then((m) => m.requeueExhaustedDigestScheduleJobWithAudit(...args));

export const listCollectionsPage: typeof import("~/lib/data/collections.server").listCollectionsPage = (
  ...args: Parameters<typeof import("~/lib/data/collections.server").listCollectionsPage>
) => import("~/lib/data/collections.server").then((m) => m.listCollectionsPage(...args));

export const listCollections: typeof import("~/lib/data/collections.server").listCollections = (
  ...args: Parameters<typeof import("~/lib/data/collections.server").listCollections>
) => import("~/lib/data/collections.server").then((m) => m.listCollections(...args));

export const getCollection: typeof import("~/lib/data/collections.server").getCollection = (
  ...args: Parameters<typeof import("~/lib/data/collections.server").getCollection>
) => import("~/lib/data/collections.server").then((m) => m.getCollection(...args));

export const createCollection: typeof import("~/lib/data/collections.server").createCollection = (
  ...args: Parameters<typeof import("~/lib/data/collections.server").createCollection>
) => import("~/lib/data/collections.server").then((m) => m.createCollection(...args));

export const createCollectionWithinLimit: typeof import("~/lib/data/collections.server").createCollectionWithinLimit = (
  ...args: Parameters<typeof import("~/lib/data/collections.server").createCollectionWithinLimit>
) => import("~/lib/data/collections.server").then((m) => m.createCollectionWithinLimit(...args));

export const listCollectionItemsPage: typeof import("~/lib/data/collections.server").listCollectionItemsPage = (
  ...args: Parameters<typeof import("~/lib/data/collections.server").listCollectionItemsPage>
) => import("~/lib/data/collections.server").then((m) => m.listCollectionItemsPage(...args));

export const listCollectionItems: typeof import("~/lib/data/collections.server").listCollectionItems = (
  ...args: Parameters<typeof import("~/lib/data/collections.server").listCollectionItems>
) => import("~/lib/data/collections.server").then((m) => m.listCollectionItems(...args));

export const updateCollectionItem: typeof import("~/lib/data/collections.server").updateCollectionItem = (
  ...args: Parameters<typeof import("~/lib/data/collections.server").updateCollectionItem>
) => import("~/lib/data/collections.server").then((m) => m.updateCollectionItem(...args));

export const addAdToCollection: typeof import("~/lib/data/collections.server").addAdToCollection = (
  ...args: Parameters<typeof import("~/lib/data/collections.server").addAdToCollection>
) => import("~/lib/data/collections.server").then((m) => m.addAdToCollection(...args));

export const addExternalProofToCollection: typeof import("~/lib/data/collections.server").addExternalProofToCollection = (
  ...args: Parameters<typeof import("~/lib/data/collections.server").addExternalProofToCollection>
) => import("~/lib/data/collections.server").then((m) => m.addExternalProofToCollection(...args));

export const deleteCollection: typeof import("~/lib/data/collections.server").deleteCollection = (
  ...args: Parameters<typeof import("~/lib/data/collections.server").deleteCollection>
) => import("~/lib/data/collections.server").then((m) => m.deleteCollection(...args));

export const deleteCollectionItem: typeof import("~/lib/data/collections.server").deleteCollectionItem = (
  ...args: Parameters<typeof import("~/lib/data/collections.server").deleteCollectionItem>
) => import("~/lib/data/collections.server").then((m) => m.deleteCollectionItem(...args));

export const findAgentActionAuditByIdempotencyKey: typeof import("~/lib/data/customer-api-agent.server").findAgentActionAuditByIdempotencyKey = (
  ...args: Parameters<typeof import("~/lib/data/customer-api-agent.server").findAgentActionAuditByIdempotencyKey>
) => import("~/lib/data/customer-api-agent.server").then((m) => m.findAgentActionAuditByIdempotencyKey(...args));

export const listRecentAgentActionAudits: typeof import("~/lib/data/customer-api-agent.server").listRecentAgentActionAudits = (
  ...args: Parameters<typeof import("~/lib/data/customer-api-agent.server").listRecentAgentActionAudits>
) => import("~/lib/data/customer-api-agent.server").then((m) => m.listRecentAgentActionAudits(...args));

export const createAgentActionAudit: typeof import("~/lib/data/customer-api-agent.server").createAgentActionAudit = (
  ...args: Parameters<typeof import("~/lib/data/customer-api-agent.server").createAgentActionAudit>
) => import("~/lib/data/customer-api-agent.server").then((m) => m.createAgentActionAudit(...args));

export const claimAgentActionAudit: typeof import("~/lib/data/customer-api-agent.server").claimAgentActionAudit = (
  ...args: Parameters<typeof import("~/lib/data/customer-api-agent.server").claimAgentActionAudit>
) => import("~/lib/data/customer-api-agent.server").then((m) => m.claimAgentActionAudit(...args));

export const reclaimRetryableAgentActionAudit: typeof import("~/lib/data/customer-api-agent.server").reclaimRetryableAgentActionAudit = (
  ...args: Parameters<typeof import("~/lib/data/customer-api-agent.server").reclaimRetryableAgentActionAudit>
) => import("~/lib/data/customer-api-agent.server").then((m) => m.reclaimRetryableAgentActionAudit(...args));

export const finishAgentActionAudit: typeof import("~/lib/data/customer-api-agent.server").finishAgentActionAudit = (
  ...args: Parameters<typeof import("~/lib/data/customer-api-agent.server").finishAgentActionAudit>
) => import("~/lib/data/customer-api-agent.server").then((m) => m.finishAgentActionAudit(...args));

export const closeCounterMoveFollowUp: typeof import("~/lib/data/customer-api-agent.server").closeCounterMoveFollowUp = (
  ...args: Parameters<typeof import("~/lib/data/customer-api-agent.server").closeCounterMoveFollowUp>
) => import("~/lib/data/customer-api-agent.server").then((m) => m.closeCounterMoveFollowUp(...args));

export const upsertAgentMemory: typeof import("~/lib/data/customer-api-memory.server").upsertAgentMemory = (
  ...args: Parameters<typeof import("~/lib/data/customer-api-memory.server").upsertAgentMemory>
) => import("~/lib/data/customer-api-memory.server").then((m) => m.upsertAgentMemory(...args));

export const listAgentMemory: typeof import("~/lib/data/customer-api-memory.server").listAgentMemory = (
  ...args: Parameters<typeof import("~/lib/data/customer-api-memory.server").listAgentMemory>
) => import("~/lib/data/customer-api-memory.server").then((m) => m.listAgentMemory(...args));

export const listAgentMemoryForClientRooms: typeof import("~/lib/data/customer-api-memory.server").listAgentMemoryForClientRooms = (
  ...args: Parameters<typeof import("~/lib/data/customer-api-memory.server").listAgentMemoryForClientRooms>
) => import("~/lib/data/customer-api-memory.server").then((m) => m.listAgentMemoryForClientRooms(...args));

export const getClientRoom: typeof import("~/lib/data/customer-api-rooms.server").getClientRoom = (
  ...args: Parameters<typeof import("~/lib/data/customer-api-rooms.server").getClientRoom>
) => import("~/lib/data/customer-api-rooms.server").then((m) => m.getClientRoom(...args));

export const getClientRoomByName: typeof import("~/lib/data/customer-api-rooms.server").getClientRoomByName = (
  ...args: Parameters<typeof import("~/lib/data/customer-api-rooms.server").getClientRoomByName>
) => import("~/lib/data/customer-api-rooms.server").then((m) => m.getClientRoomByName(...args));

export const upsertClientRoom: typeof import("~/lib/data/customer-api-rooms.server").upsertClientRoom = (
  ...args: Parameters<typeof import("~/lib/data/customer-api-rooms.server").upsertClientRoom>
) => import("~/lib/data/customer-api-rooms.server").then((m) => m.upsertClientRoom(...args));

export const listClientRooms: typeof import("~/lib/data/customer-api-rooms.server").listClientRooms = (
  ...args: Parameters<typeof import("~/lib/data/customer-api-rooms.server").listClientRooms>
) => import("~/lib/data/customer-api-rooms.server").then((m) => m.listClientRooms(...args));

export const listCustomerApiKeys: typeof import("~/lib/data/customer-api-keys.server").listCustomerApiKeys = (
  ...args: Parameters<typeof import("~/lib/data/customer-api-keys.server").listCustomerApiKeys>
) => import("~/lib/data/customer-api-keys.server").then((m) => m.listCustomerApiKeys(...args));

export const insertCustomerApiKey: typeof import("~/lib/data/customer-api-keys.server").insertCustomerApiKey = (
  ...args: Parameters<typeof import("~/lib/data/customer-api-keys.server").insertCustomerApiKey>
) => import("~/lib/data/customer-api-keys.server").then((m) => m.insertCustomerApiKey(...args));

export const getActiveCustomerApiKeyByHash: typeof import("~/lib/data/customer-api-keys.server").getActiveCustomerApiKeyByHash = (
  ...args: Parameters<typeof import("~/lib/data/customer-api-keys.server").getActiveCustomerApiKeyByHash>
) => import("~/lib/data/customer-api-keys.server").then((m) => m.getActiveCustomerApiKeyByHash(...args));

export const isActiveCustomerApiKey: typeof import("~/lib/data/customer-api-keys.server").isActiveCustomerApiKey = (
  ...args: Parameters<typeof import("~/lib/data/customer-api-keys.server").isActiveCustomerApiKey>
) => import("~/lib/data/customer-api-keys.server").then((m) => m.isActiveCustomerApiKey(...args));

export const recordCustomerApiKeyUsed: typeof import("~/lib/data/customer-api-keys.server").recordCustomerApiKeyUsed = (
  ...args: Parameters<typeof import("~/lib/data/customer-api-keys.server").recordCustomerApiKeyUsed>
) => import("~/lib/data/customer-api-keys.server").then((m) => m.recordCustomerApiKeyUsed(...args));

export const revokeCustomerApiKey: typeof import("~/lib/data/customer-api-keys.server").revokeCustomerApiKey = (
  ...args: Parameters<typeof import("~/lib/data/customer-api-keys.server").revokeCustomerApiKey>
) => import("~/lib/data/customer-api-keys.server").then((m) => m.revokeCustomerApiKey(...args));

export const getCustomerMetaConnection: typeof import("~/lib/data/customer-api-keys.server").getCustomerMetaConnection = (
  ...args: Parameters<typeof import("~/lib/data/customer-api-keys.server").getCustomerMetaConnection>
) => import("~/lib/data/customer-api-keys.server").then((m) => m.getCustomerMetaConnection(...args));

export const upsertCustomerMetaConnection: typeof import("~/lib/data/customer-api-keys.server").upsertCustomerMetaConnection = (
  ...args: Parameters<typeof import("~/lib/data/customer-api-keys.server").upsertCustomerMetaConnection>
) => import("~/lib/data/customer-api-keys.server").then((m) => m.upsertCustomerMetaConnection(...args));

export const updateCustomerMetaConnectionStatus: typeof import("~/lib/data/customer-api-keys.server").updateCustomerMetaConnectionStatus = (
  ...args: Parameters<typeof import("~/lib/data/customer-api-keys.server").updateCustomerMetaConnectionStatus>
) => import("~/lib/data/customer-api-keys.server").then((m) => m.updateCustomerMetaConnectionStatus(...args));

export const deleteCustomerMetaConnection: typeof import("~/lib/data/customer-api-keys.server").deleteCustomerMetaConnection = (
  ...args: Parameters<typeof import("~/lib/data/customer-api-keys.server").deleteCustomerMetaConnection>
) => import("~/lib/data/customer-api-keys.server").then((m) => m.deleteCustomerMetaConnection(...args));

export const createShareLink: typeof import("~/lib/data/shares.server").createShareLink = (
  ...args: Parameters<typeof import("~/lib/data/shares.server").createShareLink>
) => import("~/lib/data/shares.server").then((m) => m.createShareLink(...args));

export const getShareLink: typeof import("~/lib/data/shares.server").getShareLink = (
  ...args: Parameters<typeof import("~/lib/data/shares.server").getShareLink>
) => import("~/lib/data/shares.server").then((m) => m.getShareLink(...args));

export const getShareLinkById: typeof import("~/lib/data/shares.server").getShareLinkById = (
  ...args: Parameters<typeof import("~/lib/data/shares.server").getShareLinkById>
) => import("~/lib/data/shares.server").then((m) => m.getShareLinkById(...args));

export const listActiveShareLinks: typeof import("~/lib/data/shares.server").listActiveShareLinks = (
  ...args: Parameters<typeof import("~/lib/data/shares.server").listActiveShareLinks>
) => import("~/lib/data/shares.server").then((m) => m.listActiveShareLinks(...args));

export const revokeShareLink: typeof import("~/lib/data/shares.server").revokeShareLink = (
  ...args: Parameters<typeof import("~/lib/data/shares.server").revokeShareLink>
) => import("~/lib/data/shares.server").then((m) => m.revokeShareLink(...args));

export const createSupportCase: typeof import("~/lib/data/support.server").createSupportCase = (
  ...args: Parameters<typeof import("~/lib/data/support.server").createSupportCase>
) => import("~/lib/data/support.server").then((m) => m.createSupportCase(...args));

export const listSupportCases: typeof import("~/lib/data/support.server").listSupportCases = (
  ...args: Parameters<typeof import("~/lib/data/support.server").listSupportCases>
) => import("~/lib/data/support.server").then((m) => m.listSupportCases(...args));

export const getSupportCase: typeof import("~/lib/data/support.server").getSupportCase = (
  ...args: Parameters<typeof import("~/lib/data/support.server").getSupportCase>
) => import("~/lib/data/support.server").then((m) => m.getSupportCase(...args));

export const createSupportCaseEvent: typeof import("~/lib/data/support.server").createSupportCaseEvent = (
  ...args: Parameters<typeof import("~/lib/data/support.server").createSupportCaseEvent>
) => import("~/lib/data/support.server").then((m) => m.createSupportCaseEvent(...args));

export const listSupportCaseEvents: typeof import("~/lib/data/support.server").listSupportCaseEvents = (
  ...args: Parameters<typeof import("~/lib/data/support.server").listSupportCaseEvents>
) => import("~/lib/data/support.server").then((m) => m.listSupportCaseEvents(...args));

export const reconcileBillingEmailAttemptWithAudit: typeof import("~/lib/data/operator-delivery-reconciliation.server").reconcileBillingEmailAttemptWithAudit = (
  ...args: Parameters<typeof import("~/lib/data/operator-delivery-reconciliation.server").reconcileBillingEmailAttemptWithAudit>
) => import("~/lib/data/operator-delivery-reconciliation.server").then((m) => m.reconcileBillingEmailAttemptWithAudit(...args));

export const reconcileDigestEmailAttemptWithAudit: typeof import("~/lib/data/operator-delivery-reconciliation.server").reconcileDigestEmailAttemptWithAudit = (
  ...args: Parameters<typeof import("~/lib/data/operator-delivery-reconciliation.server").reconcileDigestEmailAttemptWithAudit>
) => import("~/lib/data/operator-delivery-reconciliation.server").then((m) => m.reconcileDigestEmailAttemptWithAudit(...args));

export const reconcileInstantChannelAttemptWithAudit: typeof import("~/lib/data/operator-delivery-reconciliation.server").reconcileInstantChannelAttemptWithAudit = (
  ...args: Parameters<typeof import("~/lib/data/operator-delivery-reconciliation.server").reconcileInstantChannelAttemptWithAudit>
) => import("~/lib/data/operator-delivery-reconciliation.server").then((m) => m.reconcileInstantChannelAttemptWithAudit(...args));

export const reconcileInstantEmailAttemptWithAudit: typeof import("~/lib/data/operator-delivery-reconciliation.server").reconcileInstantEmailAttemptWithAudit = (
  ...args: Parameters<typeof import("~/lib/data/operator-delivery-reconciliation.server").reconcileInstantEmailAttemptWithAudit>
) => import("~/lib/data/operator-delivery-reconciliation.server").then((m) => m.reconcileInstantEmailAttemptWithAudit(...args));

export const getOldestUserId: typeof import("~/lib/data/workspace-user.server").getOldestUserId = (
  ...args: Parameters<typeof import("~/lib/data/workspace-user.server").getOldestUserId>
) => import("~/lib/data/workspace-user.server").then((m) => m.getOldestUserId(...args));

export const getUserIdByEmail: typeof import("~/lib/data/workspace-user.server").getUserIdByEmail = (
  ...args: Parameters<typeof import("~/lib/data/workspace-user.server").getUserIdByEmail>
) => import("~/lib/data/workspace-user.server").then((m) => m.getUserIdByEmail(...args));

export const completeUserOnboarding: typeof import("~/lib/data/workspace-user.server").completeUserOnboarding = (
  ...args: Parameters<typeof import("~/lib/data/workspace-user.server").completeUserOnboarding>
) => import("~/lib/data/workspace-user.server").then((m) => m.completeUserOnboarding(...args));

export const listSavedQueries: typeof import("~/lib/data/workspace-user.server").listSavedQueries = (
  ...args: Parameters<typeof import("~/lib/data/workspace-user.server").listSavedQueries>
) => import("~/lib/data/workspace-user.server").then((m) => m.listSavedQueries(...args));

export const getSavedQuery: typeof import("~/lib/data/workspace-user.server").getSavedQuery = (
  ...args: Parameters<typeof import("~/lib/data/workspace-user.server").getSavedQuery>
) => import("~/lib/data/workspace-user.server").then((m) => m.getSavedQuery(...args));

export const createSavedQuery: typeof import("~/lib/data/workspace-user.server").createSavedQuery = (
  ...args: Parameters<typeof import("~/lib/data/workspace-user.server").createSavedQuery>
) => import("~/lib/data/workspace-user.server").then((m) => m.createSavedQuery(...args));

export const touchSavedQueryRun: typeof import("~/lib/data/workspace-user.server").touchSavedQueryRun = (
  ...args: Parameters<typeof import("~/lib/data/workspace-user.server").touchSavedQueryRun>
) => import("~/lib/data/workspace-user.server").then((m) => m.touchSavedQueryRun(...args));

export const getWorkspaceBranding: typeof import("~/lib/data/workspace-branding.server").getWorkspaceBranding = (
  ...args: Parameters<typeof import("~/lib/data/workspace-branding.server").getWorkspaceBranding>
) => import("~/lib/data/workspace-branding.server").then((m) => m.getWorkspaceBranding(...args));

export const upsertWorkspaceBranding: typeof import("~/lib/data/workspace-branding.server").upsertWorkspaceBranding = (
  ...args: Parameters<typeof import("~/lib/data/workspace-branding.server").upsertWorkspaceBranding>
) => import("~/lib/data/workspace-branding.server").then((m) => m.upsertWorkspaceBranding(...args));

export const getWeeklyBusinessSummary: typeof import("~/lib/data/workspace-ops.server").getWeeklyBusinessSummary = (
  ...args: Parameters<typeof import("~/lib/data/workspace-ops.server").getWeeklyBusinessSummary>
) => import("~/lib/data/workspace-ops.server").then((m) => m.getWeeklyBusinessSummary(...args));

export const getOperatorRiskSummary: typeof import("~/lib/data/workspace-ops.server").getOperatorRiskSummary = (
  ...args: Parameters<typeof import("~/lib/data/workspace-ops.server").getOperatorRiskSummary>
) => import("~/lib/data/workspace-ops.server").then((m) => m.getOperatorRiskSummary(...args));

export const getOperatorSnapshot: typeof import("~/lib/data/workspace-ops.server").getOperatorSnapshot = (
  ...args: Parameters<typeof import("~/lib/data/workspace-ops.server").getOperatorSnapshot>
) => import("~/lib/data/workspace-ops.server").then((m) => m.getOperatorSnapshot(...args));

export const getOperatorSupportCase: typeof import("~/lib/data/workspace-ops.server").getOperatorSupportCase = (
  ...args: Parameters<typeof import("~/lib/data/workspace-ops.server").getOperatorSupportCase>
) => import("~/lib/data/workspace-ops.server").then((m) => m.getOperatorSupportCase(...args));

export const logMetaIntegrationStatus: typeof import("~/lib/data/workspace-launch.server").logMetaIntegrationStatus = (
  ...args: Parameters<typeof import("~/lib/data/workspace-launch.server").logMetaIntegrationStatus>
) => import("~/lib/data/workspace-launch.server").then((m) => m.logMetaIntegrationStatus(...args));

export const getMetaIntegrationStatus: typeof import("~/lib/data/workspace-launch.server").getMetaIntegrationStatus = (
  ...args: Parameters<typeof import("~/lib/data/workspace-launch.server").getMetaIntegrationStatus>
) => import("~/lib/data/workspace-launch.server").then((m) => m.getMetaIntegrationStatus(...args));

export const getLaunchReadinessSignals: typeof import("~/lib/data/workspace-launch.server").getLaunchReadinessSignals = (
  ...args: Parameters<typeof import("~/lib/data/workspace-launch.server").getLaunchReadinessSignals>
) => import("~/lib/data/workspace-launch.server").then((m) => m.getLaunchReadinessSignals(...args));

export const getOrgById: typeof import("~/lib/data/org.server").getOrgById = (
  ...args: Parameters<typeof import("~/lib/data/org.server").getOrgById>
) => import("~/lib/data/org.server").then((m) => m.getOrgById(...args));

export const getOrCreatePersonalOrg: typeof import("~/lib/data/org.server").getOrCreatePersonalOrg = (
  ...args: Parameters<typeof import("~/lib/data/org.server").getOrCreatePersonalOrg>
) => import("~/lib/data/org.server").then((m) => m.getOrCreatePersonalOrg(...args));

export const getOrgIdForUser: typeof import("~/lib/data/org.server").getOrgIdForUser = (
  ...args: Parameters<typeof import("~/lib/data/org.server").getOrgIdForUser>
) => import("~/lib/data/org.server").then((m) => m.getOrgIdForUser(...args));
