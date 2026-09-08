export const PRESENCE_CONNECTOR_IDS = ["website", "x", "reddit", "linkedin", "rss"] as const;
export type PresenceConnectorId = (typeof PRESENCE_CONNECTOR_IDS)[number];

/** Catalog sources include live connectors plus planned/manual-only entries. */
export const PRESENCE_SOURCE_IDS = [
  "website",
  "x",
  "reddit",
  "linkedin",
  "rss",
  "youtube",
  "amazon",
  "context_dev",
] as const;
export type PresenceSourceId = (typeof PRESENCE_SOURCE_IDS)[number];

export const PRESENCE_SOURCE_COVERAGE_STATUSES = [
  "active",
  "available",
  "connected",
  "gated",
  "planned",
  "manual_only",
  "limited",
  "unavailable",
  "degraded",
] as const;
export type PresenceSourceCoverageStatus = (typeof PRESENCE_SOURCE_COVERAGE_STATUSES)[number];

export interface PresenceSourceCoverageEntry {
  sourceId: PresenceSourceId;
  label: string;
  status: PresenceSourceCoverageStatus;
  coverageLabel: PresenceCoverageLabel | null;
  reasonCode: string | null;
  reasonMessage: string | null;
  actionNeeded: string | null;
  connectorId: PresenceConnectorId | null;
}

export const PRESENCE_TRACKING_MODES = ["self", "competitor"] as const;
export type PresenceTrackingMode = (typeof PRESENCE_TRACKING_MODES)[number];

export const PRESENCE_COVERAGE_LABELS = [
  "CONNECTED_ACCOUNT",
  "OFFICIAL_PUBLIC_API",
  "VERIFIED_PUBLIC_FEED",
  "PUBLIC_WEB_BEST_EFFORT",
  "LIMITED_COVERAGE",
  "UNAVAILABLE",
] as const;
export type PresenceCoverageLabel = (typeof PRESENCE_COVERAGE_LABELS)[number];

export const CONNECTOR_ROLLOUT_STATES = ["disabled", "internal", "pilot", "ga"] as const;
export type ConnectorRolloutState = (typeof CONNECTOR_ROLLOUT_STATES)[number];

export const SOURCE_CONNECTION_STATUSES = ["pending", "healthy", "degraded", "revoked"] as const;
export type SourceConnectionStatus = (typeof SOURCE_CONNECTION_STATUSES)[number];

export interface TrackedEntityRecord {
  id: string;
  userId: string;
  trackingMode: PresenceTrackingMode;
  label: string;
  canonicalUrl: string | null;
  notes: string | null;
  isActive: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceTargetRecord {
  id: string;
  trackedEntityId: string;
  userId: string;
  connectorId: PresenceConnectorId;
  targetKey: string;
  targetUrl: string | null;
  targetHandle: string | null;
  metadata: Record<string, unknown>;
  coverageLabel: PresenceCoverageLabel;
  isActive: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceConnectionRecord {
  id: string;
  userId: string;
  trackedEntityId: string | null;
  connectorId: PresenceConnectorId;
  encryptedCredentials: string;
  credentialFingerprint: string;
  status: SourceConnectionStatus;
  scopes: string[];
  externalAccountId: string | null;
  externalAccountLabel: string | null;
  lastHealthAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PresenceItemRecord {
  id: string;
  sourceTargetId: string;
  trackedEntityId: string;
  userId: string;
  connectorId: PresenceConnectorId;
  externalId: string | null;
  canonicalUrl: string;
  urlHash: string;
  title: string;
  bodyExcerpt: string | null;
  author: string | null;
  publishedAt: string | null;
  observedAt: string;
  contentHash: string;
  raw: Record<string, unknown> | null;
  isTombstone: boolean;
  revision: number;
  createdAt: string;
}

export interface PresencePollCursorRecord {
  sourceTargetId: string;
  cursor: Record<string, unknown>;
  etag: string | null;
  lastModified: string | null;
  lastPolledAt: string | null;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  updatedAt: string;
}

export interface NormalizedPresenceItem {
  externalId: string | null;
  canonicalUrl: string;
  title: string;
  bodyExcerpt: string | null;
  author: string | null;
  publishedAt: string | null;
  observedAt: string;
  contentHash: string;
  raw?: Record<string, unknown>;
  isTombstone?: boolean;
}

export interface ValidateTargetInput {
  trackingMode: PresenceTrackingMode;
  targetUrl?: string | null;
  targetHandle?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ValidateTargetResult {
  ok: boolean;
  targetKey?: string;
  targetUrl?: string | null;
  targetHandle?: string | null;
  coverageLabel: PresenceCoverageLabel;
  metadata?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

export interface PollResult {
  ok: boolean;
  items: NormalizedPresenceItem[];
  cursor?: Record<string, unknown>;
  coverageLabel?: PresenceCoverageLabel;
  etag?: string | null;
  lastModified?: string | null;
  errorCode?: string;
  errorMessage?: string;
  costUnits?: number;
}

export interface HealthCheckResult {
  ok: boolean;
  status: SourceConnectionStatus;
  summary: string;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface CostEstimate {
  units: number;
  description: string;
}

export interface PresenceConnectorContext {
  env: import("~/lib/env.server").AppEnv;
  userId: string;
  trackingMode: PresenceTrackingMode;
  connection?: SourceConnectionRecord | null;
  fetchImpl?: typeof fetch;
}
