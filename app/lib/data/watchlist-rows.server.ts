import { parseJson, type JsonRecord } from "~/lib/data/helpers.server";
import { normalizeWatchlistTrackingRole } from "~/lib/watchlist-role";
import type {
  DedupeReason,
  DeliveryQuietHours,
  EventCandidateRecord,
  ProofCaptureRecord,
  ProofDeviceProfile,
  ProofRenderMode,
  ProofSkipReason,
  ProofStatus,
  ProofTargetRecord,
  SensitivityMode,
  WatchEventRecord,
  WatchEventStatus,
  WatchEventType,
  WatchlistDeliveryConfigRecord,
  WatchlistRecord,
  WatchlistRunRecord,
  WatchlistTrackingRole,
  WatchTargetType,
  WebMentionObservationRecord,
  WebMentionSource,
  WebMentionTargetRecord,
} from "~/lib/types";
export interface WatchlistRow {
  id: string;
  user_id: string;
  name: string;
  target_type: WatchTargetType;
  tracking_role?: WatchlistTrackingRole | null;
  target_id: string;
  target_fingerprint: string;
  target_label: string;
  target_country: string | null;
  is_active: number;
  last_scanned_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface WatchlistRunRow {
  id: string;
  watchlist_id: string;
  trigger_type: WatchlistRunRecord["triggerType"];
  status: WatchlistRunRecord["status"];
  page_budget: number;
  pages_scanned: number;
  baseline_from_run_id: string | null;
  summary_json: string;
  started_at: string;
  finished_at: string | null;
  error_code: string | null;
  error_message: string | null;
}
export interface WatchEventRow {
  id: string;
  watchlist_id: string;
  run_id: string;
  event_type: WatchEventType;
  status: WatchEventStatus;
  importance_score: number;
  ad_id: string | null;
  baseline_from_run_id: string | null;
  candidate_id: string | null;
  proof_capture_id: string | null;
  title: string;
  summary: string;
  metadata_json: string;
  confirmed_at: string | null;
  suppressed_at: string | null;
  invalidated_at: string | null;
  last_evaluated_at: string | null;
  created_at: string;
}
export interface EventCandidateRow {
  id: string;
  watchlist_id: string;
  run_id: string;
  event_type: WatchEventType;
  status: WatchEventStatus;
  importance_score: number;
  ad_id: string | null;
  proof_target_id: string | null;
  title: string;
  summary: string;
  metadata_json: string;
  proof_required: number;
  skip_reason: ProofSkipReason | null;
  dedupe_reason: DedupeReason | null;
  detected_at: string;
  last_evaluated_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface ProofTargetRow {
  id: string;
  watchlist_id: string;
  ad_id: string | null;
  landing_page_url: string | null;
  canonical_page_identity: string;
  proof_target_identity: string;
  last_capture_attempt_at: string | null;
  last_successful_proof_at: string | null;
  last_successful_capture_id: string | null;
  created_at: string;
  updated_at: string;
}
export interface ProofCaptureRow {
  id: string;
  proof_target_id: string;
  status: ProofStatus;
  skip_reason: ProofSkipReason | null;
  failure_code: string | null;
  failure_reason: string | null;
  screenshot_artifact_key: string | null;
  html_artifact_key: string | null;
  extracted_fields_json: string;
  field_confidence_json: string | null;
  extraction_warnings_json: string | null;
  capture_metadata_json: string;
  render_mode: ProofRenderMode;
  device_profile: ProofDeviceProfile;
  extractor_version: string;
  idempotency_key: string | null;
  attempted_at: string;
  succeeded_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface CountRow {
  total: number;
}
export interface WatchlistDeliveryConfigRow {
  id: string;
  watchlist_id: string;
  user_id: string;
  sensitivity_mode: SensitivityMode;
  instant_enabled: number;
  digest_enabled: number;
  email_enabled: number;
  whatsapp_enabled: number;
  slack_enabled: number;
  teams_enabled: number;
  quiet_hours_json: string | null;
  timezone: string | null;
  created_at: string;
  updated_at: string;
}
export interface WebMentionTargetRow {
  id: string;
  user_id: string;
  watchlist_id: string | null;
  tracking_role: WatchlistTrackingRole;
  label: string;
  query_text: string;
  domain: string | null;
  sources_json: string;
  is_active: number;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface WebMentionObservationRow {
  id: string;
  target_id: string;
  user_id: string;
  source: WebMentionSource;
  source_id: string | null;
  url: string;
  url_hash: string;
  title: string;
  author: string | null;
  excerpt: string | null;
  published_at: string | null;
  observed_at: string;
  sentiment: string | null;
  engagement_json: string | null;
  raw_json: string | null;
  created_at: string;
}
export interface ObservationRow {
  id: string;
  ad_id: string;
  watchlist_run_id: string;
  landing_page_snapshot_id: string | null;
  landing_page_url: string | null;
  normalized_headline_hash: string | null;
  raw_headline: string | null;
  seen_at: string;
  is_active: number;
  metadata_json: string;
}
export function toWatchlistRecord(row: WatchlistRow): WatchlistRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    targetType: row.target_type,
    trackingRole: normalizeWatchlistTrackingRole(row.tracking_role),
    targetId: row.target_id,
    targetFingerprint: row.target_fingerprint,
    targetLabel: row.target_label,
    targetCountry: row.target_country ?? null,
    isActive: row.is_active === 1,
    lastScannedAt: row.last_scanned_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export function toWatchlistRunRecord(row: WatchlistRunRow): WatchlistRunRecord {
  return {
    id: row.id,
    watchlistId: row.watchlist_id,
    triggerType: row.trigger_type,
    status: row.status,
    pageBudget: row.page_budget,
    pagesScanned: row.pages_scanned,
    baselineFromRunId: row.baseline_from_run_id,
    summary: parseJson<JsonRecord>(row.summary_json, {}),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
  };
}
export function toWatchEventRecord(row: WatchEventRow): WatchEventRecord {
  return {
    id: row.id,
    watchlistId: row.watchlist_id,
    runId: row.run_id,
    eventType: row.event_type,
    status: row.status,
    importanceScore: row.importance_score,
    adId: row.ad_id,
    baselineFromRunId: row.baseline_from_run_id,
    candidateId: row.candidate_id,
    proofCaptureId: row.proof_capture_id,
    title: row.title,
    summary: row.summary,
    metadata: parseJson<JsonRecord>(row.metadata_json, {}),
    confirmedAt: row.confirmed_at,
    suppressedAt: row.suppressed_at,
    invalidatedAt: row.invalidated_at,
    lastEvaluatedAt: row.last_evaluated_at,
    createdAt: row.created_at,
  };
}
export function toEventCandidateRecord(row: EventCandidateRow): EventCandidateRecord {
  return {
    id: row.id,
    watchlistId: row.watchlist_id,
    runId: row.run_id,
    eventType: row.event_type,
    status: row.status,
    importanceScore: row.importance_score,
    adId: row.ad_id,
    proofTargetId: row.proof_target_id,
    title: row.title,
    summary: row.summary,
    metadata: parseJson<JsonRecord>(row.metadata_json, {}),
    proofRequired: row.proof_required === 1,
    skipReason: row.skip_reason,
    dedupeReason: row.dedupe_reason,
    detectedAt: row.detected_at,
    lastEvaluatedAt: row.last_evaluated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export function toProofTargetRecord(row: ProofTargetRow): ProofTargetRecord {
  return {
    id: row.id,
    watchlistId: row.watchlist_id,
    adId: row.ad_id,
    landingPageUrl: row.landing_page_url,
    canonicalPageIdentity: row.canonical_page_identity,
    proofTargetIdentity: row.proof_target_identity,
    lastCaptureAttemptAt: row.last_capture_attempt_at,
    lastSuccessfulProofAt: row.last_successful_proof_at,
    lastSuccessfulCaptureId: row.last_successful_capture_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export function toProofCaptureRecord(row: ProofCaptureRow): ProofCaptureRecord {
  return {
    id: row.id,
    proofTargetId: row.proof_target_id,
    status: row.status,
    skipReason: row.skip_reason,
    failureCode: row.failure_code,
    failureReason: row.failure_reason,
    screenshotArtifactKey: row.screenshot_artifact_key,
    htmlArtifactKey: row.html_artifact_key,
    extractedFields: parseJson<JsonRecord>(row.extracted_fields_json, {}),
    fieldConfidence: parseJson<Record<string, number>>(row.field_confidence_json, {}),
    extractionWarnings: parseJson<string[]>(row.extraction_warnings_json, []),
    captureMetadata: parseJson<JsonRecord>(row.capture_metadata_json, {}),
    renderMode: row.render_mode,
    deviceProfile: row.device_profile,
    extractorVersion: row.extractor_version,
    idempotencyKey: row.idempotency_key,
    attemptedAt: row.attempted_at,
    succeededAt: row.succeeded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export function toWatchlistDeliveryConfigRecord(
  row: WatchlistDeliveryConfigRow,
): WatchlistDeliveryConfigRecord {
  return {
    id: row.id,
    watchlistId: row.watchlist_id,
    userId: row.user_id,
    sensitivityMode: row.sensitivity_mode,
    instantEnabled: row.instant_enabled === 1,
    digestEnabled: row.digest_enabled === 1,
    emailEnabled: row.email_enabled === 1,
    whatsappEnabled: row.whatsapp_enabled === 1,
    slackEnabled: row.slack_enabled === 1,
    teamsEnabled: row.teams_enabled === 1,
    quietHours: parseJson<DeliveryQuietHours | null>(row.quiet_hours_json, null),
    timezone: row.timezone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export function toWebMentionTargetRecord(row: WebMentionTargetRow): WebMentionTargetRecord {
  return {
    id: row.id,
    userId: row.user_id,
    watchlistId: row.watchlist_id,
    trackingRole: normalizeWatchlistTrackingRole(row.tracking_role),
    label: row.label,
    queryText: row.query_text,
    domain: row.domain,
    sources: parseJson<WebMentionSource[]>(row.sources_json, []),
    isActive: row.is_active === 1,
    lastCheckedAt: row.last_checked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export function toWebMentionObservationRecord(row: WebMentionObservationRow): WebMentionObservationRecord {
  return {
    id: row.id,
    targetId: row.target_id,
    userId: row.user_id,
    source: row.source,
    sourceId: row.source_id,
    url: row.url,
    title: row.title,
    author: row.author,
    excerpt: row.excerpt,
    publishedAt: row.published_at,
    observedAt: row.observed_at,
    sentiment: row.sentiment,
    engagement: parseJson<JsonRecord>(row.engagement_json, {}),
    createdAt: row.created_at,
  };
}
