export const ANALYSIS_SOURCES = [
  "meta_api",
  "meta_library_browser",
  "ad_snapshot_fetch",
  "landing_page_fetch",
  "browser_render",
  "ai_summary",
  "user",
] as const;

export const WATCH_EVENT_TYPES = [
  "ad_new",
  "ad_inactive",
  "landing_page_url_changed",
  "landing_page_headline_changed",
  "landing_page_offer_changed",
  "landing_page_cta_changed",
  "landing_page_form_changed",
] as const;

export const WATCH_EVENT_STATUSES = [
  "detected",
  "proof_pending",
  "confirmed",
  "proof_failed",
  "suppressed",
  "invalidated",
] as const;

export const WATCH_TARGET_TYPES = ["advertiser", "saved_query"] as const;
export const WATCHLIST_TRACKING_ROLES = ["competitor", "self"] as const;
export const WEB_MENTION_SOURCES = ["reddit", "x", "blog", "youtube", "substack", "web"] as const;
export const SHARE_RESOURCE_TYPES = ["collection", "watchlist", "digest", "report"] as const;
export const SEARCH_MODES = ["advertiser", "keyword"] as const;
export const CREATIVE_TYPES = ["all", "image", "video", "carousel"] as const;
export const SEARCH_STATUSES = ["all", "active", "inactive"] as const;
export const SENSITIVITY_MODES = ["quiet", "balanced", "aggressive", "auto"] as const;
export const DELIVERY_LANES = ["internal", "customer"] as const;
export const DELIVERY_CHANNELS = ["email", "whatsapp", "slack", "teams"] as const;
export const PROOF_STATUSES = [
  "pending",
  "succeeded",
  "failed",
  "skipped_due_to_budget",
  "skipped_due_to_rate_limit",
  "skipped_due_to_dedupe",
] as const;
export const PROOF_SKIP_REASONS = [
  "skipped_due_to_budget",
  "skipped_due_to_rate_limit",
  "skipped_due_to_dedupe",
] as const;
export const DEDUPE_REASONS = [
  "candidate_duplicate",
  "proof_duplicate",
  "delivery_duplicate",
] as const;
export const WEBHOOK_RECONCILIATION_STATUSES = [
  "pending",
  "delivered",
  "failed",
  "legacy_unknown",
  "provider_unknown",
] as const;
export const DELIVERY_ATTEMPT_STATUSES = [
  "pending",
  "sent",
  "failed",
  "skipped_due_to_quiet_hours",
  "skipped_due_to_dedupe",
] as const;
export const AGENT_ACTION_AUDIT_STATUSES = ["started", "succeeded", "failed"] as const;
export const AGENT_MEMORY_SCOPES = ["workspace", "customer", "brand", "competitor"] as const;
export const DELIVERY_TARGET_VALIDATION_STATUSES = [
  "pending",
  "validated",
  "invalid",
  "provider_rejected",
] as const;
export const PROOF_RENDER_MODES = ["mobile", "desktop"] as const;
export const PROOF_DEVICE_PROFILES = ["mobile_default", "desktop_default"] as const;
export const SUPPORT_CASE_CATEGORIES = [
  "billing",
  "source",
  "delivery",
  "account",
  "team",
  "security",
  "migration",
  "other",
] as const;
export const SUPPORT_CASE_PRIORITIES = ["normal", "urgent"] as const;
export const SUPPORT_CASE_STATUSES = ["open", "closed"] as const;
export const SUPPORT_CASE_EVENT_TYPES = [
  "case_opened",
  "support_notified",
  "support_notification_failed",
  "support_note",
  "status_changed",
] as const;

export type AnalysisSource = (typeof ANALYSIS_SOURCES)[number];
export type WatchEventType = (typeof WATCH_EVENT_TYPES)[number];
export type WatchEventStatus = (typeof WATCH_EVENT_STATUSES)[number];
export type WatchTargetType = (typeof WATCH_TARGET_TYPES)[number];
export type WatchlistTrackingRole = (typeof WATCHLIST_TRACKING_ROLES)[number];
export type WebMentionSource = (typeof WEB_MENTION_SOURCES)[number];
export type ShareResourceType = (typeof SHARE_RESOURCE_TYPES)[number];
export type SearchMode = (typeof SEARCH_MODES)[number];
export type CreativeTypeFilter = (typeof CREATIVE_TYPES)[number];
export type AdCreativeFormat = Exclude<CreativeTypeFilter, "all"> | "unknown";
export type SearchStatusFilter = (typeof SEARCH_STATUSES)[number];
export type SensitivityMode = (typeof SENSITIVITY_MODES)[number];
export type DeliveryLane = (typeof DELIVERY_LANES)[number];
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];
export type ProofStatus = (typeof PROOF_STATUSES)[number];
export type ProofSkipReason = (typeof PROOF_SKIP_REASONS)[number];
export type DedupeReason = (typeof DEDUPE_REASONS)[number];
export type WebhookReconciliationStatus = (typeof WEBHOOK_RECONCILIATION_STATUSES)[number];
export type DeliveryAttemptStatus = (typeof DELIVERY_ATTEMPT_STATUSES)[number];
export type AgentActionAuditStatus = (typeof AGENT_ACTION_AUDIT_STATUSES)[number];
export type AgentMemoryScope = (typeof AGENT_MEMORY_SCOPES)[number];
export type DeliveryTargetValidationStatus = (typeof DELIVERY_TARGET_VALIDATION_STATUSES)[number];
export type ProofRenderMode = (typeof PROOF_RENDER_MODES)[number];
export type ProofDeviceProfile = (typeof PROOF_DEVICE_PROFILES)[number];
export type SupportCaseCategory = (typeof SUPPORT_CASE_CATEGORIES)[number];
export type SupportCasePriority = (typeof SUPPORT_CASE_PRIORITIES)[number];
export type SupportCaseStatus = (typeof SUPPORT_CASE_STATUSES)[number];
export type SupportCaseEventType = (typeof SUPPORT_CASE_EVENT_TYPES)[number];
export type NormalizedSensitivityMode = Exclude<SensitivityMode, "auto">;
export type CaptureMethod = "landing_page_fetch" | "browser_render" | "manual";
export type CreativeTextCaptureMethod = "ad_snapshot_fetch" | "browser_render" | "manual";
export type DestinationType =
  | "website"
  | "whatsapp"
  | "app"
  | "lead_form"
  | "unknown";

export interface AppUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  onboardedAt?: string | null;
}

export interface AppSessionRecord {
  id: string;
  userId: string;
  expiresAt: string;
}

export interface AppSession {
  user: AppUser;
  session: AppSessionRecord;
}

export interface SearchFilters {
  query: string;
  country: string;
  platform: string;
  creativeType: CreativeTypeFilter;
  status: SearchStatusFilter;
  firstSeenFrom: string;
  lastSeenFrom: string;
  /**
   * Numeric Meta Page id for an advertiser whose identity has been verified for
   * this query. When present, discovery scopes the Ad Library scrape to that
   * exact page (`view_all_page_id=<pageId>`) instead of guessing with a keyword
   * search — this is what makes mega-brand scans (Nike, Amazon, …) return the
   * brand's own ads instead of resellers/keyword junk. Only ever set after a
   * verified advertiser match; never a guess. Optional and omitted for keyword
   * queries so their cache fingerprints stay unchanged.
   */
  pageId?: string;
}

export interface NormalizedSavedQuery {
  mode: SearchMode;
  filters: SearchFilters;
}

export interface AnalysisFieldInput {
  scopeType: "ad" | "observation" | "landing_page";
  fieldKey: string;
  fieldValue: string;
  provenanceSource: AnalysisSource;
  extractorVersion: string;
  confidence?: number | null;
  metadata?: Record<string, unknown>;
}

export interface LandingPageSnapshotData {
  rawUrl: string;
  canonicalUrl: string;
  rawHeadline: string;
  normalizedHeadline: string;
  normalizedHeadlineHash: string;
  ctaText?: string | null;
  priceText?: string | null;
  formPresent?: boolean | null;
  captureMethod: CaptureMethod;
  capturedAt: string;
  artifactKey?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AdRecord {
  metaAdId: string;
  advertiser: string;
  /**
   * Numeric Meta Page id of the advertiser that ran this ad, when discovery
   * could resolve it (Ad Library relay payload or a numeric advertiser-page
   * link). Powers verified page-scoped re-scans; never inferred from the
   * search term.
   */
  advertiserPageId?: string | null;
  body: string;
  bodySecondary?: string;
  previewHeadline: string;
  previewSubhead: string;
  hook: string;
  offer: string;
  cta: string;
  format: AdCreativeFormat;
  languageLabel: string;
  destinationType: DestinationType;
  landingPageUrl: string | null;
  adSnapshotUrl: string | null;
  countries: string[];
  platforms: string[];
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  active: boolean;
  activeStatusObserved?: boolean;
  researchSummary: string;
  source: AdDiscoverySource;
  analysisFields: AnalysisFieldInput[];
  creativeText?: string | null;
  creativeImageUrl?: string | null;
  /** Soft hint from discovery scrape; not a verified format classification. */
  creativeFormatHint?: "image" | "video" | undefined;
  /** "N ads use this creative" count from Ad Library cards when present. */
  variantCount?: number | null;
  creativeTextCaptureMethod?: CreativeTextCaptureMethod | null;
  creativeTextMetadata?: Record<string, unknown> | null;
  landingPage?: LandingPageSnapshotData | null;
  evidenceCapturedAt?: string | null;
  canonicalRevision?: string;
  tags?: string[];
  domainMatch?: {
    level: string;
    reason: string;
    matchedDomain: string | null;
  };
}

export type AdDiscoveryProvider = "meta_api" | "meta_library_browser";
export type AdDiscoverySource = "meta" | "meta_api" | "meta_library_browser" | "external";
export type DiscoveryCacheStatus = "miss" | "hit" | "stale" | "none";
export type DiscoveryRouteContext = "public_search" | "watchlist_scan" | "scheduled_warmup";
export type DiscoveryFetchStatus = "succeeded" | "failed";
export type CommercialDiscoveryStatus = "healthy" | "degraded" | "cache_only" | "disabled";
export type DiscoveryFailureClass =
  | "provider_unavailable"
  | "browser_unavailable"
  | "browser_launch_failed"
  | "timeout"
  | "login_wall"
  | "rate_limited"
  | "selector_drift"
  | "empty_result";

export interface SearchResponse {
  ads: AdRecord[];
  nextCursor: string | null;
  source: AdDiscoverySource;
  provider?: AdDiscoveryProvider;
  cacheStatus?: DiscoveryCacheStatus;
  /**
   * The discovery cache entry's `fetched_at`, carried on cache-served
   * responses (cacheStatus "hit" or "stale"). Lets a result view render the
   * age of the snapshot it is showing ("captured N minutes ago"), so a stale
   * per-country snapshot is self-evidently stale instead of looking current.
   * Absent on live captures (cacheStatus "miss"/"none").
   */
  cacheFetchedAt?: string;
  discoveryEmptyReason?: "no_results";
  /**
   * Contract epoch stamped by the cache WRITER (see
   * DISCOVERY_ADVERTISER_FILTER_EPOCH in discovery-cache.server.ts). Proves
   * which advertiser-filter contract produced a cached result — worker version
   * cannot be inferred from timestamps because sleeping/retrying Workflow
   * instances can run old code indefinitely.
   */
  discoveryFilterEpoch?: string;
  discoveryStatus?: CommercialDiscoveryStatus;
  discoveryPartial?: boolean;
  discoveryProgress?: "warming";
  discoverySummary?: string | null;
  discoveryFailureClass?: DiscoveryFailureClass | null;
  searchIntent?: "domain" | "text";
  searchScope?: "exact" | "broader";
  displayDomain?: string | null;
  verifiedCount?: number;
  rawCandidateCount?: number;
  broaderCandidateCount?: number;
  missingVerificationCount?: number;
  rejectedKeywordOnlyCount?: number;
}

export interface SavedQueryRecord {
  id: string;
  userId: string;
  name: string;
  mode: SearchMode;
  queryText: string;
  normalizedQuery: NormalizedSavedQuery;
  fingerprint: string;
  runCount: number;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionRecord {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionItemRecord {
  id: string;
  collectionId: string;
  adId: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  ad: AdRecord;
  tags: string[];
}

export interface WatchlistRecord {
  id: string;
  userId: string;
  name: string;
  targetType: WatchTargetType;
  trackingRole?: WatchlistTrackingRole;
  targetId: string;
  targetFingerprint: string;
  targetLabel: string;
  targetCountry: string | null;
  isActive: boolean;
  lastScannedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WatchlistRunRecord {
  id: string;
  watchlistId: string;
  triggerType: "scheduled" | "manual";
  status: "pending" | "running" | "succeeded" | "failed" | "skipped";
  pageBudget: number;
  pagesScanned: number;
  baselineFromRunId: string | null;
  summary: Record<string, unknown>;
  startedAt: string;
  finishedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface WatchEventRecord {
  id: string;
  watchlistId: string;
  runId: string;
  eventType: WatchEventType;
  status: WatchEventStatus;
  importanceScore: number;
  adId: string | null;
  baselineFromRunId: string | null;
  candidateId: string | null;
  proofCaptureId: string | null;
  title: string;
  summary: string;
  metadata: Record<string, unknown>;
  confirmedAt: string | null;
  suppressedAt: string | null;
  invalidatedAt: string | null;
  lastEvaluatedAt: string | null;
  createdAt: string;
}

export interface EventCandidateRecord {
  id: string;
  watchlistId: string;
  runId: string;
  eventType: WatchEventType;
  status: WatchEventStatus;
  importanceScore: number;
  adId: string | null;
  proofTargetId: string | null;
  title: string;
  summary: string;
  metadata: Record<string, unknown>;
  proofRequired: boolean;
  skipReason: ProofSkipReason | null;
  dedupeReason: DedupeReason | null;
  detectedAt: string;
  lastEvaluatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProofTargetRecord {
  id: string;
  watchlistId: string;
  adId: string | null;
  landingPageUrl: string | null;
  canonicalPageIdentity: string;
  proofTargetIdentity: string;
  lastCaptureAttemptAt: string | null;
  lastSuccessfulProofAt: string | null;
  lastSuccessfulCaptureId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProofCaptureRecord {
  id: string;
  proofTargetId: string;
  status: ProofStatus;
  skipReason: ProofSkipReason | null;
  failureCode: string | null;
  failureReason: string | null;
  screenshotArtifactKey: string | null;
  htmlArtifactKey: string | null;
  extractedFields: Record<string, unknown>;
  fieldConfidence: Record<string, number>;
  extractionWarnings: string[];
  captureMetadata: Record<string, unknown>;
  renderMode: ProofRenderMode;
  deviceProfile: ProofDeviceProfile;
  extractorVersion: string;
  idempotencyKey: string | null;
  attemptedAt: string;
  succeededAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WatchlistProofSummary {
  totalAttempts: number;
  successfulAttempts: number;
  failedAttempts: number;
  skippedAttempts: number;
  lastAttemptAt: string | null;
  lastSuccessfulProofAt: string | null;
}

export interface WatchlistRunSummaryCounts {
  candidatesDetected: number | null;
  proofsAttempted: number | null;
  eventsConfirmed: number | null;
  sendsTriggered: number | null;
}

export interface DeliveryQuietHours {
  startHour: number;
  endHour: number;
}

export type DigestCadencePreference = "plan_default" | "weekly_only";

export interface WorkspaceDeliveryConfigRecord {
  id: string;
  userId: string;
  sensitivityMode: SensitivityMode;
  instantEnabled: boolean;
  digestEnabled: boolean;
  /** plan_default = current plan cadence; weekly_only = skip daily digests. */
  digestCadencePreference: DigestCadencePreference;
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  slackEnabled: boolean;
  teamsEnabled: boolean;
  quietHours: DeliveryQuietHours | null;
  timezone: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WatchlistDeliveryConfigRecord {
  id: string;
  watchlistId: string;
  userId: string;
  sensitivityMode: SensitivityMode;
  instantEnabled: boolean;
  digestEnabled: boolean;
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  slackEnabled: boolean;
  teamsEnabled: boolean;
  quietHours: DeliveryQuietHours | null;
  timezone: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EffectiveDeliveryConfig {
  sensitivityMode: NormalizedSensitivityMode;
  instantEnabled: boolean;
  digestEnabled: boolean;
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  slackEnabled: boolean;
  teamsEnabled: boolean;
  quietHours: DeliveryQuietHours | null;
  timezone: string | null;
}

export interface DeliveryTargetRecord {
  id: string;
  userId: string;
  watchlistId: string | null;
  channel: DeliveryChannel;
  targetValue: string;
  validationStatus: DeliveryTargetValidationStatus;
  isValidated: boolean;
  isOptedIn: boolean;
  optInSource: string | null;
  optedInAt: string | null;
  isPaused: boolean;
  pausedAt: string | null;
  optedOutAt: string | null;
  templateEligible: boolean;
  lastSuccessfulDeliveryAt: string | null;
  lastSuccessfulAttemptId: string | null;
  providerIdentifier: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WebMentionTargetRecord {
  id: string;
  userId: string;
  watchlistId: string | null;
  trackingRole: WatchlistTrackingRole;
  label: string;
  queryText: string;
  domain: string | null;
  sources: WebMentionSource[];
  isActive: boolean;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebMentionObservationRecord {
  id: string;
  targetId: string;
  userId: string;
  source: WebMentionSource;
  sourceId: string | null;
  url: string;
  title: string;
  author: string | null;
  excerpt: string | null;
  publishedAt: string | null;
  observedAt: string;
  sentiment: string | null;
  engagement: Record<string, unknown>;
  createdAt: string;
}

export interface DeliveryAttemptRecord {
  id: string;
  userId: string;
  watchlistId: string | null;
  digestRunId: string | null;
  deliveryTargetId: string | null;
  lane: DeliveryLane;
  channel: DeliveryChannel;
  provider: string;
  status: DeliveryAttemptStatus;
  webhookStatus: WebhookReconciliationStatus;
  targetValue: string;
  providerMessageId: string | null;
  providerStatusLastSeenAt: string | null;
  templateName: string | null;
  eventIds: string[];
  payloadSnapshot: Record<string, unknown>;
  idempotencyKey: string | null;
  errorMessage: string | null;
  sentAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentActionAuditRecord {
  id: string;
  userId: string;
  apiKeyId: string | null;
  actionName: string;
  resourceType: string | null;
  resourceId: string | null;
  idempotencyKey: string | null;
  status: AgentActionAuditStatus;
  result: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMemoryRecord {
  id: string;
  userId: string;
  scope: AgentMemoryScope;
  key: string;
  watchlistId: string | null;
  clientRoomId: string | null;
  value: Record<string, unknown>;
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClientRoomResourceRef {
  resourceType: ShareResourceType;
  resourceId: string;
  label?: string | null;
}

export interface ClientRoomRecord {
  id: string;
  userId: string;
  name: string;
  clientLabel: string | null;
  status: "active" | "archived";
  resourceRefs: ClientRoomResourceRef[];
  notes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SupportCaseRecord {
  id: string;
  userId: string;
  requestKey: string | null;
  category: SupportCaseCategory;
  priority: SupportCasePriority;
  status: SupportCaseStatus;
  subject: string;
  detail: string;
  context: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SupportCaseEventRecord {
  id: string;
  caseId: string;
  userId: string;
  eventType: SupportCaseEventType;
  message: string;
  visibleToCustomer: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface DigestRecord {
  id: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
	// Free-form digest_run.summary_json (counts plus the optional AI strategy
	// paragraph). Optional so snapshot/export fixtures predating it stay valid.
	summary?: Record<string, unknown>;
  createdAt: string;
  items: DigestItemRecord[];
  delivery: DigestDeliveryRecord | null;
}

export interface DigestItemRecord {
  id: string;
  digestRunId: string;
  watchlistId: string;
  watchlistName: string;
  eventType: WatchEventType;
  title: string;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface DigestDeliveryRecord {
  id: string;
  digestRunId: string;
  provider: string;
  status: "pending" | "sent" | "failed";
  recipientEmail: string;
  externalMessageId: string | null;
  errorMessage: string | null;
  deliveredAt: string | null;
}

export interface ShareLinkRecord {
  id: string;
  token: string;
  userId: string;
  resourceType: ShareResourceType;
  resourceId: string;
  isSnapshot: boolean;
  snapshotPayload: Record<string, unknown> | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface PricingPlan {
  slug: "scout" | "starter" | "agency";
  name: string;
  monthlyLabel: string;
  yearlyLabel: string;
  detail: string;
  features: string[];
  monthlySku?: string;
  yearlySku?: string;
  watchlistLimit?: number;
  boardLimit?: number;
  evidenceChecksPerMonth?: number;
}

export interface UsageBundle {
  slug: "proof_500" | "proof_2000" | "proof_7500";
  sku?: string;
  name: string;
  priceLabel: string;
  creditLabel: string;
  detail: string;
  creditQuantity?: number;
}

export interface MetaIntegrationStatus {
  status: CommercialDiscoveryStatus;
  provider?: AdDiscoveryProvider;
  mode?: "live" | "diagnostic" | "cache";
  summary: string;
  lastCheckedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}

export interface CustomerMetaConnectionRecord {
  userId: string;
  encryptedAccessToken: string;
  tokenLastFour: string;
  tokenFingerprint: string;
  status: "untested" | "healthy" | "degraded";
  summary: string;
  lastCheckedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerApiKeyRecord {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  actionsWriteEnabled: boolean;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
