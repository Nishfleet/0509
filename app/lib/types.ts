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
] as const;

export const WATCH_TARGET_TYPES = ["advertiser", "saved_query"] as const;
export const SHARE_RESOURCE_TYPES = ["collection", "watchlist", "digest", "report"] as const;
export const PRICING_REGIONS = ["india", "rest_of_world"] as const;
export const SEARCH_MODES = ["advertiser", "keyword"] as const;
export const CREATIVE_TYPES = ["all", "image", "video", "carousel"] as const;
export const SEARCH_STATUSES = ["all", "active", "inactive"] as const;

export type AnalysisSource = (typeof ANALYSIS_SOURCES)[number];
export type WatchEventType = (typeof WATCH_EVENT_TYPES)[number];
export type WatchTargetType = (typeof WATCH_TARGET_TYPES)[number];
export type ShareResourceType = (typeof SHARE_RESOURCE_TYPES)[number];
export type PricingRegion = (typeof PRICING_REGIONS)[number];
export type SearchMode = (typeof SEARCH_MODES)[number];
export type CreativeTypeFilter = (typeof CREATIVE_TYPES)[number];
export type SearchStatusFilter = (typeof SEARCH_STATUSES)[number];
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

export interface SearchResponse {
  ads: AdRecord[];
  nextCursor: string | null;
  source: "meta" | "demo";
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
  adId: string | null;
  baselineFromRunId: string | null;
  title: string;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
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
  status: "healthy" | "demo" | "degraded";
  summary: string;
  lastCheckedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}
