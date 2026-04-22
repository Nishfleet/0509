export const ANALYSIS_SOURCES = [
  "meta_api",
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
export const SHARE_RESOURCE_TYPES = ["collection", "watchlist", "digest", "report"] as const;
export const PRICING_REGIONS = ["india", "rest_of_world"] as const;
export const SEARCH_MODES = ["advertiser", "keyword"] as const;
export const CREATIVE_TYPES = ["all", "image", "video", "carousel"] as const;
export const SEARCH_STATUSES = ["all", "active", "inactive"] as const;
export const SENSITIVITY_MODES = ["quiet", "balanced", "aggressive", "auto"] as const;
export const DELIVERY_LANES = ["internal", "customer"] as const;
export const DELIVERY_CHANNELS = ["email", "whatsapp"] as const;
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
export const DELIVERY_TARGET_VALIDATION_STATUSES = [
  "pending",
  "validated",
  "invalid",
  "provider_rejected",
] as const;
export const PROOF_RENDER_MODES = ["mobile", "desktop"] as const;
export const PROOF_DEVICE_PROFILES = ["mobile_default", "desktop_default"] as const;

export type AnalysisSource = (typeof ANALYSIS_SOURCES)[number];
export type WatchEventType = (typeof WATCH_EVENT_TYPES)[number];
export type WatchEventStatus = (typeof WATCH_EVENT_STATUSES)[number];
export type WatchTargetType = (typeof WATCH_TARGET_TYPES)[number];
export type ShareResourceType = (typeof SHARE_RESOURCE_TYPES)[number];
export type PricingRegion = (typeof PRICING_REGIONS)[number];
export type SearchMode = (typeof SEARCH_MODES)[number];
export type CreativeTypeFilter = (typeof CREATIVE_TYPES)[number];
export type SearchStatusFilter = (typeof SEARCH_STATUSES)[number];
export type SensitivityMode = (typeof SENSITIVITY_MODES)[number];
export type DeliveryLane = (typeof DELIVERY_LANES)[number];
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];
export type ProofStatus = (typeof PROOF_STATUSES)[number];
export type ProofSkipReason = (typeof PROOF_SKIP_REASONS)[number];
export type DedupeReason = (typeof DEDUPE_REASONS)[number];
export type WebhookReconciliationStatus = (typeof WEBHOOK_RECONCILIATION_STATUSES)[number];
export type DeliveryAttemptStatus = (typeof DELIVERY_ATTEMPT_STATUSES)[number];
export type DeliveryTargetValidationStatus = (typeof DELIVERY_TARGET_VALIDATION_STATUSES)[number];
export type ProofRenderMode = (typeof PROOF_RENDER_MODES)[number];
export type ProofDeviceProfile = (typeof PROOF_DEVICE_PROFILES)[number];
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
  body: string;
  bodySecondary?: string;
  previewHeadline: string;
  previewSubhead: string;
  hook: string;
  offer: string;
  cta: string;
  format: Exclude<CreativeTypeFilter, "all">;
  languageLabel: string;
  destinationType: DestinationType;
  landingPageUrl: string | null;
  adSnapshotUrl: string | null;
  countries: string[];
  platforms: string[];
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  active: boolean;
  researchSummary: string;
  source: "meta" | "demo";
  analysisFields: AnalysisFieldInput[];
  creativeText?: string | null;
  creativeTextCaptureMethod?: CreativeTextCaptureMethod | null;
  creativeTextMetadata?: Record<string, unknown> | null;
  landingPage?: LandingPageSnapshotData | null;
  tags?: string[];
}

export type AdDiscoveryProvider = "meta_api" | "meta_library_browser" | "demo";
export type AdDiscoverySource = "meta" | "meta_api" | "meta_library_browser" | "demo";
export type DiscoveryCacheStatus = "miss" | "hit" | "stale" | "none";
export type DiscoveryRouteContext = "public_search" | "watchlist_scan" | "scheduled_warmup";
export type DiscoveryFetchStatus = "succeeded" | "failed";
export type CommercialDiscoveryStatus = "healthy" | "demo" | "degraded" | "cache_only" | "disabled";
export type DiscoveryFailureClass =
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
  discoveryStatus?: CommercialDiscoveryStatus;
  discoverySummary?: string | null;
  discoveryFailureClass?: DiscoveryFailureClass | null;
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
  targetId: string;
  targetFingerprint: string;
  targetLabel: string;
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

export interface WorkspaceDeliveryConfigRecord {
  id: string;
  userId: string;
  sensitivityMode: SensitivityMode;
  instantEnabled: boolean;
  digestEnabled: boolean;
  emailEnabled: boolean;
  whatsappEnabled: boolean;
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

export interface DigestRecord {
  id: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
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
  createdAt: string;
}

export interface DigestDeliveryRecord {
  id: string;
  digestRunId: string;
  provider: "resend";
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
}

export interface PricingPlan {
  name: string;
  monthlyLabel: string;
  yearlyLabel: string;
  detail: string;
}

export interface MetaIntegrationStatus {
  status: CommercialDiscoveryStatus;
  provider?: AdDiscoveryProvider;
  mode?: "live" | "diagnostic" | "demo" | "cache";
  summary: string;
  lastCheckedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}
