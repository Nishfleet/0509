import { buildLandingPageAnalysisFields } from "~/lib/analysis.server";
import { chunkForBoundParams } from "~/lib/d1-chunk.server";
import {
  hydrateAdsWithPersistedCreatives as hydrateAdsWithPersistedCreativesImpl,
  listAdsByIds,
  replaceAnalysisFields,
  upsertAd as upsertAdImpl,
} from "~/lib/ad-persistence.server";
import {
  isCustomerWhatsAppReady,
  isWhatsAppProviderConfigured,
  isWhatsAppWebhookConfigured,
  type AppEnv,
} from "~/lib/env.server";
import { buildExternalProofAd } from "~/lib/external-proof.server";
import { fingerprintSavedQuery, normalizeSavedQuery } from "~/lib/normalize";
import { normalizeWatchlistTrackingRole } from "~/lib/watchlist-role";
import type {
  AdRecord,
  AgentActionAuditRecord,
  AgentActionAuditStatus,
  AgentMemoryRecord,
  AgentMemoryScope,
  AnalysisFieldInput,
  AppSession,
  CollectionItemRecord,
  CollectionRecord,
  ClientRoomRecord,
  ClientRoomResourceRef,
  CustomerMetaConnectionRecord,
  CustomerApiKeyRecord,
  DeliveryAttemptRecord,
  DeliveryAttemptStatus,
  DeliveryChannel,
  DiscoveryCacheStatus,
  DiscoveryFailureClass,
  DiscoveryFetchStatus,
  DiscoveryRouteContext,
  DeliveryQuietHours,
  DigestDeliveryRecord,
  DigestItemRecord,
  DigestRecord,
  DedupeReason,
  EventCandidateRecord,
  AdDiscoveryProvider,
  MetaIntegrationStatus,
  NormalizedSavedQuery,
  ProofCaptureRecord,
  ProofDeviceProfile,
  ProofRenderMode,
  ProofSkipReason,
  ProofStatus,
  ProofTargetRecord,
  SavedQueryRecord,
  SensitivityMode,
  ShareLinkRecord,
  ShareResourceType,
  WatchEventStatus,
  WatchEventRecord,
  WatchEventType,
  WatchTargetType,
  WatchlistTrackingRole,
  WatchlistDeliveryConfigRecord,
  WatchlistRecord,
  WatchlistRunRecord,
  WebhookReconciliationStatus,
  WorkspaceDeliveryConfigRecord,
  DeliveryLane,
  DeliveryTargetRecord,
  DeliveryTargetValidationStatus,
  SearchResponse,
} from "~/lib/types";

type JsonRecord = Record<string, unknown>;

interface SavedQueryRow {
  id: string;
  user_id: string;
  name: string;
  mode: SavedQueryRecord["mode"];
  query_text: string;
  normalized_query_json: string;
  fingerprint: string;
  run_count: number;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CollectionRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface CollectionItemRow {
  id: string;
  collection_id: string;
  ad_id: string;
  note: string | null;
  ad_snapshot_json: string;
  created_at: string;
  updated_at: string;
}

interface WatchlistRow {
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

interface WatchlistRunRow {
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

interface WatchEventRow {
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

interface EventCandidateRow {
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

interface ProofTargetRow {
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

interface ProofCaptureRow {
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

interface CountRow {
  total: number;
}

interface AgentActionAuditRow {
  id: string;
  user_id: string;
  api_key_id: string | null;
  action_name: string;
  resource_type: string | null;
  resource_id: string | null;
  idempotency_key: string | null;
  status: AgentActionAuditStatus;
  result_json: string | null;
  error_code: string | null;
  error_message: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

interface AgentMemoryRow {
  id: string;
  user_id: string;
  scope: AgentMemoryScope;
  memory_key: string;
  watchlist_id: string | null;
  client_room_id: string | null;
  value_json: string;
  source: string | null;
  created_at: string;
  updated_at: string;
}

interface ClientRoomRow {
  id: string;
  user_id: string;
  name: string;
  client_label: string | null;
  status: ClientRoomRecord["status"];
  notes_json: string;
  created_at: string;
  updated_at: string;
}

interface ClientRoomResourceRow {
  id: string;
  room_id: string;
  user_id: string;
  resource_type: ClientRoomResourceRef["resourceType"];
  resource_id: string;
  label: string | null;
  created_at: string;
}

interface WorkspaceDeliveryConfigRow {
  id: string;
  user_id: string;
  sensitivity_mode: SensitivityMode;
  instant_enabled: number;
  digest_enabled: number;
  email_enabled: number;
  whatsapp_enabled: number;
  slack_enabled: number;
  quiet_hours_json: string | null;
  timezone: string | null;
  created_at: string;
  updated_at: string;
}

interface WatchlistDeliveryConfigRow {
  id: string;
  watchlist_id: string;
  user_id: string;
  sensitivity_mode: SensitivityMode;
  instant_enabled: number;
  digest_enabled: number;
  email_enabled: number;
  whatsapp_enabled: number;
  slack_enabled: number;
  quiet_hours_json: string | null;
  timezone: string | null;
  created_at: string;
  updated_at: string;
}

interface DeliveryTargetRow {
  id: string;
  user_id: string;
  watchlist_id: string | null;
  channel: DeliveryChannel;
  target_value: string;
  validation_status: DeliveryTargetValidationStatus;
  is_validated: number;
  is_opted_in: number;
  opt_in_source: string | null;
  opted_in_at: string | null;
  is_paused: number;
  paused_at: string | null;
  opted_out_at: string | null;
  template_eligible: number;
  last_successful_delivery_at: string | null;
  last_successful_attempt_id: string | null;
  provider_identifier: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

interface ObservationRow {
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

interface DigestRunRow {
  id: string;
  user_id: string;
  period_start: string;
  period_end: string;
  created_at: string;
}

interface DigestItemRow {
  id: string;
  digest_run_id: string;
  watchlist_id: string;
  watchlist_name: string;
  event_type: WatchEventType;
  title: string;
  summary: string;
  metadata_json: string;
  created_at: string;
}

interface DigestDeliveryRow {
  id: string;
  digest_run_id: string;
  provider: string;
  status: DigestDeliveryRecord["status"];
  recipient_email: string;
  external_message_id: string | null;
  error_message: string | null;
  delivered_at: string | null;
}

interface DeliveryAttemptRow {
  id: string;
  user_id: string;
  watchlist_id: string | null;
  digest_run_id: string | null;
  delivery_target_id: string | null;
  lane: DeliveryLane;
  channel: DeliveryChannel;
  provider: string;
  status: DeliveryAttemptStatus;
  webhook_status: WebhookReconciliationStatus;
  target_value: string;
  provider_message_id: string | null;
  provider_status_last_seen_at: string | null;
  template_name: string | null;
  event_ids_json: string;
  payload_snapshot_json: string;
  idempotency_key: string | null;
  error_message: string | null;
  sent_at: string | null;
  failed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ShareLinkRow {
  id: string;
  token: string;
  user_id: string;
  resource_type: ShareResourceType;
  resource_id: string;
  is_snapshot: number;
  snapshot_payload_json: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

interface WorkspaceBrandingRow {
  user_id: string;
  brand_name: string | null;
  updated_at: string;
}

interface MetaLogRow {
  status: MetaIntegrationStatus["status"];
  summary: string;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}

interface CustomerMetaConnectionRow {
  user_id: string;
  encrypted_access_token: string;
  token_last_four: string;
  token_fingerprint: string;
  status: CustomerMetaConnectionRecord["status"];
  summary: string;
  last_checked_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface DiscoveryCacheEntryRow {
  cache_key: string;
  provider: AdDiscoveryProvider;
  route_context: DiscoveryRouteContext;
  query_fingerprint: string;
  country: string;
  cursor: string | null;
  payload_json: string;
  fetched_at: string;
  expires_at: string;
  browser_ms_used: number | null;
  created_at: string;
  updated_at: string;
}

interface DiscoveryProviderStateRow {
  provider: AdDiscoveryProvider;
  status: MetaIntegrationStatus["status"];
  failure_class: DiscoveryFailureClass | null;
  summary: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  metadata_json: string | null;
  updated_at: string;
}

interface DiscoveryFetchLogRow {
  id: string;
  provider: AdDiscoveryProvider;
  route_context: DiscoveryRouteContext;
  country: string;
  status: DiscoveryFetchStatus;
  cache_status: DiscoveryCacheStatus;
  failure_class: DiscoveryFailureClass | null;
  browser_ms_used: number | null;
  metadata_json: string | null;
  created_at: string;
}

interface CustomerApiKeyRow {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  actions_write_enabled: number;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

type RazorpayWebhookOutcome = "received" | "processed" | "ignored" | "failed";

export function nowIso() {
  return new Date().toISOString();
}

export function createId() {
  return crypto.randomUUID();
}

export { listAdsByIds, replaceAnalysisFields } from "~/lib/ad-persistence.server";

export async function hydrateAdsWithPersistedCreatives(env: AppEnv, ads: AdRecord[]) {
  if (!env.DB) {
    return ads;
  }

  return hydrateAdsWithPersistedCreativesImpl(env, ads);
}

export async function findAgentActionAuditByIdempotencyKey(
  env: AppEnv,
  userId: string,
  idempotencyKey: string,
) {
  const row = await one<AgentActionAuditRow>(
    env,
    `
      SELECT *
      FROM agent_action_audit
      WHERE user_id = ?
        AND idempotency_key = ?
      LIMIT 1
    `,
    userId,
    idempotencyKey,
  );

  return row ? toAgentActionAuditRecord(row) : null;
}

export async function createAgentActionAudit(
  env: AppEnv,
  input: {
    userId: string;
    apiKeyId?: string | null;
    actionName: string;
    resourceType?: string | null;
    resourceId?: string | null;
    idempotencyKey?: string | null;
    status?: AgentActionAuditStatus;
    result?: JsonRecord | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    metadata?: JsonRecord | null;
  },
) {
  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO agent_action_audit (
        id,
        user_id,
        api_key_id,
        action_name,
        resource_type,
        resource_id,
        idempotency_key,
        status,
        result_json,
        error_code,
        error_message,
        metadata_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    id,
    input.userId,
    input.apiKeyId ?? null,
    input.actionName,
    input.resourceType ?? null,
    input.resourceId ?? null,
    input.idempotencyKey ?? null,
    input.status ?? "started",
    input.result ? jsonValue(input.result) : null,
    input.errorCode ?? null,
    input.errorMessage ?? null,
    jsonValue(input.metadata ?? {}),
    timestamp,
    timestamp,
  );

  const row = await one<AgentActionAuditRow>(env, "SELECT * FROM agent_action_audit WHERE id = ?", id);
  return row ? toAgentActionAuditRecord(row) : null;
}

export async function claimAgentActionAudit(
  env: AppEnv,
  input: {
    userId: string;
    apiKeyId?: string | null;
    actionName: string;
    resourceType?: string | null;
    resourceId?: string | null;
    idempotencyKey?: string | null;
    metadata?: JsonRecord | null;
  },
) {
  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT OR IGNORE INTO agent_action_audit (
        id,
        user_id,
        api_key_id,
        action_name,
        resource_type,
        resource_id,
        idempotency_key,
        status,
        result_json,
        error_code,
        error_message,
        metadata_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'started', NULL, NULL, NULL, ?, ?, ?)
    `,
    id,
    input.userId,
    input.apiKeyId ?? null,
    input.actionName,
    input.resourceType ?? null,
    input.resourceId ?? null,
    input.idempotencyKey ?? null,
    jsonValue(input.metadata ?? {}),
    timestamp,
    timestamp,
  );

  const claimed = await one<AgentActionAuditRow>(
    env,
    "SELECT * FROM agent_action_audit WHERE id = ?",
    id,
  );
  if (claimed) {
    return {
      audit: toAgentActionAuditRecord(claimed),
      claimed: true,
    };
  }

  const existing = input.idempotencyKey
    ? await findAgentActionAuditByIdempotencyKey(env, input.userId, input.idempotencyKey)
    : null;
  return existing
    ? { audit: existing, claimed: false }
    : null;
}

export async function finishAgentActionAudit(
  env: AppEnv,
  auditId: string,
  input: {
    status: Exclude<AgentActionAuditStatus, "started">;
    resourceType?: string | null;
    resourceId?: string | null;
    result?: JsonRecord | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    metadata?: JsonRecord | null;
  },
) {
  const timestamp = nowIso();
  await run(
    env,
    `
      UPDATE agent_action_audit
      SET status = ?,
          resource_type = COALESCE(?, resource_type),
          resource_id = COALESCE(?, resource_id),
          result_json = ?,
          error_code = ?,
          error_message = ?,
          metadata_json = ?,
          updated_at = ?
      WHERE id = ?
    `,
    input.status,
    input.resourceType ?? null,
    input.resourceId ?? null,
    input.result ? jsonValue(input.result) : null,
    input.errorCode ?? null,
    input.errorMessage ?? null,
    jsonValue(input.metadata ?? {}),
    timestamp,
    auditId,
  );

  const row = await one<AgentActionAuditRow>(env, "SELECT * FROM agent_action_audit WHERE id = ?", auditId);
  return row ? toAgentActionAuditRecord(row) : null;
}

export async function upsertAgentMemory(
  env: AppEnv,
  userId: string,
  input: {
    scope: AgentMemoryScope;
    key: string;
    watchlistId?: string | null;
    clientRoomId?: string | null;
    value: JsonRecord;
    source?: string | null;
  },
) {
  const id = createId();
  const timestamp = nowIso();
  const key = input.key.trim();
  const watchlistId = input.watchlistId?.trim() || null;
  const clientRoomId = input.clientRoomId?.trim() || null;
  if (watchlistId && clientRoomId) {
    throw new Error("Agent memory can be scoped to either a watchlist or a client room, not both.");
  }

  const existing = await findAgentMemoryRow(env, userId, {
    scope: input.scope,
    key,
    watchlistId,
    clientRoomId,
  });

  if (existing) {
    await run(
      env,
      `
        UPDATE agent_memory
        SET value_json = ?,
            source = ?,
            updated_at = ?
        WHERE id = ?
      `,
      jsonValue(input.value),
      input.source ?? null,
      timestamp,
      existing.id,
    );

    const row = await one<AgentMemoryRow>(env, "SELECT * FROM agent_memory WHERE id = ?", existing.id);
    return row ? toAgentMemoryRecord(row) : null;
  }

  await run(
    env,
    `
      INSERT OR IGNORE INTO agent_memory (
        id,
        user_id,
        scope,
        memory_key,
        watchlist_id,
        client_room_id,
        value_json,
        source,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    id,
    userId,
    input.scope,
    key,
    watchlistId,
    clientRoomId,
    jsonValue(input.value),
    input.source ?? null,
    timestamp,
    timestamp,
  );

  const row = await findAgentMemoryRow(env, userId, {
    scope: input.scope,
    key,
    watchlistId,
    clientRoomId,
  });

  if (row && row.id !== id) {
    await run(
      env,
      `
        UPDATE agent_memory
        SET value_json = ?,
            source = ?,
            updated_at = ?
        WHERE id = ?
      `,
      jsonValue(input.value),
      input.source ?? null,
      timestamp,
      row.id,
    );
    const updated = await one<AgentMemoryRow>(env, "SELECT * FROM agent_memory WHERE id = ?", row.id);
    return updated ? toAgentMemoryRecord(updated) : null;
  }

  return row ? toAgentMemoryRecord(row) : null;
}

async function findAgentMemoryRow(
  env: AppEnv,
  userId: string,
  input: {
    scope: AgentMemoryScope;
    key: string;
    watchlistId: string | null;
    clientRoomId: string | null;
  },
) {
  return one<AgentMemoryRow>(
    env,
    `
      SELECT *
      FROM agent_memory
      WHERE user_id = ?
        AND scope = ?
        AND memory_key = ?
        AND watchlist_id IS ?
        AND client_room_id IS ?
      LIMIT 1
    `,
    userId,
    input.scope,
    input.key,
    input.watchlistId,
    input.clientRoomId,
  );
}

export async function listAgentMemory(
  env: AppEnv,
  userId: string,
  options: {
    scope?: AgentMemoryScope | null;
    watchlistId?: string | null;
    clientRoomId?: string | null;
    limit?: number | null;
  } = {},
) {
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 50)));
  const clauses = ["user_id = ?"];
  const bindings: unknown[] = [userId];

  if (options.scope) {
    clauses.push("scope = ?");
    bindings.push(options.scope);
  }
  if (typeof options.watchlistId !== "undefined") {
    clauses.push(options.watchlistId ? "watchlist_id = ?" : "watchlist_id IS NULL");
    if (options.watchlistId) {
      bindings.push(options.watchlistId);
    }
  }
  if (typeof options.clientRoomId !== "undefined") {
    clauses.push(options.clientRoomId ? "client_room_id = ?" : "client_room_id IS NULL");
    if (options.clientRoomId) {
      bindings.push(options.clientRoomId);
    }
  }

  const rows = await many<AgentMemoryRow>(
    env,
    `
      SELECT *
      FROM agent_memory
      WHERE ${clauses.join(" AND ")}
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    ...bindings,
    limit,
  );

  return rows.map(toAgentMemoryRecord);
}

export async function getClientRoom(env: AppEnv, userId: string, roomId: string) {
  const row = await one<ClientRoomRow>(
    env,
    `
      SELECT *
      FROM client_room
      WHERE id = ?
        AND user_id = ?
      LIMIT 1
    `,
    roomId,
    userId,
  );

  return row ? toClientRoomRecord(row, await listClientRoomResourceRefs(env, userId, row.id)) : null;
}

export async function upsertClientRoom(
  env: AppEnv,
  userId: string,
  input: {
    roomId?: string | null;
    name: string;
    clientLabel?: string | null;
    status?: ClientRoomRecord["status"] | null;
    resourceRefs?: ClientRoomResourceRef[] | null;
    notes?: JsonRecord | null;
  },
) {
  const timestamp = nowIso();
  const name = input.name.trim();
  const status = input.status ?? "active";
  const clientLabel = input.clientLabel?.trim() || null;
  const hasResourceRefs = Array.isArray(input.resourceRefs);
  const hasNotes = Object.prototype.hasOwnProperty.call(input, "notes");
  const notesJson = hasNotes ? jsonValue(input.notes ?? {}) : null;

  if (input.roomId) {
    await run(
      env,
      `
        UPDATE client_room
        SET name = ?,
            client_label = ?,
            status = ?,
            notes_json = CASE WHEN ? = 1 THEN ? ELSE notes_json END,
            updated_at = ?
        WHERE id = ?
          AND user_id = ?
      `,
      name,
      clientLabel,
      status,
      hasNotes ? 1 : 0,
      notesJson,
      timestamp,
      input.roomId,
      userId,
    );

    if (hasResourceRefs) {
      await replaceClientRoomResourceRefs(env, userId, input.roomId, input.resourceRefs ?? []);
    }

    return getClientRoom(env, userId, input.roomId);
  }

  const id = createId();
  await run(
    env,
    `
      INSERT INTO client_room (
        id,
        user_id,
        name,
        client_label,
        status,
        notes_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, name)
      DO UPDATE SET client_label = excluded.client_label,
                    status = excluded.status,
                    notes_json = CASE WHEN ? = 1 THEN excluded.notes_json ELSE client_room.notes_json END,
                    updated_at = excluded.updated_at
    `,
    id,
    userId,
    name,
    clientLabel,
    status,
    notesJson ?? jsonValue({}),
    timestamp,
    timestamp,
    hasNotes ? 1 : 0,
  );

  const row = await one<ClientRoomRow>(
    env,
    `
      SELECT *
      FROM client_room
      WHERE user_id = ?
        AND name = ?
      LIMIT 1
    `,
    userId,
    name,
  );

  if (row && hasResourceRefs) {
    await replaceClientRoomResourceRefs(env, userId, row.id, input.resourceRefs ?? []);
  }

  return row ? toClientRoomRecord(row, await listClientRoomResourceRefs(env, userId, row.id)) : null;
}

export async function listClientRooms(
  env: AppEnv,
  userId: string,
  options: {
    status?: ClientRoomRecord["status"] | "all" | null;
    limit?: number | null;
  } = {},
) {
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 50)));
  const status = options.status ?? "active";
  const rows = status === "all"
    ? await many<ClientRoomRow>(
      env,
      `
        SELECT *
        FROM client_room
        WHERE user_id = ?
        ORDER BY updated_at DESC
        LIMIT ?
      `,
      userId,
      limit,
    )
    : await many<ClientRoomRow>(
      env,
      `
        SELECT *
        FROM client_room
        WHERE user_id = ?
          AND status = ?
        ORDER BY updated_at DESC
        LIMIT ?
      `,
      userId,
      status,
      limit,
    );

  return Promise.all(
    rows.map(async (row) => toClientRoomRecord(row, await listClientRoomResourceRefs(env, userId, row.id))),
  );
}

async function replaceClientRoomResourceRefs(
  env: AppEnv,
  userId: string,
  roomId: string,
  refs: ClientRoomResourceRef[],
) {
  const timestamp = nowIso();
  await run(
    env,
    `
      DELETE FROM client_room_resource
      WHERE room_id = ?
        AND user_id = ?
    `,
    roomId,
    userId,
  );

  for (const ref of refs) {
    await run(
      env,
      `
        INSERT INTO client_room_resource (
          id,
          room_id,
          user_id,
          resource_type,
          resource_id,
          label,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      createId(),
      roomId,
      userId,
      ref.resourceType,
      ref.resourceId,
      ref.label?.trim() || null,
      timestamp,
    );
  }
}

async function listClientRoomResourceRefs(env: AppEnv, userId: string, roomId: string) {
  const rows = await many<ClientRoomResourceRow>(
    env,
    `
      SELECT *
      FROM client_room_resource
      WHERE room_id = ?
        AND user_id = ?
      ORDER BY created_at ASC
    `,
    roomId,
    userId,
  );

  return rows.map((row) => ({
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    ...(row.label ? { label: row.label } : {}),
  }));
}

export async function upsertAd(env: AppEnv, ad: AdRecord) {
  if (!env.DB) {
    console.warn(
      `[data.server] upsertAd called without a D1 binding; ad ${ad.metaAdId} was NOT persisted. ` +
        `Check wrangler.jsonc and the deploy environment.`,
    );
    return;
  }

  await upsertAdImpl(env, ad);
}

function ensureDb(env: AppEnv) {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is not configured.");
  }

  return env.DB;
}

async function many<T>(env: AppEnv, sql: string, ...bindings: unknown[]) {
  const db = ensureDb(env);
  const result = await db.prepare(sql).bind(...bindings).all<T>();
  return result.results ?? [];
}

async function one<T>(env: AppEnv, sql: string, ...bindings: unknown[]) {
  const rows = await many<T>(env, sql, ...bindings);
  return rows[0] ?? null;
}

async function run(env: AppEnv, sql: string, ...bindings: unknown[]) {
  const db = ensureDb(env);
  await db.prepare(sql).bind(...bindings).run();
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isAdDiscoverySource(value: unknown): value is SearchResponse["source"] {
  return (
    value === "meta" ||
    value === "meta_api" ||
    value === "meta_library_browser" ||
    value === "demo" ||
    value === "external"
  );
}

function parseDiscoveryCachePayload(value: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const candidate = parsed as Partial<SearchResponse>;
  if (
    !Array.isArray(candidate.ads) ||
    (candidate.nextCursor !== null && typeof candidate.nextCursor !== "string") ||
    !isAdDiscoverySource(candidate.source)
  ) {
    return null;
  }

  return candidate as SearchResponse;
}

function jsonValue(value: unknown) {
  return JSON.stringify(value ?? null);
}

function boolToInt(value: boolean) {
  return value ? 1 : 0;
}

export function legacyWatchEventImportanceScore(eventType: WatchEventType) {
  switch (eventType) {
    case "landing_page_url_changed":
      return 85;
    case "landing_page_headline_changed":
      return 75;
    case "ad_new":
      return 65;
    case "ad_inactive":
      return 60;
    default:
      return 0;
  }
}

export function legacyWorkspaceDeliveryDefaults(input: { hasEmail: boolean }) {
  return {
    sensitivityMode: "balanced" as const,
    instantEnabled: false,
    digestEnabled: true,
    emailEnabled: input.hasEmail,
    whatsappEnabled: false,
    slackEnabled: false,
  };
}

function toSavedQueryRecord(row: SavedQueryRow): SavedQueryRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    mode: row.mode,
    queryText: row.query_text,
    normalizedQuery: parseJson<NormalizedSavedQuery>(row.normalized_query_json, normalizeSavedQuery("advertiser", {})),
    fingerprint: row.fingerprint,
    runCount: row.run_count,
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCollectionRecord(row: CollectionRow): CollectionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toWatchlistRecord(row: WatchlistRow): WatchlistRecord {
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

function toWatchlistRunRecord(row: WatchlistRunRow): WatchlistRunRecord {
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

function toWatchEventRecord(row: WatchEventRow): WatchEventRecord {
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

function toEventCandidateRecord(row: EventCandidateRow): EventCandidateRecord {
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

function toProofTargetRecord(row: ProofTargetRow): ProofTargetRecord {
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

function toProofCaptureRecord(row: ProofCaptureRow): ProofCaptureRecord {
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

function toWorkspaceDeliveryConfigRecord(
  row: WorkspaceDeliveryConfigRow,
): WorkspaceDeliveryConfigRecord {
  return {
    id: row.id,
    userId: row.user_id,
    sensitivityMode: row.sensitivity_mode,
    instantEnabled: row.instant_enabled === 1,
    digestEnabled: row.digest_enabled === 1,
    emailEnabled: row.email_enabled === 1,
    whatsappEnabled: row.whatsapp_enabled === 1,
    slackEnabled: row.slack_enabled === 1,
    quietHours: parseJson<DeliveryQuietHours | null>(row.quiet_hours_json, null),
    timezone: row.timezone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toWatchlistDeliveryConfigRecord(
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
    quietHours: parseJson<DeliveryQuietHours | null>(row.quiet_hours_json, null),
    timezone: row.timezone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDeliveryTargetRecord(row: DeliveryTargetRow): DeliveryTargetRecord {
  return {
    id: row.id,
    userId: row.user_id,
    watchlistId: row.watchlist_id,
    channel: row.channel,
    targetValue: row.target_value,
    validationStatus: row.validation_status,
    isValidated: row.is_validated === 1,
    isOptedIn: row.is_opted_in === 1,
    optInSource: row.opt_in_source,
    optedInAt: row.opted_in_at,
    isPaused: row.is_paused === 1,
    pausedAt: row.paused_at,
    optedOutAt: row.opted_out_at,
    templateEligible: row.template_eligible === 1,
    lastSuccessfulDeliveryAt: row.last_successful_delivery_at,
    lastSuccessfulAttemptId: row.last_successful_attempt_id,
    providerIdentifier: row.provider_identifier,
    metadata: parseJson<JsonRecord>(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDigestItemRecord(row: DigestItemRow): DigestItemRecord {
  return {
    id: row.id,
    digestRunId: row.digest_run_id,
    watchlistId: row.watchlist_id,
    watchlistName: row.watchlist_name,
    eventType: row.event_type,
    title: row.title,
    summary: row.summary,
    metadata: parseJson<JsonRecord>(row.metadata_json, {}),
    createdAt: row.created_at,
  };
}

function toDigestDeliveryRecord(row: DigestDeliveryRow): DigestDeliveryRecord {
  return {
    id: row.id,
    digestRunId: row.digest_run_id,
    provider: row.provider,
    status: row.status,
    recipientEmail: row.recipient_email,
    externalMessageId: row.external_message_id,
    errorMessage: row.error_message,
    deliveredAt: row.delivered_at,
  };
}

function toDeliveryAttemptRecord(row: DeliveryAttemptRow): DeliveryAttemptRecord {
  return {
    id: row.id,
    userId: row.user_id,
    watchlistId: row.watchlist_id,
    digestRunId: row.digest_run_id,
    deliveryTargetId: row.delivery_target_id,
    lane: row.lane,
    channel: row.channel,
    provider: row.provider,
    status: row.status,
    webhookStatus: row.webhook_status,
    targetValue: row.target_value,
    providerMessageId: row.provider_message_id,
    providerStatusLastSeenAt: row.provider_status_last_seen_at,
    templateName: row.template_name,
    eventIds: parseJson<string[]>(row.event_ids_json, []),
    payloadSnapshot: parseJson<JsonRecord>(row.payload_snapshot_json, {}),
    idempotencyKey: row.idempotency_key,
    errorMessage: row.error_message,
    sentAt: row.sent_at,
    failedAt: row.failed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function recordPendingRazorpaySubscription(
  env: AppEnv,
  input: {
    userId: string;
    subscriptionId: string;
    customerId: string | null;
    providerPlanId: string | null;
    status: string;
  },
) {
  await run(
    env,
    `
      INSERT INTO user_plan (
        user_id,
        plan,
        razorpay_customer_id,
        razorpay_subscription_id,
        razorpay_plan_id,
        razorpay_status,
        plan_updated_at
      )
      VALUES (?, 'free', ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id)
      DO UPDATE SET
        razorpay_customer_id = excluded.razorpay_customer_id,
        razorpay_subscription_id = excluded.razorpay_subscription_id,
        razorpay_plan_id = excluded.razorpay_plan_id,
        razorpay_status = excluded.razorpay_status,
        plan_updated_at = excluded.plan_updated_at
    `,
    input.userId,
    input.customerId,
    input.subscriptionId,
    input.providerPlanId,
    input.status,
  );
}

export async function syncRazorpaySubscriptionStatus(
  env: AppEnv,
  input: {
    userId: string;
    plan: "starter" | "agency";
    status: string;
    subscriptionId: string;
    customerId: string | null;
    providerPlanId: string | null;
    shouldGrant: boolean;
    shouldRevoke: boolean;
  },
) {
  if (input.shouldRevoke) {
    const current = await one<{ razorpay_subscription_id: string | null }>(
      env,
      "SELECT razorpay_subscription_id FROM user_plan WHERE user_id = ?",
      input.userId,
    );
    if (current?.razorpay_subscription_id !== input.subscriptionId) {
      return;
    }
  }

  const nextPlan = input.shouldGrant ? input.plan : input.shouldRevoke ? "free" : null;

  if (nextPlan) {
    await run(
      env,
      `
        INSERT INTO user_plan (
          user_id,
          plan,
          razorpay_customer_id,
          razorpay_subscription_id,
          razorpay_plan_id,
          razorpay_status,
          plan_updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id)
        DO UPDATE SET
          plan = excluded.plan,
          razorpay_customer_id = excluded.razorpay_customer_id,
          razorpay_subscription_id = excluded.razorpay_subscription_id,
          razorpay_plan_id = excluded.razorpay_plan_id,
          razorpay_status = excluded.razorpay_status,
          plan_updated_at = excluded.plan_updated_at
      `,
      input.userId,
      nextPlan,
      input.customerId,
      input.subscriptionId,
      input.providerPlanId,
      input.status,
    );
    return;
  }

  await recordPendingRazorpaySubscription(env, {
    userId: input.userId,
    subscriptionId: input.subscriptionId,
    customerId: input.customerId,
    providerPlanId: input.providerPlanId,
    status: input.status,
  });
}

export async function claimRazorpayWebhookEvent(
  env: AppEnv,
  input: {
    eventId: string;
    eventType: string;
    subscriptionId: string | null;
    userId: string | null;
    payloadCreatedAt: string | null;
  },
) {
  const db = ensureDb(env);
  const result = await db.prepare(`
      INSERT INTO razorpay_webhook_event (
        event_id,
        event_type,
        subscription_id,
        user_id,
        received_at,
        payload_created_at,
        outcome,
        metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, 'received', '{}')
      ON CONFLICT(event_id)
      DO UPDATE SET
        event_type = excluded.event_type,
        subscription_id = excluded.subscription_id,
        user_id = excluded.user_id,
        received_at = excluded.received_at,
        payload_created_at = excluded.payload_created_at,
        processed_at = NULL,
        outcome = 'received',
        metadata_json = '{}'
      WHERE razorpay_webhook_event.outcome = 'failed'
    `).bind(
      input.eventId,
      input.eventType,
      input.subscriptionId,
      input.userId,
      nowIso(),
      input.payloadCreatedAt,
    ).run();

  return Number(result.meta?.changes ?? 0) > 0;
}

export async function markRazorpayWebhookEventFinished(
  env: AppEnv,
  eventId: string,
  input: {
    outcome: Exclude<RazorpayWebhookOutcome, "received">;
    metadata?: JsonRecord;
  },
) {
  await run(
    env,
    `
      UPDATE razorpay_webhook_event
      SET outcome = ?,
          processed_at = ?,
          metadata_json = ?
      WHERE event_id = ?
    `,
    input.outcome,
    nowIso(),
    jsonValue(input.metadata ?? {}),
    eventId,
  );
}

export async function grantProofUsageCredit(
  env: AppEnv,
  input: {
    userId: string;
    providerPaymentId: string;
    providerProductId: string;
    bundleSlug: string;
    credits: number;
    quantity: number;
    grantedAt?: string;
    expiresAt: string;
    metadata?: JsonRecord;
  },
) {
  await run(
    env,
    `
      INSERT INTO proof_usage_credit (
        id,
        user_id,
        provider,
        provider_payment_id,
        provider_product_id,
        bundle_slug,
        credits,
        quantity,
        granted_at,
        expires_at,
        metadata_json
      )
      VALUES (?, ?, 'dodo', ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_payment_id) DO NOTHING
    `,
    createId(),
    input.userId,
    input.providerPaymentId,
    input.providerProductId,
    input.bundleSlug,
    Math.max(0, Math.floor(input.credits)),
    Math.max(1, Math.floor(input.quantity)),
    input.grantedAt ?? nowIso(),
    input.expiresAt,
    jsonValue(input.metadata ?? {}),
  );
}

export async function grantDodoPlanAccess(
  env: AppEnv,
  input: {
    userId: string;
    plan: "scout" | "starter" | "agency";
    providerPaymentId: string | null;
    providerProductId: string | null;
    providerSubscriptionId?: string | null;
    providerCustomerId?: string | null;
    nextBillingAt?: string | null;
    status: string;
    grantedAt?: string;
    metadata?: JsonRecord;
  },
) {
  const planUpdatedAt = validIsoTimestamp(input.grantedAt) ?? nowIso();

  // COALESCE keeps existing linkage when an event doesn't carry it: payment
  // events lack next_billing_date, subscription events lack a payment id.
  await run(
    env,
    `
      INSERT INTO user_plan (
        user_id,
        plan,
        dodo_payment_id,
        dodo_product_id,
        dodo_subscription_id,
        dodo_customer_id,
        dodo_next_billing_at,
        dodo_status,
        plan_updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id)
      DO UPDATE SET
        plan = excluded.plan,
        dodo_payment_id = COALESCE(excluded.dodo_payment_id, user_plan.dodo_payment_id),
        dodo_product_id = COALESCE(excluded.dodo_product_id, user_plan.dodo_product_id),
        dodo_subscription_id = COALESCE(excluded.dodo_subscription_id, user_plan.dodo_subscription_id),
        dodo_customer_id = COALESCE(excluded.dodo_customer_id, user_plan.dodo_customer_id),
        dodo_next_billing_at = COALESCE(excluded.dodo_next_billing_at, user_plan.dodo_next_billing_at),
        dodo_status = excluded.dodo_status,
        plan_updated_at = excluded.plan_updated_at
      WHERE
        (excluded.dodo_payment_id IS NOT NULL AND user_plan.dodo_payment_id = excluded.dodo_payment_id)
        OR julianday(excluded.plan_updated_at) >= julianday(user_plan.plan_updated_at)
    `,
    input.userId,
    input.plan,
    input.providerPaymentId ?? null,
    input.providerProductId ?? null,
    input.providerSubscriptionId ?? null,
    input.providerCustomerId ?? null,
    input.nextBillingAt ?? null,
    input.status,
    planUpdatedAt,
  );
}

// Dodo checkout links are payable for 24 hours by default, so the local lock
// must last at least as long as the provider session can still be completed.
export const DODO_PLAN_CHECKOUT_LOCK_MINUTES = 24 * 60;

export async function claimDodoPlanCheckout(
  env: AppEnv,
  input: {
    userId: string;
    claimedAt?: string;
    staleAfterMinutes?: number;
  },
) {
  const claimedAt = validIsoTimestamp(input.claimedAt) ?? nowIso();
  const staleAfterMs =
    Math.max(
      DODO_PLAN_CHECKOUT_LOCK_MINUTES,
      input.staleAfterMinutes ?? DODO_PLAN_CHECKOUT_LOCK_MINUTES,
    ) *
    60 *
    1000;
  const staleBefore = new Date(Date.parse(claimedAt) - staleAfterMs).toISOString();
  const db = ensureDb(env);
  const result = await db.prepare(`
      INSERT INTO user_plan (
        user_id,
        plan,
        dodo_status,
        plan_updated_at
      )
      VALUES (?, 'free', 'checkout_pending', ?)
      ON CONFLICT(user_id)
      DO UPDATE SET
        dodo_status = 'checkout_pending',
        plan_updated_at = excluded.plan_updated_at
      WHERE user_plan.plan = 'free'
        AND (
          user_plan.dodo_status IS NULL
          OR user_plan.dodo_status != 'checkout_pending'
          OR julianday(user_plan.plan_updated_at) <= julianday(?)
        )
    `)
    .bind(input.userId, claimedAt, staleBefore)
    .run();

  return Number(result.meta?.changes ?? 0) > 0;
}

export async function clearDodoPlanCheckout(env: AppEnv, userId: string) {
  await run(
    env,
    `
      UPDATE user_plan
      SET dodo_status = NULL
      WHERE user_id = ?
        AND plan = 'free'
        AND dodo_status = 'checkout_pending'
    `,
    userId,
  );
}

export async function revokeDodoPlanAccess(
  env: AppEnv,
  input: {
    userId: string;
    providerSubscriptionId: string;
    status: string;
    revokedAt?: string;
  },
) {
  const planUpdatedAt = validIsoTimestamp(input.revokedAt) ?? nowIso();

  // Mirrors grantDodoPlanAccess's monotonic guard so a late-arriving older
  // payment webhook can never resurrect a newer cancellation (and vice versa).
  await run(
    env,
    `
      INSERT INTO user_plan (
        user_id,
        plan,
        dodo_payment_id,
        dodo_status,
        plan_updated_at
      )
      VALUES (?, 'free', ?, ?, ?)
      ON CONFLICT(user_id)
      DO UPDATE SET
        plan = 'free',
        dodo_payment_id = excluded.dodo_payment_id,
        dodo_status = excluded.dodo_status,
        plan_updated_at = excluded.plan_updated_at
      WHERE julianday(excluded.plan_updated_at) >= julianday(user_plan.plan_updated_at)
    `,
    input.userId,
    input.providerSubscriptionId,
    input.status,
    planUpdatedAt,
  );
}

export async function claimDodoWebhookEvent(
  env: AppEnv,
  input: {
    eventId: string;
    eventType: string;
    userId: string | null;
    payloadTimestamp: string | null;
  },
) {
  const db = ensureDb(env);
  const receivedAt = nowIso();
  // Mirrors claimRazorpayWebhookEvent: first delivery claims the event;
  // redeliveries of processed events are skipped; failed events may be
  // reclaimed so processing can retry.
  let result: D1Result;
  try {
    result = await db.prepare(`
      INSERT INTO dodo_webhook_event (
        event_id,
        event_type,
        user_id,
        received_at,
        payload_timestamp,
        outcome,
        metadata_json
      )
      VALUES (?, ?, ?, ?, ?, 'received', '{}')
      ON CONFLICT(event_id)
      DO UPDATE SET
        event_type = excluded.event_type,
        user_id = excluded.user_id,
        received_at = excluded.received_at,
        payload_timestamp = excluded.payload_timestamp,
        processed_at = NULL,
        outcome = 'received',
        metadata_json = '{}'
      WHERE dodo_webhook_event.outcome = 'failed'
    `).bind(
      input.eventId,
      input.eventType,
      input.userId,
      receivedAt,
      input.payloadTimestamp,
    ).run();
  } catch (error) {
    if (!isMissingDodoPayloadTimestampColumnError(error)) {
      throw error;
    }

    result = await db.prepare(`
        INSERT INTO dodo_webhook_event (
          event_id,
          event_type,
          user_id,
          received_at,
          outcome,
          metadata_json
        )
        VALUES (?, ?, ?, ?, 'received', '{}')
        ON CONFLICT(event_id)
        DO UPDATE SET
          event_type = excluded.event_type,
          user_id = excluded.user_id,
          received_at = excluded.received_at,
          processed_at = NULL,
          outcome = 'received',
          metadata_json = '{}'
        WHERE dodo_webhook_event.outcome = 'failed'
      `).bind(
        input.eventId,
        input.eventType,
        input.userId,
        receivedAt,
      ).run();
  }

  return Number(result.meta?.changes ?? 0) > 0;
}

function isMissingDodoPayloadTimestampColumnError(error: unknown) {
  return (
    error instanceof Error &&
    /dodo_webhook_event has no column named payload_timestamp/i.test(error.message)
  );
}

export async function markDodoWebhookEventFinished(
  env: AppEnv,
  eventId: string,
  input: {
    outcome: "processed" | "ignored" | "failed";
    metadata?: JsonRecord;
  },
) {
  await run(
    env,
    `
      UPDATE dodo_webhook_event
      SET outcome = ?,
          processed_at = ?,
          metadata_json = ?
      WHERE event_id = ?
    `,
    input.outcome,
    nowIso(),
    jsonValue(input.metadata ?? {}),
    eventId,
  );
}

export async function markDodoPlanPaymentIssue(
  env: AppEnv,
  input: {
    userId: string;
    status: string;
    occurredAt?: string;
  },
) {
  const planUpdatedAt = validIsoTimestamp(input.occurredAt) ?? nowIso();

  // Dunning state (subscription.failed / on_hold): the customer keeps the
  // paid plan while Dodo retries the payment; only dodo_status changes so
  // the app can surface a payment-issue notice. The monotonic guard keeps a
  // late-arriving stale event from overwriting a newer grant or revocation.
  await run(
    env,
    `
      UPDATE user_plan
      SET dodo_status = ?,
          plan_updated_at = ?
      WHERE user_id = ?
        AND plan != 'free'
        AND julianday(?) >= julianday(plan_updated_at)
    `,
    input.status,
    planUpdatedAt,
    input.userId,
    planUpdatedAt,
  );
}

export async function revokeDodoAccessForRefundedPayment(
  env: AppEnv,
  input: {
    paymentId: string;
    refundedAt?: string;
  },
) {
  const refundedAt = validIsoTimestamp(input.refundedAt) ?? nowIso();

  // A full refund undoes whatever the payment bought. Plan payments are
  // matched via user_plan.dodo_payment_id; usage-bundle payments via
  // proof_usage_credit.provider_payment_id (its credits expire immediately).
  await run(
    env,
    `
      UPDATE user_plan
      SET plan = 'free',
          dodo_status = 'refunded',
          plan_updated_at = ?
      WHERE dodo_payment_id = ?
        AND julianday(?) >= julianday(plan_updated_at)
    `,
    refundedAt,
    input.paymentId,
    refundedAt,
  );

  await run(
    env,
    `
      UPDATE proof_usage_credit
      SET expires_at = ?
      WHERE provider_payment_id = ?
        AND julianday(expires_at) > julianday(?)
    `,
    refundedAt,
    input.paymentId,
    refundedAt,
  );
}

export async function getUserIdForDodoPayment(env: AppEnv, paymentId: string) {
  const row = await one<{ user_id: string }>(
    env,
    "SELECT user_id FROM user_plan WHERE dodo_payment_id = ? LIMIT 1",
    paymentId,
  );
  return row?.user_id ?? null;
}

export async function getUserIdForDodoLifecycle(
  env: AppEnv,
  input: {
    subscriptionId?: string | null;
    customerId?: string | null;
    customerEmail?: string | null;
  },
) {
  const subscriptionId = input.subscriptionId?.trim();
  if (subscriptionId) {
    const row = await one<{ user_id: string }>(
      env,
      "SELECT user_id FROM user_plan WHERE dodo_subscription_id = ? AND plan != 'free' LIMIT 1",
      subscriptionId,
    );
    if (row?.user_id) return row.user_id;
  }

  const customerId = input.customerId?.trim();
  if (customerId) {
    const row = await one<{ user_id: string }>(
      env,
      "SELECT user_id FROM user_plan WHERE dodo_customer_id = ? AND plan != 'free' ORDER BY plan_updated_at DESC LIMIT 1",
      customerId,
    );
    if (row?.user_id) return row.user_id;
  }

  const customerEmail = input.customerEmail?.trim();
  if (customerEmail) {
    const row = await one<{ user_id: string }>(
      env,
      `
        SELECT user.id AS user_id
        FROM user
        INNER JOIN user_plan
          ON user_plan.user_id = user.id
        WHERE user.email = ? COLLATE NOCASE
          AND user_plan.plan != 'free'
          AND (
            user_plan.dodo_payment_id IS NOT NULL
            OR user_plan.dodo_product_id IS NOT NULL
            OR user_plan.dodo_status IS NOT NULL
            OR user_plan.dodo_subscription_id IS NOT NULL
            OR user_plan.dodo_customer_id IS NOT NULL
          )
        ORDER BY user_plan.plan_updated_at DESC
        LIMIT 1
      `,
      customerEmail,
    );
    if (row?.user_id) return row.user_id;
  }

  return null;
}

export async function deactivateWatchlistsBeyondPlanLimit(
  env: AppEnv,
  userId: string,
  keepActive: number,
) {
  // On downgrade/revocation, watchlists beyond the new plan's limit stop
  // scanning (newest stay active). Rows are deactivated, never deleted, so
  // re-subscribing brings the history back.
  const db = ensureDb(env);
  const timestamp = nowIso();
  const result = await db
    .prepare(
      `
        UPDATE watchlist
        SET is_active = 0,
            paused_reason = 'plan_limit',
            updated_at = ?
        WHERE user_id = ?
          AND is_active = 1
          AND id NOT IN (
            SELECT id
            FROM watchlist
            WHERE user_id = ?
              AND is_active = 1
            ORDER BY created_at DESC
            LIMIT ?
          )
      `,
    )
    .bind(timestamp, userId, userId, Math.max(0, Math.floor(keepActive)))
    .run();

  const changed = Number(result.meta?.changes ?? 0);
  if (changed > 0) {
    await syncWebMentionTargetsForUser(env, userId, timestamp);
  }
  return changed;
}

// After a verified email change, the auto-provisioned delivery target still
// points at the OLD address — and because any usable target short-circuits
// auto-provisioning, the customer's digests/alerts would silently keep going
// to an inbox they may have lost. Retarget those rows to the new address.
export async function migrateAutoProvisionedEmailTargets(
  env: AppEnv,
  userId: string,
  newEmail: string,
) {
  const db = ensureDb(env);
  const timestamp = nowIso();

  // UPDATE OR IGNORE skips rows whose new-address twin already exists
  // (unique indexes on user/watchlist/channel/value)…
  const updated = await db
    .prepare(
      `
        UPDATE OR IGNORE delivery_target
        SET target_value = ?,
            validation_status = 'validated',
            is_validated = 1,
            updated_at = ?
        WHERE user_id = ?
          AND channel = 'email'
          AND opt_in_source = 'account_email'
          AND opted_out_at IS NULL
          AND target_value != ?
      `,
    )
    .bind(newEmail, timestamp, userId, newEmail)
    .run();

  // …and any stale row that couldn't be updated (twin existed) is removed.
  await db
    .prepare(
      `
        DELETE FROM delivery_target
        WHERE user_id = ?
          AND channel = 'email'
          AND opt_in_source = 'account_email'
          AND opted_out_at IS NULL
          AND target_value != ?
      `,
    )
    .bind(userId, newEmail)
    .run();

  return Number(updated.meta?.changes ?? 0);
}

export async function hasInFlightWatchlistRun(
  env: AppEnv,
  watchlistId: string,
  sinceIso: string,
) {
  const row = await one<{ id: string }>(
    env,
    `
      SELECT id
      FROM watchlist_run
      WHERE watchlist_id = ?
        AND status IN ('pending', 'running')
        AND started_at >= ?
      LIMIT 1
    `,
    watchlistId,
    sinceIso,
  );
  return Boolean(row);
}

export async function getOldestUserId(env: AppEnv) {
  const row = await one<{ id: string }>(
    env,
    "SELECT id FROM user ORDER BY created_at ASC LIMIT 1",
  );
  return row?.id ?? null;
}

export async function getUserIdByEmail(env: AppEnv, email: string) {
  const row = await one<{ id: string }>(
    env,
    "SELECT id FROM user WHERE email = ? COLLATE NOCASE LIMIT 1",
    email.trim(),
  );
  return row?.id ?? null;
}

export async function getStytchSessionByToken(env: AppEnv, sessionToken: string): Promise<AppSession | null> {
  const tokenHash = await stytchSessionTokenHash(sessionToken);
  const row = await one<{
    sessionId: string;
    sessionUserId: string;
    expiresAt: string;
    id: string;
    email: string;
    name: string;
    image: string | null;
    onboardedAt: string | null;
  }>(
    env,
    `
      SELECT stytch_session.member_session_id AS sessionId,
             stytch_session.user_id AS sessionUserId,
             stytch_session.expires_at AS expiresAt,
             user.id,
             user.email,
             user.name,
             user.image,
             user.onboardedAt
      FROM stytch_session
      JOIN user ON user.id = stytch_session.user_id
      WHERE stytch_session.session_token_hash = ?
        AND stytch_session.expires_at > ?
      LIMIT 1
    `,
    tokenHash,
    new Date().toISOString(),
  );

  if (!row) {
    return null;
  }

  return {
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      image: row.image,
      onboardedAt: row.onboardedAt,
    },
    session: {
      id: row.sessionId,
      userId: row.sessionUserId,
      expiresAt: row.expiresAt,
    },
  };
}

export async function storeStytchSession(
  env: AppEnv,
  input: {
    sessionToken: string;
    userId: string;
    memberSessionId: string;
    expiresAt: string;
  },
) {
  const now = new Date().toISOString();
  await run(
    env,
    `
      INSERT INTO stytch_session (
        session_token_hash, user_id, member_session_id, expires_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_token_hash) DO UPDATE SET
        user_id = excluded.user_id,
        member_session_id = excluded.member_session_id,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `,
    await stytchSessionTokenHash(input.sessionToken),
    input.userId,
    input.memberSessionId,
    input.expiresAt,
    now,
    now,
  );
}

export async function deleteStytchSessionByToken(env: AppEnv, sessionToken: string) {
  await run(
    env,
    "DELETE FROM stytch_session WHERE session_token_hash = ?",
    await stytchSessionTokenHash(sessionToken),
  );
}

export interface StytchIdentityRecord {
  userId: string;
  stytchOrganizationId: string;
  stytchMemberId: string;
  organizationName: string | null;
  organizationSlug: string | null;
}

export async function getStytchIdentityForUser(
  env: AppEnv,
  userId: string,
): Promise<StytchIdentityRecord | null> {
  return one<StytchIdentityRecord>(
    env,
    `
      SELECT user_id AS userId,
             stytch_organization_id AS stytchOrganizationId,
             stytch_member_id AS stytchMemberId,
             organization_name AS organizationName,
             organization_slug AS organizationSlug
      FROM stytch_identity
      WHERE user_id = ?
      LIMIT 1
    `,
    userId,
  );
}

export interface PasskeyCredentialRecord {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  stytchOrganizationId: string;
  stytchMemberId: string;
  organizationName: string | null;
  organizationSlug: string | null;
  credentialId: string;
  webauthnUserId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  deviceType: string;
  backedUp: boolean;
  label: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

interface PasskeyCredentialRow {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  stytchOrganizationId: string;
  stytchMemberId: string;
  organizationName: string | null;
  organizationSlug: string | null;
  credentialId: string;
  webauthnUserId: string;
  publicKey: string;
  counter: number;
  transportsJson: string | null;
  deviceType: string;
  backedUp: number;
  label: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

export async function listPasskeyCredentialsForUser(env: AppEnv, userId: string) {
  const rows = await many<PasskeyCredentialRow>(
    env,
    `
      SELECT passkey_credential.id,
             passkey_credential.user_id AS userId,
             user.email AS userEmail,
             user.name AS userName,
             passkey_credential.stytch_organization_id AS stytchOrganizationId,
             passkey_credential.stytch_member_id AS stytchMemberId,
             stytch_identity.organization_name AS organizationName,
             stytch_identity.organization_slug AS organizationSlug,
             passkey_credential.credential_id AS credentialId,
             passkey_credential.webauthn_user_id AS webauthnUserId,
             passkey_credential.public_key AS publicKey,
             passkey_credential.counter,
             passkey_credential.transports_json AS transportsJson,
             passkey_credential.device_type AS deviceType,
             passkey_credential.backed_up AS backedUp,
             passkey_credential.label,
             passkey_credential.created_at AS createdAt,
             passkey_credential.updated_at AS updatedAt,
             passkey_credential.last_used_at AS lastUsedAt
      FROM passkey_credential
      JOIN user ON user.id = passkey_credential.user_id
      LEFT JOIN stytch_identity
        ON stytch_identity.stytch_organization_id = passkey_credential.stytch_organization_id
       AND stytch_identity.stytch_member_id = passkey_credential.stytch_member_id
      WHERE passkey_credential.user_id = ?
      ORDER BY passkey_credential.created_at DESC
    `,
    userId,
  );
  return rows.map(mapPasskeyCredentialRow);
}

export async function getPasskeyCredentialByCredentialId(
  env: AppEnv,
  credentialId: string,
): Promise<PasskeyCredentialRecord | null> {
  const row = await one<PasskeyCredentialRow>(
    env,
    `
      SELECT passkey_credential.id,
             passkey_credential.user_id AS userId,
             user.email AS userEmail,
             user.name AS userName,
             passkey_credential.stytch_organization_id AS stytchOrganizationId,
             passkey_credential.stytch_member_id AS stytchMemberId,
             stytch_identity.organization_name AS organizationName,
             stytch_identity.organization_slug AS organizationSlug,
             passkey_credential.credential_id AS credentialId,
             passkey_credential.webauthn_user_id AS webauthnUserId,
             passkey_credential.public_key AS publicKey,
             passkey_credential.counter,
             passkey_credential.transports_json AS transportsJson,
             passkey_credential.device_type AS deviceType,
             passkey_credential.backed_up AS backedUp,
             passkey_credential.label,
             passkey_credential.created_at AS createdAt,
             passkey_credential.updated_at AS updatedAt,
             passkey_credential.last_used_at AS lastUsedAt
      FROM passkey_credential
      JOIN user ON user.id = passkey_credential.user_id
      LEFT JOIN stytch_identity
        ON stytch_identity.stytch_organization_id = passkey_credential.stytch_organization_id
       AND stytch_identity.stytch_member_id = passkey_credential.stytch_member_id
      WHERE passkey_credential.credential_id = ?
      LIMIT 1
    `,
    credentialId,
  );
  return row ? mapPasskeyCredentialRow(row) : null;
}

export async function insertPasskeyCredential(
  env: AppEnv,
  input: {
    userId: string;
    stytchOrganizationId: string;
    stytchMemberId: string;
    credentialId: string;
    webauthnUserId: string;
    publicKey: string;
    counter: number;
    transports: string[];
    deviceType: string;
    backedUp: boolean;
    label?: string | null;
  },
) {
  const now = new Date().toISOString();
  await run(
    env,
    `
      INSERT INTO passkey_credential (
        user_id, stytch_organization_id, stytch_member_id, credential_id,
        webauthn_user_id, public_key, counter, transports_json, device_type,
        backed_up, label, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    input.userId,
    input.stytchOrganizationId,
    input.stytchMemberId,
    input.credentialId,
    input.webauthnUserId,
    input.publicKey,
    input.counter,
    JSON.stringify(input.transports),
    input.deviceType,
    input.backedUp ? 1 : 0,
    input.label?.trim() || null,
    now,
    now,
  );
}

export async function updatePasskeyCredentialAfterAuthentication(
  env: AppEnv,
  input: {
    credentialId: string;
    counter: number;
    deviceType: string;
    backedUp: boolean;
  },
) {
  const now = new Date().toISOString();
  await run(
    env,
    `
      UPDATE passkey_credential
      SET counter = ?,
          device_type = ?,
          backed_up = ?,
          last_used_at = ?,
          updated_at = ?
      WHERE credential_id = ?
    `,
    input.counter,
    input.deviceType,
    input.backedUp ? 1 : 0,
    now,
    now,
    input.credentialId,
  );
}

export type PasskeyChallengeKind = "registration" | "authentication";

export interface PasskeyChallengeRecord {
  state: string;
  kind: PasskeyChallengeKind;
  userId: string | null;
  challenge: string;
  redirectTo: string | null;
  expiresAt: string;
}

export async function createPasskeyChallenge(
  env: AppEnv,
  input: {
    kind: PasskeyChallengeKind;
    userId?: string | null;
    challenge: string;
    redirectTo?: string | null;
    maxAgeSeconds: number;
  },
) {
  const now = new Date();
  const state = crypto.randomUUID();
  await deleteExpiredPasskeyChallenges(env);
  await run(
    env,
    `
      INSERT INTO passkey_challenge (
        state, kind, user_id, challenge, redirect_to, created_at, updated_at, expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    state,
    input.kind,
    input.userId ?? null,
    input.challenge,
    input.redirectTo ?? null,
    now.toISOString(),
    now.toISOString(),
    new Date(now.getTime() + input.maxAgeSeconds * 1000).toISOString(),
  );
  return state;
}

export async function getLivePasskeyChallenge(
  env: AppEnv,
  input: {
    state: string;
    kind: PasskeyChallengeKind;
  },
): Promise<PasskeyChallengeRecord | null> {
  const row = await one<{
    state: string;
    kind: string;
    userId: string | null;
    challenge: string;
    redirectTo: string | null;
    expiresAt: string;
  }>(
    env,
    `
      SELECT state,
             kind,
             user_id AS userId,
             challenge,
             redirect_to AS redirectTo,
             expires_at AS expiresAt
      FROM passkey_challenge
      WHERE state = ?
        AND kind = ?
        AND consumed_at IS NULL
        AND expires_at > ?
      LIMIT 1
    `,
    input.state,
    input.kind,
    new Date().toISOString(),
  );
  if (!row || (row.kind !== "registration" && row.kind !== "authentication")) {
    return null;
  }
  return {
    state: row.state,
    kind: row.kind,
    userId: row.userId,
    challenge: row.challenge,
    redirectTo: row.redirectTo,
    expiresAt: row.expiresAt,
  };
}

export async function consumePasskeyChallenge(env: AppEnv, state: string) {
  const now = new Date().toISOString();
  await run(
    env,
    `
      UPDATE passkey_challenge
      SET consumed_at = ?,
          updated_at = ?
      WHERE state = ?
    `,
    now,
    now,
    state,
  );
}

export async function deleteExpiredPasskeyChallenges(env: AppEnv) {
  await run(env, "DELETE FROM passkey_challenge WHERE expires_at <= ?", new Date().toISOString());
}

function mapPasskeyCredentialRow(row: PasskeyCredentialRow): PasskeyCredentialRecord {
  const transports = parseJson<string[]>(row.transportsJson, []);
  return {
    id: row.id,
    userId: row.userId,
    userEmail: row.userEmail,
    userName: row.userName,
    stytchOrganizationId: row.stytchOrganizationId,
    stytchMemberId: row.stytchMemberId,
    organizationName: row.organizationName,
    organizationSlug: row.organizationSlug,
    credentialId: row.credentialId,
    webauthnUserId: row.webauthnUserId,
    publicKey: row.publicKey,
    counter: row.counter,
    transports,
    deviceType: row.deviceType,
    backedUp: row.backedUp === 1,
    label: row.label,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastUsedAt: row.lastUsedAt,
  };
}

export async function upsertStytchAuthenticatedUser(
  env: AppEnv,
  input: {
    email: string;
    name: string | null | undefined;
    stytchMemberId: string;
    stytchOrganizationId: string;
    stytchOrganizationName?: string | null;
    stytchOrganizationSlug?: string | null;
  },
) {
  const email = input.email.trim().toLowerCase();
  const name = input.name?.trim() || email.split("@")[0] || "Five to Nine user";
  const now = new Date().toISOString();

  type StytchUserRow = {
    id: string;
    name: string;
    email: string;
    image: string | null;
    onboardedAt: string | null;
  };

  const existingByIdentity = await one<StytchUserRow>(
    env,
    `
      SELECT user.id, user.name, user.email, user.image, user.onboardedAt
      FROM stytch_identity
      JOIN user ON user.id = stytch_identity.user_id
      WHERE stytch_identity.stytch_organization_id = ?
        AND stytch_identity.stytch_member_id = ?
      LIMIT 1
    `,
    input.stytchOrganizationId,
    input.stytchMemberId,
  );
  const existingByEmail = await one<StytchUserRow>(
    env,
    `
      SELECT id, name, email, image, onboardedAt
      FROM user
      WHERE email = ? COLLATE NOCASE
      LIMIT 1
    `,
    email,
  );
  const emailOwnerIsDifferentUser = Boolean(
    existingByIdentity && existingByEmail && existingByIdentity.id !== existingByEmail.id,
  );
  if (emailOwnerIsDifferentUser) {
    throw new Error("This Stytch email is already linked to another local account.");
  }

  let shouldReplaceExistingIdentityForEmail = false;
  if (!existingByIdentity && existingByEmail) {
    const linkedIdentity = await one<{
      stytchOrganizationId: string;
      stytchMemberId: string;
    }>(
      env,
      `
        SELECT stytch_organization_id AS stytchOrganizationId,
               stytch_member_id AS stytchMemberId
        FROM stytch_identity
        WHERE user_id = ?
        LIMIT 1
      `,
      existingByEmail.id,
    );

    if (linkedIdentity && linkedIdentity.stytchOrganizationId !== input.stytchOrganizationId) {
      throw new Error("This email is already linked to another Stytch organization.");
    }
    shouldReplaceExistingIdentityForEmail = Boolean(
      linkedIdentity && linkedIdentity.stytchMemberId !== input.stytchMemberId,
    );
  }

  const existing = existingByIdentity ?? existingByEmail;

  const userId = existing?.id ?? crypto.randomUUID();
  const emailForUser = email;
  const previousEmail = existing?.email.trim().toLowerCase() ?? null;

  if (existing) {
    await run(
      env,
      `
        UPDATE user
        SET email = ?, name = ?, emailVerified = 1, updatedAt = ?
        WHERE id = ?
      `,
      emailForUser,
      existing.name?.trim() || name,
      now,
      userId,
    );
    if (previousEmail && previousEmail !== emailForUser) {
      await migrateAutoProvisionedEmailTargets(env, userId, emailForUser);
    }
  } else {
    await run(
      env,
      `
        INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt, onboardedAt)
        VALUES (?, ?, ?, 1, NULL, ?, ?, NULL)
      `,
      userId,
      name,
      email,
      now,
      now,
    );
  }

  if (shouldReplaceExistingIdentityForEmail) {
    await run(
      env,
      `
        UPDATE stytch_identity
        SET stytch_member_id = ?,
            organization_name = ?,
            organization_slug = ?,
            updated_at = ?
        WHERE user_id = ?
          AND stytch_organization_id = ?
      `,
      input.stytchMemberId,
      input.stytchOrganizationName ?? null,
      input.stytchOrganizationSlug ?? null,
      now,
      userId,
      input.stytchOrganizationId,
    );
  }

  await run(
    env,
    `
      INSERT INTO stytch_identity (
        user_id, stytch_organization_id, stytch_member_id, organization_name,
        organization_slug, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(stytch_organization_id, stytch_member_id) DO UPDATE SET
        user_id = excluded.user_id,
        organization_name = excluded.organization_name,
        organization_slug = excluded.organization_slug,
        updated_at = excluded.updated_at
    `,
    userId,
    input.stytchOrganizationId,
    input.stytchMemberId,
    input.stytchOrganizationName ?? null,
    input.stytchOrganizationSlug ?? null,
    now,
    now,
  );

  return {
    id: userId,
    email: emailForUser,
    name: existing?.name?.trim() || name,
    image: existing?.image ?? null,
    onboardedAt: existing?.onboardedAt ?? null,
  };
}

async function stytchSessionTokenHash(sessionToken: string) {
  const tokenBytes = new TextEncoder().encode(`stytch-session:${sessionToken}`);
  const digest = await crypto.subtle.digest("SHA-256", tokenBytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export interface UserPlanBillingInfo {
  plan: "free" | "scout" | "starter" | "agency";
  dodoStatus: string | null;
  dodoProductId: string | null;
  dodoSubscriptionId: string | null;
  dodoCustomerId: string | null;
  dodoNextBillingAt: string | null;
  planUpdatedAt: string | null;
}

export async function getUserPlanBillingInfo(
  env: AppEnv,
  userId: string,
): Promise<UserPlanBillingInfo> {
  const row = await one<{
    plan: string | null;
    dodo_status: string | null;
    dodo_product_id: string | null;
    dodo_subscription_id: string | null;
    dodo_customer_id: string | null;
    dodo_next_billing_at: string | null;
    plan_updated_at: string | null;
  }>(
    env,
    `
      SELECT plan, dodo_status, dodo_product_id, dodo_subscription_id,
             dodo_customer_id, dodo_next_billing_at, plan_updated_at
      FROM user_plan
      WHERE user_id = ?
    `,
    userId,
  );

  const plan =
    row?.plan === "scout" || row?.plan === "starter" || row?.plan === "agency"
      ? row.plan
      : "free";

  return {
    plan,
    dodoStatus: row?.dodo_status ?? null,
    dodoProductId: row?.dodo_product_id ?? null,
    dodoSubscriptionId: row?.dodo_subscription_id ?? null,
    dodoCustomerId: row?.dodo_customer_id ?? null,
    dodoNextBillingAt: row?.dodo_next_billing_at ?? null,
    planUpdatedAt: row?.plan_updated_at ?? null,
  };
}

function validIsoTimestamp(value: string | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export async function completeUserOnboarding(env: AppEnv, userId: string) {
  await run(
    env,
    `
      UPDATE user
      SET onboardedAt = datetime('now')
      WHERE id = ?
    `,
    userId,
  );
}

export async function listSavedQueries(env: AppEnv, userId: string) {
  const rows = await many<SavedQueryRow>(
    env,
    `
      SELECT *
      FROM saved_query
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `,
    userId,
  );

  return rows.map(toSavedQueryRecord);
}

export async function getSavedQuery(env: AppEnv, savedQueryId: string, userId?: string) {
  const row = await one<SavedQueryRow>(
    env,
    `
      SELECT *
      FROM saved_query
      WHERE id = ? ${userId ? "AND user_id = ?" : ""}
    `,
    ...(userId ? [savedQueryId, userId] : [savedQueryId]),
  );

  return row ? toSavedQueryRecord(row) : null;
}

export async function createSavedQuery(
  env: AppEnv,
  userId: string,
  input: {
    name: string;
    mode: SavedQueryRecord["mode"];
    filters: Partial<NormalizedSavedQuery["filters"]>;
  },
) {
  const normalizedQuery = normalizeSavedQuery(input.mode, input.filters);
  const timestamp = nowIso();
  const id = createId();

  await run(
    env,
    `
      INSERT INTO saved_query (
        id,
        user_id,
        name,
        mode,
        query_text,
        normalized_query_json,
        fingerprint,
        run_count,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `,
    id,
    userId,
    input.name.trim(),
    normalizedQuery.mode,
    normalizedQuery.filters.query,
    jsonValue(normalizedQuery),
    fingerprintSavedQuery(normalizedQuery),
    timestamp,
    timestamp,
  );

  return getSavedQuery(env, id, userId);
}

export async function touchSavedQueryRun(env: AppEnv, savedQueryId: string) {
  const timestamp = nowIso();
  await run(
    env,
    `
      UPDATE saved_query
      SET run_count = run_count + 1,
          last_run_at = ?,
          updated_at = ?
      WHERE id = ?
    `,
    timestamp,
    timestamp,
    savedQueryId,
  );
}

export async function listCollections(env: AppEnv, userId: string) {
  const rows = await many<CollectionRow>(
    env,
    `
      SELECT *
      FROM collection
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `,
    userId,
  );
  return rows.map(toCollectionRecord);
}

export async function getCollection(env: AppEnv, collectionId: string, userId?: string) {
  const row = await one<CollectionRow>(
    env,
    `
      SELECT *
      FROM collection
      WHERE id = ? ${userId ? "AND user_id = ?" : ""}
    `,
    ...(userId ? [collectionId, userId] : [collectionId]),
  );

  return row ? toCollectionRecord(row) : null;
}

export async function createCollection(
  env: AppEnv,
  userId: string,
  input: { name: string; description?: string | null },
) {
  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO collection (id, user_id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    id,
    userId,
    input.name.trim(),
    input.description?.trim() ?? null,
    timestamp,
    timestamp,
  );

  const row = await one<CollectionRow>(env, "SELECT * FROM collection WHERE id = ?", id);
  return row ? toCollectionRecord(row) : null;
}

export async function listCollectionItems(env: AppEnv, collectionId: string) {
  const rows = await many<CollectionItemRow>(
    env,
    `
      SELECT *
      FROM collection_item
      WHERE collection_id = ?
      ORDER BY created_at DESC
    `,
    collectionId,
  );

  const tagsByItemId = new Map<string, string[]>();

  if (rows.length > 0) {
    // Join through collection_item instead of expanding item ids into
    // `IN (?, ...)` — D1 caps bound parameters at 100, so collections with
    // more than 100 items would otherwise fail to load.
    const tags = await many<{ collection_item_id: string; label: string }>(
      env,
      `
        SELECT collection_item_tag.collection_item_id, tag.label
        FROM collection_item_tag
        INNER JOIN tag ON tag.id = collection_item_tag.tag_id
        INNER JOIN collection_item ON collection_item.id = collection_item_tag.collection_item_id
        WHERE collection_item.collection_id = ?
        ORDER BY tag.label ASC
      `,
      collectionId,
    );

    for (const row of tags) {
      const next = tagsByItemId.get(row.collection_item_id) ?? [];
      next.push(row.label);
      tagsByItemId.set(row.collection_item_id, next);
    }
  }

  return rows.map<CollectionItemRecord>((row: CollectionItemRow) => ({
    id: row.id,
    collectionId: row.collection_id,
    adId: row.ad_id,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ad: parseJson<AdRecord>(row.ad_snapshot_json, {} as AdRecord),
    tags: tagsByItemId.get(row.id) ?? [],
  }));
}

export async function updateCollectionItem(
  env: AppEnv,
  userId: string,
  itemId: string,
  input: { note: string | null; tags: string[] },
) {
  const owner = await one<{ id: string }>(
    env,
    `
      SELECT collection_item.id
      FROM collection_item
      INNER JOIN collection ON collection.id = collection_item.collection_id
      WHERE collection_item.id = ? AND collection.user_id = ?
    `,
    itemId,
    userId,
  );

  if (!owner) {
    throw new Error("Collection item not found.");
  }

  const timestamp = nowIso();
  await run(
    env,
    "UPDATE collection_item SET note = ?, updated_at = ? WHERE id = ?",
    input.note?.trim() || null,
    timestamp,
    itemId,
  );

  await run(env, "DELETE FROM collection_item_tag WHERE collection_item_id = ?", itemId);
  const tagIds = await ensureTags(env, userId, input.tags);

  for (const tagId of tagIds) {
    await run(
      env,
      `
        INSERT INTO collection_item_tag (collection_item_id, tag_id)
        VALUES (?, ?)
      `,
      itemId,
      tagId,
    );
  }
}

export async function addAdToCollection(
  env: AppEnv,
  userId: string,
  collectionId: string,
  ad: AdRecord,
  note: string | null,
  tags: string[],
) {
  const collection = await one<{ id: string }>(
    env,
    "SELECT id FROM collection WHERE id = ? AND user_id = ?",
    collectionId,
    userId,
  );

  if (!collection) {
    throw new Error("Collection not found.");
  }

  await upsertAd(env, ad);

  const itemId = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO collection_item (
        id,
        collection_id,
        ad_id,
        note,
        ad_snapshot_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(collection_id, ad_id)
      DO UPDATE SET note = excluded.note,
                    ad_snapshot_json = excluded.ad_snapshot_json,
                    updated_at = excluded.updated_at
    `,
    itemId,
    collectionId,
    ad.metaAdId,
    note?.trim() || null,
    jsonValue(ad),
    timestamp,
    timestamp,
  );

  const row = await one<{ id: string }>(
    env,
    "SELECT id FROM collection_item WHERE collection_id = ? AND ad_id = ?",
    collectionId,
    ad.metaAdId,
  );

  if (row) {
    await updateCollectionItem(env, userId, row.id, { note, tags });
  }
}

export async function addExternalProofToCollection(
  env: AppEnv,
  userId: string,
  collectionId: string,
  input: {
    advertiser: string;
    proofUrl: string;
    channel: string;
    hook: string;
    offer?: string | null;
    cta?: string | null;
    note?: string | null;
    observedAt?: string | null;
    spend?: string | null;
    impressions?: string | null;
    reach?: string | null;
    tags?: string[];
  },
) {
  const ad = buildExternalProofAd(input);
  const tags = [...new Set([...(input.tags ?? []), ...(ad.tags ?? [])])];
  await addAdToCollection(env, userId, collectionId, ad, input.note ?? null, tags);

  return ad;
}

async function ensureTags(env: AppEnv, userId: string, labels: string[]) {
  const uniqueLabels = [...new Set(labels.map((label) => label.trim()).filter(Boolean))];
  const ids: string[] = [];

  for (const label of uniqueLabels) {
    const existing = await one<{ id: string }>(
      env,
      "SELECT id FROM tag WHERE user_id = ? AND label = ?",
      userId,
      label,
    );

    if (existing) {
      ids.push(existing.id);
      continue;
    }

    const id = createId();
    const timestamp = nowIso();
    await run(
      env,
      `
        INSERT INTO tag (id, user_id, label, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      id,
      userId,
      label,
      timestamp,
      timestamp,
    );
    ids.push(id);
  }

  return ids;
}

export async function listWatchlists(
  env: AppEnv,
  userId: string,
  options: { includeInactive?: boolean } = {},
) {
  // Paused watchlists default to hidden (digests, dashboard counts), but the
  // watchlists page opts in: after a cancellation auto-paused everything, an
  // invisible watchlist looked like a deleted one — a returning subscriber
  // found an "empty" product with no way to resume.
  const rows = await many<WatchlistRow>(
    env,
    options.includeInactive
      ? `
        SELECT *
        FROM watchlist
        WHERE user_id = ?
        ORDER BY is_active DESC, updated_at DESC
      `
      : `
        SELECT *
        FROM watchlist
        WHERE user_id = ?
          AND is_active = 1
        ORDER BY updated_at DESC
      `,
    userId,
  );
  return rows.map(toWatchlistRecord);
}

export async function reactivateWatchlistsUpToPlanLimit(
  env: AppEnv,
  userId: string,
  limit: number,
) {
  // Inverse of deactivateWatchlistsBeyondPlanLimit: when a plan is granted
  // (first purchase, renewal, resubscribe), bring the most recently active
  // paused watchlists back — up to the plan limit, counting current actives.
  const db = ensureDb(env);
  const activeRow = await one<{ count: number }>(
    env,
    "SELECT COUNT(*) AS count FROM watchlist WHERE user_id = ? AND is_active = 1",
    userId,
  );
  const slots = Math.max(0, Math.floor(limit) - Number(activeRow?.count ?? 0));
  if (slots === 0) {
    return 0;
  }

  const timestamp = nowIso();
  const result = await db
    .prepare(
      `
        UPDATE watchlist
        SET is_active = 1,
            paused_reason = NULL,
            updated_at = ?
        WHERE user_id = ?
          AND is_active = 0
          AND (paused_reason = 'plan_limit' OR paused_reason IS NULL)
          AND id IN (
            SELECT id
            FROM watchlist
            WHERE user_id = ?
              AND is_active = 0
              AND (paused_reason = 'plan_limit' OR paused_reason IS NULL)
            ORDER BY updated_at DESC
            LIMIT ?
          )
      `,
    )
    .bind(timestamp, userId, userId, slots)
    .run();

  const changed = Number(result.meta?.changes ?? 0);
  if (changed > 0) {
    await syncWebMentionTargetsForUser(env, userId, timestamp);
  }
  return changed;
}

export async function listActiveWatchlists(
  env: AppEnv,
  options: { includeScout?: boolean } = {},
) {
  const rows = await many<WatchlistRow>(
    env,
    `
      SELECT watchlist.*
      FROM watchlist
      INNER JOIN user_plan
        ON user_plan.user_id = watchlist.user_id
      WHERE watchlist.is_active = 1
        AND (
          user_plan.plan IN ('starter', 'agency')
          OR (? = 1 AND user_plan.plan = 'scout')
        )
      ORDER BY
        CASE user_plan.plan WHEN 'agency' THEN 0 WHEN 'starter' THEN 1 ELSE 2 END ASC,
        watchlist.updated_at ASC
    `,
    options.includeScout ? 1 : 0,
  );
  return rows.map(toWatchlistRecord);
}

export async function getWatchlist(env: AppEnv, watchlistId: string, userId?: string) {
  const row = await one<WatchlistRow>(
    env,
    `
      SELECT *
      FROM watchlist
      WHERE id = ? ${userId ? "AND user_id = ?" : ""}
    `,
    ...(userId ? [watchlistId, userId] : [watchlistId]),
  );

  return row ? toWatchlistRecord(row) : null;
}

export async function createWatchlist(
  env: AppEnv,
  userId: string,
  input: {
    name: string;
    targetType: WatchTargetType;
    targetId: string;
    targetFingerprint: string;
    targetLabel: string;
    targetCountry?: string | null;
    trackingRole?: WatchlistTrackingRole | null;
  },
) {
  const trackingRole = normalizeWatchlistTrackingRole(input.trackingRole);
  const existing = await one<WatchlistRow>(
    env,
    `
      SELECT *
      FROM watchlist
      WHERE user_id = ?
        AND tracking_role = ?
        AND target_fingerprint = ?
        AND is_active = 1
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    userId,
    trackingRole,
    input.targetFingerprint,
  );

  if (existing) {
    await ensureWebMentionTargetForWatchlist(env, userId, existing);
    return toWatchlistRecord(existing);
  }

  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT OR IGNORE INTO watchlist (
        id,
        user_id,
        name,
        target_type,
        tracking_role,
        target_id,
        target_fingerprint,
        target_label,
        target_country,
        is_active,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `,
    id,
    userId,
    input.name.trim(),
    input.targetType,
    trackingRole,
    input.targetId,
    input.targetFingerprint,
    input.targetLabel,
    input.targetCountry ?? null,
    timestamp,
    timestamp,
  );

  const created = await getWatchlist(env, id, userId);
  if (created) {
    await ensureWebMentionTargetForWatchlist(env, userId, created);
    return created;
  }

  const concurrent = await one<WatchlistRow>(
    env,
    `
      SELECT *
      FROM watchlist
      WHERE user_id = ?
        AND tracking_role = ?
        AND target_fingerprint = ?
        AND is_active = 1
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    userId,
    trackingRole,
    input.targetFingerprint,
  );

  if (concurrent) {
    await ensureWebMentionTargetForWatchlist(env, userId, concurrent);
    return toWatchlistRecord(concurrent);
  }

  return null;
}

async function ensureWebMentionTargetForWatchlist(
  env: AppEnv,
  userId: string,
  watchlist: WatchlistRecord | WatchlistRow,
) {
  const id = createId();
  const timestamp = nowIso();
  const watchlistId = watchlist.id;
  const isRow = "target_label" in watchlist;
  const role = normalizeWatchlistTrackingRole(isRow ? watchlist.tracking_role : watchlist.trackingRole);
  const label = isRow ? watchlist.target_label : watchlist.targetLabel;
  const isActive = isRow ? watchlist.is_active === 1 : watchlist.isActive;

  await run(
    env,
    `
      INSERT OR IGNORE INTO web_mention_target (
        id,
        user_id,
        watchlist_id,
        tracking_role,
        label,
        query_text,
        domain,
        sources_json,
        is_active,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
    `,
    id,
    userId,
    watchlistId,
    role,
    label,
    label,
    JSON.stringify(["reddit", "x", "blog", "youtube", "substack", "web"]),
    isActive ? 1 : 0,
    timestamp,
    timestamp,
  );

  await run(
    env,
    `
      UPDATE web_mention_target
      SET tracking_role = ?,
          label = ?,
          query_text = ?,
          is_active = ?,
          updated_at = ?
      WHERE watchlist_id = ?
        AND user_id = ?
    `,
    role,
    label,
    label,
    isActive ? 1 : 0,
    timestamp,
    watchlistId,
    userId,
  );
}

async function syncWebMentionTargetsForUser(env: AppEnv, userId: string, timestamp = nowIso()) {
  await run(
    env,
    `
      UPDATE web_mention_target
      SET is_active = (
            SELECT watchlist.is_active
            FROM watchlist
            WHERE watchlist.id = web_mention_target.watchlist_id
              AND watchlist.user_id = web_mention_target.user_id
          ),
          updated_at = ?
      WHERE user_id = ?
        AND watchlist_id IN (
          SELECT id
          FROM watchlist
          WHERE user_id = ?
        )
    `,
    timestamp,
    userId,
    userId,
  );
}

export async function updateWatchlist(
  env: AppEnv,
  userId: string,
  watchlistId: string,
  input: {
    name: string;
    targetType: WatchTargetType;
    targetId: string;
    targetFingerprint: string;
    targetLabel: string;
    targetCountry?: string | null;
    trackingRole?: WatchlistTrackingRole | null;
  },
) {
  const existing = await getWatchlist(env, watchlistId, userId);
  if (!existing) {
    return null;
  }
  const trackingRole = normalizeWatchlistTrackingRole(input.trackingRole ?? existing.trackingRole);

  const duplicate = await one<WatchlistRow>(
    env,
    `
      SELECT *
      FROM watchlist
      WHERE user_id = ?
        AND tracking_role = ?
        AND target_fingerprint = ?
        AND id != ?
        AND is_active = 1
      LIMIT 1
    `,
    userId,
    trackingRole,
    input.targetFingerprint,
    watchlistId,
  );

  if (duplicate) {
    throw new Error("watchlist_duplicate_target");
  }

  const timestamp = nowIso();
  if (existing.targetFingerprint !== input.targetFingerprint) {
    const replacement = await createWatchlist(env, userId, {
      ...input,
      trackingRole,
    });
    if (!replacement) {
      return null;
    }

    await run(
      env,
      `
        UPDATE watchlist
        SET is_active = 0,
            paused_reason = 'retargeted',
            updated_at = ?
        WHERE id = ?
          AND user_id = ?
          AND is_active = 1
      `,
      timestamp,
      watchlistId,
      userId,
    );

    // Retargeting silently reset alert preferences: carry the per-watchlist
    // delivery config and targets over to the replacement so the customer's
    // settings survive a competitor rebrand/domain change.
    await copyWatchlistDeliverySettings(env, userId, watchlistId, replacement.id);
    await syncWebMentionTargetsForUser(env, userId, timestamp);

    return replacement;
  }

  await run(
    env,
    `
      UPDATE watchlist
      SET name = ?,
          target_type = ?,
          tracking_role = ?,
          target_id = ?,
          target_fingerprint = ?,
          target_label = ?,
          target_country = ?,
          updated_at = ?
      WHERE id = ?
        AND user_id = ?
        AND is_active = 1
    `,
    input.name.trim(),
    input.targetType,
    trackingRole,
    input.targetId,
    input.targetFingerprint,
    input.targetLabel,
    input.targetCountry ?? null,
    timestamp,
    watchlistId,
    userId,
  );

  const updated = await getWatchlist(env, watchlistId, userId);
  if (updated) {
    await ensureWebMentionTargetForWatchlist(env, userId, updated);
  }

  return updated;
}

async function copyWatchlistDeliverySettings(
  env: AppEnv,
  userId: string,
  fromWatchlistId: string,
  toWatchlistId: string,
) {
  const timestamp = nowIso();

  await run(
    env,
    `
      INSERT INTO watchlist_delivery_config (
        id, watchlist_id, user_id, sensitivity_mode, instant_enabled,
        digest_enabled, email_enabled, whatsapp_enabled, slack_enabled,
        quiet_hours_json, timezone, created_at, updated_at
      )
      SELECT ?, ?, user_id, sensitivity_mode, instant_enabled,
             digest_enabled, email_enabled, whatsapp_enabled, slack_enabled,
             quiet_hours_json, timezone, ?, ?
      FROM watchlist_delivery_config
      WHERE watchlist_id = ?
    `,
    createId(),
    toWatchlistId,
    timestamp,
    timestamp,
    fromWatchlistId,
  );

  await run(
    env,
    `
      INSERT INTO delivery_target (
        id, user_id, watchlist_id, channel, target_value, validation_status,
        is_validated, is_opted_in, opt_in_source, opted_in_at, is_paused,
        paused_at, opted_out_at, template_eligible, last_successful_delivery_at,
        last_successful_attempt_id, provider_identifier, metadata_json,
        created_at, updated_at
      )
      SELECT lower(hex(randomblob(16))), user_id, ?, channel, target_value,
             validation_status, is_validated, is_opted_in, opt_in_source,
             opted_in_at, is_paused, paused_at, opted_out_at, template_eligible,
             NULL, NULL, provider_identifier, metadata_json, ?, ?
      FROM delivery_target
      WHERE watchlist_id = ?
        AND user_id = ?
        AND opted_out_at IS NULL
    `,
    toWatchlistId,
    timestamp,
    timestamp,
    fromWatchlistId,
    userId,
  );
}

export async function setWatchlistActive(
  env: AppEnv,
  userId: string,
  watchlistId: string,
  isActive: boolean,
) {
  // Pausing frees the plan slot (limits count active watchlists) and stops
  // scheduled scans; nothing is deleted, so resuming brings the history back.
  const db = ensureDb(env);
  const timestamp = nowIso();
  const result = await db
    .prepare(
      `
        UPDATE watchlist
        SET is_active = ?,
            paused_reason = ?,
            updated_at = ?
        WHERE id = ?
          AND user_id = ?
      `,
    )
    .bind(isActive ? 1 : 0, isActive ? null : "user", timestamp, watchlistId, userId)
    .run();

  const changed = Number(result.meta?.changes ?? 0) > 0;
  if (changed) {
    await syncWebMentionTargetsForUser(env, userId, timestamp);
  }
  return changed;
}

export async function deleteCollection(env: AppEnv, userId: string, collectionId: string) {
  const db = ensureDb(env);
  // collection_item and collection_item_tag rows cascade.
  const result = await db
    .prepare("DELETE FROM collection WHERE id = ? AND user_id = ?")
    .bind(collectionId, userId)
    .run();

  return Number(result.meta?.changes ?? 0) > 0;
}

export async function deleteCollectionItem(env: AppEnv, userId: string, itemId: string) {
  const db = ensureDb(env);
  const result = await db
    .prepare(
      `
        DELETE FROM collection_item
        WHERE id = ?
          AND collection_id IN (SELECT id FROM collection WHERE user_id = ?)
      `,
    )
    .bind(itemId, userId)
    .run();

  return Number(result.meta?.changes ?? 0) > 0;
}

export async function createWatchlistRun(
  env: AppEnv,
  watchlistId: string,
  triggerType: WatchlistRunRecord["triggerType"],
  baselineFromRunId: string | null,
  pageBudget: number,
) {
  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO watchlist_run (
        id,
        watchlist_id,
        trigger_type,
        status,
        page_budget,
        pages_scanned,
        baseline_from_run_id,
        summary_json,
        started_at,
        finished_at,
        error_code,
        error_message,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, 'running', ?, 0, ?, '{}', ?, NULL, NULL, NULL, ?, ?)
    `,
    id,
    watchlistId,
    triggerType,
    pageBudget,
    baselineFromRunId,
    timestamp,
    timestamp,
    timestamp,
  );

  return id;
}

export async function finishWatchlistRun(
  env: AppEnv,
  runId: string,
  input: {
    status: WatchlistRunRecord["status"];
    pagesScanned: number;
    summary: JsonRecord;
    errorCode?: string | null;
    errorMessage?: string | null;
  },
) {
  const timestamp = nowIso();
  await run(
    env,
    `
      UPDATE watchlist_run
      SET status = ?,
          pages_scanned = ?,
          summary_json = ?,
          finished_at = ?,
          error_code = ?,
          error_message = ?,
          updated_at = ?
      WHERE id = ?
    `,
    input.status,
    input.pagesScanned,
    jsonValue(input.summary),
    timestamp,
    input.errorCode ?? null,
    input.errorMessage ?? null,
    timestamp,
    runId,
  );
}

export async function getRecentSuccessfulRuns(
  env: AppEnv,
  watchlistId: string,
  limit = 3,
) {
  const rows = await many<WatchlistRunRow>(
    env,
    `
      SELECT *
      FROM watchlist_run
      WHERE watchlist_id = ? AND status = 'succeeded'
      ORDER BY started_at DESC
      LIMIT ?
    `,
    watchlistId,
    limit,
  );
  return rows.map(toWatchlistRunRecord);
}

export async function listWatchlistRuns(
  env: AppEnv,
  watchlistId: string,
  limit = 12,
) {
  const rows = await many<WatchlistRunRow>(
    env,
    `
      SELECT *
      FROM watchlist_run
      WHERE watchlist_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `,
    watchlistId,
    limit,
  );

  return rows.map(toWatchlistRunRecord);
}

export async function touchWatchlistScanned(env: AppEnv, watchlistId: string) {
  const timestamp = nowIso();
  await run(
    env,
    `
      UPDATE watchlist
      SET last_scanned_at = ?, updated_at = ?
      WHERE id = ?
    `,
    timestamp,
    timestamp,
    watchlistId,
  );
}

export async function listWatchEvents(
  env: AppEnv,
  watchlistId: string,
  limit = 40,
) {
  const rows = await many<WatchEventRow>(
    env,
    `
      SELECT *
      FROM watch_event
      WHERE watchlist_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    watchlistId,
    limit,
  );

  return rows.map(toWatchEventRecord);
}

export async function listWatchEventsByIds(
  env: AppEnv,
  watchlistId: string,
  eventIds: string[],
) {
  const uniqueIds = [...new Set(eventIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return [];
  }

  const chunkedRows = await Promise.all(
    chunkForBoundParams(uniqueIds, 80).map((chunk) => {
      const placeholders = chunk.map(() => "?").join(", ");
      return many<WatchEventRow>(
        env,
        `
          SELECT *
          FROM watch_event
          WHERE watchlist_id = ?
            AND id IN (${placeholders})
          ORDER BY created_at ASC
        `,
        watchlistId,
        ...chunk,
      );
    }),
  );

  return chunkedRows.flat().map(toWatchEventRecord);
}

export interface OperatorRiskSummary {
  troubleWatchlists: Array<{
    id: string;
    name: string;
    userEmail: string;
    consecutiveFailures: number;
  }>;
  staleWatchlists: Array<{
    id: string;
    name: string;
    userEmail: string;
    lastScannedAt: string | null;
  }>;
  deliveryFailures24h: number;
  stuckRuns: number;
}

// Targeted "customer-at-risk" signals for the nightly operator alert —
// deliberately cheaper than the full operator snapshot.
export interface WeeklyBusinessSummary {
  signups7d: number;
  activated7d: number;
  payingByPlan: Array<{ plan: string; count: number }>;
  dunningCount: number;
  revokedToFree7d: number;
  digestAttempts7d: number;
  digestSent7d: number;
  oldestActivePaidScanAt: string | null;
}

// Monday operator email: the handful of numbers that say whether the
// business moved last week. Read-only aggregates, cheap enough for cron.
export async function getWeeklyBusinessSummary(env: AppEnv): Promise<WeeklyBusinessSummary> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [signupRow, activatedRow, payingRows, dunningRow, revokedRow, digestRows, staleRow] =
    await Promise.all([
      one<{ count: number }>(env, `SELECT COUNT(*) AS count FROM user WHERE created_at >= ?`, weekAgo),
      one<{ count: number }>(
        env,
        `SELECT COUNT(*) AS count FROM user WHERE onboardedAt IS NOT NULL AND onboardedAt >= ?`,
        weekAgo,
      ),
      many<{ plan: string; count: number }>(
        env,
        `SELECT plan, COUNT(*) AS count FROM user_plan WHERE plan != 'free' GROUP BY plan ORDER BY plan`,
      ),
      one<{ count: number }>(
        env,
        `
          SELECT COUNT(*) AS count
          FROM user_plan
          WHERE plan != 'free'
            AND dodo_status IN ('subscription.failed', 'subscription.on_hold')
        `,
      ),
      one<{ count: number }>(
        env,
        `
          SELECT COUNT(*) AS count
          FROM user_plan
          WHERE plan = 'free'
            AND dodo_status IS NOT NULL
            AND dodo_status != 'checkout_pending'
            AND plan_updated_at >= ?
        `,
        weekAgo,
      ),
      many<{ status: string; count: number }>(
        env,
        `
          SELECT status, COUNT(*) AS count
          FROM delivery_attempt
          WHERE template_name = 'digest'
            AND created_at >= ?
          GROUP BY status
        `,
        weekAgo,
      ),
      one<{ oldest: string | null }>(
        env,
        `
          SELECT MIN(watchlist.last_scanned_at) AS oldest
          FROM watchlist
          INNER JOIN user_plan ON user_plan.user_id = watchlist.user_id
          WHERE watchlist.is_active = 1
            AND user_plan.plan IN ('starter', 'agency')
            AND watchlist.last_scanned_at IS NOT NULL
        `,
      ),
    ]);

  const digestAttempts = digestRows.reduce((sum, row) => sum + Number(row.count), 0);
  const digestSent = digestRows
    .filter((row) => row.status === "sent" || row.status === "delivered")
    .reduce((sum, row) => sum + Number(row.count), 0);

  return {
    signups7d: Number(signupRow?.count ?? 0),
    activated7d: Number(activatedRow?.count ?? 0),
    payingByPlan: payingRows.map((row) => ({ plan: row.plan, count: Number(row.count) })),
    dunningCount: Number(dunningRow?.count ?? 0),
    revokedToFree7d: Number(revokedRow?.count ?? 0),
    digestAttempts7d: digestAttempts,
    digestSent7d: digestSent,
    oldestActivePaidScanAt: staleRow?.oldest ?? null,
  };
}

export async function getOperatorRiskSummary(env: AppEnv): Promise<OperatorRiskSummary> {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const recentlyFailed = await many<{ id: string; name: string; user_email: string }>(
    env,
    `
      SELECT DISTINCT watchlist.id, watchlist.name, user.email AS user_email
      FROM watchlist_run
      INNER JOIN watchlist ON watchlist.id = watchlist_run.watchlist_id
      INNER JOIN user ON user.id = watchlist.user_id
      WHERE watchlist_run.status = 'failed'
        AND watchlist_run.started_at >= ?
        AND watchlist.is_active = 1
      LIMIT 20
    `,
    dayAgo,
  );

  const troubleWatchlists: OperatorRiskSummary["troubleWatchlists"] = [];
  for (const candidate of recentlyFailed) {
    const lastRuns = await many<{ status: string; error_code: string | null }>(
      env,
      `
        SELECT status, error_code
        FROM watchlist_run
        WHERE watchlist_id = ?
        ORDER BY started_at DESC
        LIMIT 5
      `,
      candidate.id,
    );
    // Provider cooldowns (rate_limited/cache_only) are soft: one rate-limit
    // event fails a whole tail of the night's sequential scans — counting
    // those as customer-at-risk produced alarm noise for both sides.
    const consecutiveFailures = countLeadingFailures(
      lastRuns
        .filter((run) => !isSoftScanFailure(run.status, run.error_code))
        .map((run) => run.status),
    );
    if (consecutiveFailures >= 3) {
      troubleWatchlists.push({
        id: candidate.id,
        name: candidate.name,
        userEmail: candidate.user_email,
        consecutiveFailures,
      });
    }
  }

  // Budget-skipped watchlists never create a run row, so failure counting
  // can't see them — staleness can: an active paid watchlist that hasn't
  // been scanned in 36h means the nightly window is overflowing (or the
  // cron is broken). This is the capacity canary.
  const staleCutoff = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  const staleRows = await many<{
    id: string;
    name: string;
    user_email: string;
    last_scanned_at: string | null;
  }>(
    env,
    `
      SELECT watchlist.id, watchlist.name, user.email AS user_email,
             watchlist.last_scanned_at
      FROM watchlist
      INNER JOIN user_plan ON user_plan.user_id = watchlist.user_id
      INNER JOIN user ON user.id = watchlist.user_id
      WHERE watchlist.is_active = 1
        AND user_plan.plan IN ('starter', 'agency')
        AND watchlist.created_at < ?
        AND (watchlist.last_scanned_at IS NULL OR watchlist.last_scanned_at < ?)
      ORDER BY watchlist.last_scanned_at ASC
      LIMIT 10
    `,
    staleCutoff,
    staleCutoff,
  );

  const [deliveryRow, stuckRow] = await Promise.all([
    one<{ count: number }>(
      env,
      `
        SELECT COUNT(*) AS count
        FROM delivery_attempt
        WHERE status = 'failed'
          AND lane = 'customer'
          AND created_at >= ?
      `,
      dayAgo,
    ),
    one<{ count: number }>(
      env,
      `
        SELECT COUNT(*) AS count
        FROM watchlist_run
        WHERE status IN ('pending', 'running')
          AND started_at < ?
      `,
      hourAgo,
    ),
  ]);

  return {
    troubleWatchlists,
    staleWatchlists: staleRows.map((row) => ({
      id: row.id,
      name: row.name,
      userEmail: row.user_email,
      lastScannedAt: row.last_scanned_at,
    })),
    deliveryFailures24h: Number(deliveryRow?.count ?? 0),
    stuckRuns: Number(stuckRow?.count ?? 0),
  };
}

export function isSoftScanFailure(status: string, errorCode: string | null | undefined) {
  return status === "failed" && (errorCode === "rate_limited" || errorCode === "cache_only");
}

export function countLeadingFailures(statuses: string[]) {
  let count = 0;
  for (const status of statuses) {
    if (status !== "failed") break;
    count += 1;
  }
  return count;
}

export async function getSuccessfulRunStatsForUserBetween(
  env: AppEnv,
  userId: string,
  startIso: string,
  endIso: string,
) {
  const row = await one<{
    runs: number;
    watchlists_checked: number;
    ads_seen: number | null;
  }>(
    env,
    `
      SELECT
        COUNT(*) AS runs,
        COUNT(DISTINCT watchlist_run.watchlist_id) AS watchlists_checked,
        SUM(COALESCE(json_extract(watchlist_run.summary_json, '$.adsSeen'), 0)) AS ads_seen
      FROM watchlist_run
      INNER JOIN watchlist ON watchlist.id = watchlist_run.watchlist_id
      WHERE watchlist.user_id = ?
        AND watchlist_run.status = 'succeeded'
        AND COALESCE(json_extract(watchlist_run.summary_json, '$.scanStatus'), '') != 'degraded'
        AND watchlist_run.started_at >= ?
        AND watchlist_run.started_at < ?
    `,
    userId,
    startIso,
    endIso,
  );

  return {
    runs: Number(row?.runs ?? 0),
    watchlistsChecked: Number(row?.watchlists_checked ?? 0),
    adsSeen: Number(row?.ads_seen ?? 0),
  };
}

export async function listRetryableInstantAttempts(
  env: AppEnv,
  input: {
    since: string;
    limit: number;
  },
) {
  // Instant alerts that were deferred by quiet hours (and never flushed) or
  // failed at the provider. Successful re-sends update or supersede these
  // rows, so they naturally drop out of this query.
  const rows = await many<DeliveryAttemptRow>(
    env,
    `
      SELECT *
      FROM delivery_attempt
      WHERE lane = 'customer'
        AND watchlist_id IS NOT NULL
        AND digest_run_id IS NULL
        AND created_at >= ?
        AND status IN ('skipped_due_to_quiet_hours', 'failed')
      ORDER BY created_at ASC
      LIMIT ?
    `,
    input.since,
    input.limit,
  );

  return rows.map(toDeliveryAttemptRecord);
}

export async function listEventCandidates(
  env: AppEnv,
  watchlistId: string,
  limit = 40,
) {
  const rows = await many<EventCandidateRow>(
    env,
    `
      SELECT *
      FROM event_candidate
      WHERE watchlist_id = ?
      ORDER BY detected_at DESC
      LIMIT ?
    `,
    watchlistId,
    limit,
  );

  return rows.map(toEventCandidateRecord);
}

export async function listWatchEventsBetween(
  env: AppEnv,
  watchlistId: string,
  periodStart: string,
  periodEnd: string,
) {
  const rows = await many<WatchEventRow>(
    env,
    `
      SELECT *
      FROM watch_event
      WHERE watchlist_id = ?
        AND created_at >= ?
        AND created_at <= ?
      ORDER BY created_at DESC
    `,
    watchlistId,
    periodStart,
    periodEnd,
  );

  return rows.map(toWatchEventRecord);
}

export async function createWatchEvent(
  env: AppEnv,
  input: {
    watchlistId: string;
    runId: string;
    eventType: WatchEventType;
    adId: string | null;
    baselineFromRunId: string | null;
    title: string;
    summary: string;
    metadata: JsonRecord;
    status?: WatchEventStatus;
    importanceScore?: number;
    candidateId?: string | null;
    proofCaptureId?: string | null;
    confirmedAt?: string | null;
    suppressedAt?: string | null;
    invalidatedAt?: string | null;
    lastEvaluatedAt?: string | null;
  },
) {
  const id = createId();
  const timestamp = nowIso();
  const status = input.status ?? "confirmed";
  await run(
    env,
    `
      INSERT INTO watch_event (
        id,
        watchlist_id,
        run_id,
        event_type,
        status,
        importance_score,
        ad_id,
        baseline_from_run_id,
        candidate_id,
        proof_capture_id,
        title,
        summary,
        metadata_json,
        confirmed_at,
        suppressed_at,
        invalidated_at,
        last_evaluated_at,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    id,
    input.watchlistId,
    input.runId,
    input.eventType,
    status,
    input.importanceScore ?? 0,
    input.adId,
    input.baselineFromRunId,
    input.candidateId ?? null,
    input.proofCaptureId ?? null,
    input.title,
    input.summary,
    jsonValue(input.metadata),
    input.confirmedAt ?? (status === "confirmed" ? timestamp : null),
    input.suppressedAt ?? null,
    input.invalidatedAt ?? null,
    input.lastEvaluatedAt ?? timestamp,
    timestamp,
  );

  return id;
}

export async function createEventCandidate(
  env: AppEnv,
  input: {
    watchlistId: string;
    runId: string;
    eventType: WatchEventType;
    status?: WatchEventStatus;
    importanceScore?: number;
    adId: string | null;
    proofTargetId?: string | null;
    title: string;
    summary: string;
    metadata?: JsonRecord;
    proofRequired?: boolean;
    skipReason?: ProofSkipReason | null;
    dedupeReason?: DedupeReason | null;
    detectedAt?: string;
    lastEvaluatedAt?: string | null;
  },
) {
  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO event_candidate (
        id,
        watchlist_id,
        run_id,
        event_type,
        status,
        importance_score,
        ad_id,
        proof_target_id,
        title,
        summary,
        metadata_json,
        proof_required,
        skip_reason,
        dedupe_reason,
        detected_at,
        last_evaluated_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    id,
    input.watchlistId,
    input.runId,
    input.eventType,
    input.status ?? "detected",
    input.importanceScore ?? 0,
    input.adId,
    input.proofTargetId ?? null,
    input.title,
    input.summary,
    jsonValue(input.metadata ?? {}),
    boolToInt(input.proofRequired ?? false),
    input.skipReason ?? null,
    input.dedupeReason ?? null,
    input.detectedAt ?? timestamp,
    input.lastEvaluatedAt ?? null,
    timestamp,
    timestamp,
  );

  return id;
}

export async function getProofTargetByIdentity(
  env: AppEnv,
  proofTargetIdentity: string,
) {
  const row = await one<ProofTargetRow>(
    env,
    `
      SELECT *
      FROM proof_target
      WHERE proof_target_identity = ?
      LIMIT 1
    `,
    proofTargetIdentity,
  );

  return row ? toProofTargetRecord(row) : null;
}

export async function upsertProofTarget(
  env: AppEnv,
  input: {
    watchlistId: string;
    adId: string | null;
    landingPageUrl: string | null;
    canonicalPageIdentity: string;
    proofTargetIdentity: string;
    lastCaptureAttemptAt?: string | null;
    lastSuccessfulProofAt?: string | null;
    lastSuccessfulCaptureId?: string | null;
  },
) {
  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO proof_target (
        id,
        watchlist_id,
        ad_id,
        landing_page_url,
        canonical_page_identity,
        proof_target_identity,
        last_capture_attempt_at,
        last_successful_proof_at,
        last_successful_capture_id,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(proof_target_identity)
      DO UPDATE SET watchlist_id = excluded.watchlist_id,
                    ad_id = excluded.ad_id,
                    landing_page_url = excluded.landing_page_url,
                    canonical_page_identity = excluded.canonical_page_identity,
                    last_capture_attempt_at = COALESCE(excluded.last_capture_attempt_at, proof_target.last_capture_attempt_at),
                    last_successful_proof_at = COALESCE(excluded.last_successful_proof_at, proof_target.last_successful_proof_at),
                    last_successful_capture_id = COALESCE(excluded.last_successful_capture_id, proof_target.last_successful_capture_id),
                    updated_at = excluded.updated_at
    `,
    id,
    input.watchlistId,
    input.adId,
    input.landingPageUrl,
    input.canonicalPageIdentity,
    input.proofTargetIdentity,
    input.lastCaptureAttemptAt ?? null,
    input.lastSuccessfulProofAt ?? null,
    input.lastSuccessfulCaptureId ?? null,
    timestamp,
    timestamp,
  );

  return getProofTargetByIdentity(env, input.proofTargetIdentity);
}

export async function listProofCapturesForTarget(
  env: AppEnv,
  proofTargetId: string,
  limit = 20,
) {
  const rows = await many<ProofCaptureRow>(
    env,
    `
      SELECT *
      FROM proof_capture
      WHERE proof_target_id = ?
      ORDER BY attempted_at DESC
      LIMIT ?
    `,
    proofTargetId,
    limit,
  );

  return rows.map(toProofCaptureRecord);
}

export async function listSuccessfulProofCapturesForAd(
  env: AppEnv,
  watchlistId: string,
  adId: string,
  limit = 5,
) {
  const rows = await many<ProofCaptureRow>(
    env,
    `
      SELECT proof_capture.*
      FROM proof_capture
      INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
      WHERE proof_target.watchlist_id = ?
        AND proof_target.ad_id = ?
        AND proof_capture.status = 'succeeded'
        AND proof_capture.succeeded_at IS NOT NULL
      ORDER BY proof_capture.succeeded_at DESC
      LIMIT ?
    `,
    watchlistId,
    adId,
    limit,
  );

  return rows.map(toProofCaptureRecord);
}

export async function listRecentProofCapturesForWatchlist(
  env: AppEnv,
  watchlistId: string,
  limit = 12,
) {
  const rows = await many<ProofCaptureRow>(
    env,
    `
      SELECT proof_capture.*
      FROM proof_capture
      INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
      WHERE proof_target.watchlist_id = ?
      ORDER BY proof_capture.attempted_at DESC
      LIMIT ?
    `,
    watchlistId,
    limit,
  );

  return rows.map(toProofCaptureRecord);
}

export async function countProofCapturesForWatchlistSince(
  env: AppEnv,
  watchlistId: string,
  attemptedSince: string,
) {
  const row = await one<CountRow>(
    env,
    `
      SELECT COUNT(*) AS total
      FROM proof_capture
      INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
      WHERE proof_target.watchlist_id = ?
        AND proof_capture.attempted_at >= ?
    `,
    watchlistId,
    attemptedSince,
  );

  return row?.total ?? 0;
}

export async function countProofCapturesForWorkspaceSince(
  env: AppEnv,
  userId: string,
  attemptedSince: string,
) {
  const row = await one<CountRow>(
    env,
    `
      SELECT COUNT(*) AS total
      FROM proof_capture
      INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
      INNER JOIN watchlist ON watchlist.id = proof_target.watchlist_id
      WHERE watchlist.user_id = ?
        AND proof_capture.attempted_at >= ?
    `,
    userId,
    attemptedSince,
  );

  return row?.total ?? 0;
}

export async function getSuccessfulProofCaptureStatsForUser(env: AppEnv, userId: string) {
  const row = await one<{
    total: number;
    latest_at: string | null;
  }>(
    env,
    `
      SELECT COUNT(*) AS total, MAX(proof_capture.succeeded_at) AS latest_at
      FROM proof_capture
      INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
      INNER JOIN watchlist ON watchlist.id = proof_target.watchlist_id
      WHERE watchlist.user_id = ?
        AND proof_capture.status = 'succeeded'
        AND proof_capture.succeeded_at IS NOT NULL
    `,
    userId,
  );

  return {
    count: Number(row?.total ?? 0),
    latestAt: row?.latest_at ?? null,
  };
}

export async function listRecentWorkspaceProofCaptures(
  env: AppEnv,
  userId: string,
  limit = 20,
) {
  const rows = await many<ProofCaptureRow>(
    env,
    `
      SELECT proof_capture.*
      FROM proof_capture
      INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
      INNER JOIN watchlist ON watchlist.id = proof_target.watchlist_id
      WHERE watchlist.user_id = ?
      ORDER BY proof_capture.attempted_at DESC
      LIMIT ?
    `,
    userId,
    limit,
  );

  return rows.map(toProofCaptureRecord);
}

export async function createProofCapture(
  env: AppEnv,
  input: {
    proofTargetId: string;
    status: ProofStatus;
    skipReason?: ProofSkipReason | null;
    failureCode?: string | null;
    failureReason?: string | null;
    screenshotArtifactKey?: string | null;
    htmlArtifactKey?: string | null;
    extractedFields?: JsonRecord;
    fieldConfidence?: Record<string, number>;
    extractionWarnings?: string[];
    captureMetadata?: JsonRecord;
    renderMode?: ProofRenderMode;
    deviceProfile?: ProofDeviceProfile;
    extractorVersion: string;
    idempotencyKey?: string | null;
    attemptedAt?: string;
    succeededAt?: string | null;
  },
) {
  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO proof_capture (
        id,
        proof_target_id,
        status,
        skip_reason,
        failure_code,
        failure_reason,
        screenshot_artifact_key,
        html_artifact_key,
        extracted_fields_json,
        field_confidence_json,
        extraction_warnings_json,
        capture_metadata_json,
        render_mode,
        device_profile,
        extractor_version,
        idempotency_key,
        attempted_at,
        succeeded_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    id,
    input.proofTargetId,
    input.status,
    input.skipReason ?? null,
    input.failureCode ?? null,
    input.failureReason ?? null,
    input.screenshotArtifactKey ?? null,
    input.htmlArtifactKey ?? null,
    jsonValue(input.extractedFields ?? {}),
    jsonValue(input.fieldConfidence ?? {}),
    jsonValue(input.extractionWarnings ?? []),
    jsonValue(input.captureMetadata ?? {}),
    input.renderMode ?? "mobile",
    input.deviceProfile ?? "mobile_default",
    input.extractorVersion,
    input.idempotencyKey ?? null,
    input.attemptedAt ?? timestamp,
    input.succeededAt ?? null,
    timestamp,
    timestamp,
  );

  return id;
}

export async function getWorkspaceDeliveryConfig(env: AppEnv, userId: string) {
  const row = await one<WorkspaceDeliveryConfigRow>(
    env,
    `
      SELECT *
      FROM workspace_delivery_config
      WHERE user_id = ?
      LIMIT 1
    `,
    userId,
  );

  return row ? toWorkspaceDeliveryConfigRecord(row) : null;
}

export async function upsertWorkspaceDeliveryConfig(
  env: AppEnv,
  input: {
    userId: string;
    sensitivityMode: SensitivityMode;
    instantEnabled: boolean;
    digestEnabled: boolean;
    emailEnabled: boolean;
    whatsappEnabled: boolean;
    slackEnabled?: boolean;
    quietHours?: DeliveryQuietHours | null;
    timezone?: string | null;
  },
) {
  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO workspace_delivery_config (
        id,
        user_id,
        sensitivity_mode,
        instant_enabled,
        digest_enabled,
        email_enabled,
        whatsapp_enabled,
        slack_enabled,
        quiet_hours_json,
        timezone,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id)
      DO UPDATE SET sensitivity_mode = excluded.sensitivity_mode,
                    instant_enabled = excluded.instant_enabled,
                    digest_enabled = excluded.digest_enabled,
                    email_enabled = excluded.email_enabled,
                    whatsapp_enabled = excluded.whatsapp_enabled,
                    slack_enabled = excluded.slack_enabled,
                    quiet_hours_json = excluded.quiet_hours_json,
                    timezone = excluded.timezone,
                    updated_at = excluded.updated_at
    `,
    id,
    input.userId,
    input.sensitivityMode,
    boolToInt(input.instantEnabled),
    boolToInt(input.digestEnabled),
    boolToInt(input.emailEnabled),
    boolToInt(input.whatsappEnabled),
    boolToInt(input.slackEnabled ?? false),
    jsonValue(input.quietHours ?? null),
    input.timezone ?? null,
    timestamp,
    timestamp,
  );

  return getWorkspaceDeliveryConfig(env, input.userId);
}

export async function getWatchlistDeliveryConfig(env: AppEnv, watchlistId: string) {
  const row = await one<WatchlistDeliveryConfigRow>(
    env,
    `
      SELECT *
      FROM watchlist_delivery_config
      WHERE watchlist_id = ?
      LIMIT 1
    `,
    watchlistId,
  );

  return row ? toWatchlistDeliveryConfigRecord(row) : null;
}

export async function upsertWatchlistDeliveryConfig(
  env: AppEnv,
  input: {
    watchlistId: string;
    userId: string;
    sensitivityMode: SensitivityMode;
    instantEnabled: boolean;
    digestEnabled: boolean;
    emailEnabled: boolean;
    whatsappEnabled: boolean;
    slackEnabled?: boolean;
    quietHours?: DeliveryQuietHours | null;
    timezone?: string | null;
  },
) {
  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO watchlist_delivery_config (
        id,
        watchlist_id,
        user_id,
        sensitivity_mode,
        instant_enabled,
        digest_enabled,
        email_enabled,
        whatsapp_enabled,
        slack_enabled,
        quiet_hours_json,
        timezone,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(watchlist_id)
      DO UPDATE SET user_id = excluded.user_id,
                    sensitivity_mode = excluded.sensitivity_mode,
                    instant_enabled = excluded.instant_enabled,
                    digest_enabled = excluded.digest_enabled,
                    email_enabled = excluded.email_enabled,
                    whatsapp_enabled = excluded.whatsapp_enabled,
                    slack_enabled = excluded.slack_enabled,
                    quiet_hours_json = excluded.quiet_hours_json,
                    timezone = excluded.timezone,
                    updated_at = excluded.updated_at
    `,
    id,
    input.watchlistId,
    input.userId,
    input.sensitivityMode,
    boolToInt(input.instantEnabled),
    boolToInt(input.digestEnabled),
    boolToInt(input.emailEnabled),
    boolToInt(input.whatsappEnabled),
    boolToInt(input.slackEnabled ?? false),
    jsonValue(input.quietHours ?? null),
    input.timezone ?? null,
    timestamp,
    timestamp,
  );

  return getWatchlistDeliveryConfig(env, input.watchlistId);
}

export async function listDeliveryTargets(
  env: AppEnv,
  userId: string,
  options: { watchlistId?: string | null; channel?: DeliveryChannel; limit?: number } = {},
) {
  const clauses = ["user_id = ?"];
  const bindings: unknown[] = [userId];
  if (options.watchlistId !== undefined) {
    clauses.push(options.watchlistId === null ? "watchlist_id IS NULL" : "watchlist_id = ?");
    if (options.watchlistId !== null) {
      bindings.push(options.watchlistId);
    }
  }
  if (options.channel) {
    clauses.push("channel = ?");
    bindings.push(options.channel);
  }

  const rows = await many<DeliveryTargetRow>(
    env,
    `
      SELECT *
      FROM delivery_target
      WHERE ${clauses.join(" AND ")}
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    ...bindings,
    options.limit ?? 20,
  );

  return rows.map(toDeliveryTargetRecord);
}

export async function getDeliveryTargetReadinessStats(env: AppEnv, userId: string) {
  const row = await one<{
    active_count: number | null;
    proven_count: number | null;
  }>(
    env,
    `
      WITH usable_targets AS (
        SELECT last_successful_delivery_at
        FROM delivery_target
        WHERE user_id = ?
          AND (
            (
              channel = 'email'
              AND is_opted_in = 1
              AND is_paused = 0
              AND opted_out_at IS NULL
              AND is_validated = 1
              AND validation_status = 'validated'
            )
            OR (
              channel = 'slack'
              AND is_opted_in = 1
              AND is_paused = 0
              AND opted_out_at IS NULL
              AND is_validated = 1
              AND validation_status = 'validated'
            )
            OR (
              channel = 'whatsapp'
              AND is_opted_in = 1
              AND is_paused = 0
              AND opted_out_at IS NULL
              AND is_validated = 1
              AND validation_status = 'validated'
              AND template_eligible = 1
            )
          )
      )
      SELECT
        COUNT(*) AS active_count,
        SUM(CASE
          WHEN last_successful_delivery_at IS NOT NULL
          THEN 1 ELSE 0
        END) AS proven_count
      FROM usable_targets
    `,
    userId,
  );

  return {
    activeCount: Number(row?.active_count ?? 0),
    provenCount: Number(row?.proven_count ?? 0),
  };
}

export async function upsertDeliveryTarget(
  env: AppEnv,
  input: {
    userId: string;
    watchlistId?: string | null;
    channel: DeliveryChannel;
    targetValue: string;
    validationStatus?: DeliveryTargetValidationStatus;
    isValidated?: boolean;
    isOptedIn?: boolean;
    optInSource?: string | null;
    optedInAt?: string | null;
    isPaused?: boolean;
    pausedAt?: string | null;
    optedOutAt?: string | null;
    templateEligible?: boolean;
    lastSuccessfulDeliveryAt?: string | null;
    lastSuccessfulAttemptId?: string | null;
    providerIdentifier?: string | null;
    metadata?: JsonRecord;
  },
) {
  const existingTarget = await getDeliveryTargetByUniqueFields(env, {
    userId: input.userId,
    watchlistId: input.watchlistId ?? null,
    channel: input.channel,
    targetValue: input.targetValue,
  });
  const timestamp = nowIso();
  if (existingTarget) {
    await run(
      env,
      `
        UPDATE delivery_target
        SET validation_status = ?,
            is_validated = ?,
            is_opted_in = ?,
            opt_in_source = ?,
            opted_in_at = ?,
            is_paused = ?,
            paused_at = ?,
            opted_out_at = ?,
            template_eligible = ?,
            last_successful_delivery_at = ?,
            last_successful_attempt_id = ?,
            provider_identifier = ?,
            metadata_json = ?,
            updated_at = ?
        WHERE id = ?
      `,
      input.validationStatus ?? "pending",
      boolToInt(input.isValidated ?? false),
      boolToInt(input.isOptedIn ?? false),
      input.optInSource ?? null,
      input.optedInAt ?? null,
      boolToInt(input.isPaused ?? false),
      input.pausedAt ?? null,
      input.optedOutAt ?? null,
      boolToInt(input.templateEligible ?? false),
      input.lastSuccessfulDeliveryAt ?? null,
      input.lastSuccessfulAttemptId ?? null,
      input.providerIdentifier ?? null,
      jsonValue(input.metadata ?? {}),
      timestamp,
      existingTarget.id,
    );
  } else {
    await run(
      env,
      `
        INSERT INTO delivery_target (
          id,
          user_id,
          watchlist_id,
          channel,
          target_value,
          validation_status,
          is_validated,
          is_opted_in,
          opt_in_source,
          opted_in_at,
          is_paused,
          paused_at,
          opted_out_at,
          template_eligible,
          last_successful_delivery_at,
          last_successful_attempt_id,
          provider_identifier,
          metadata_json,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      createId(),
      input.userId,
      input.watchlistId ?? null,
      input.channel,
      input.targetValue,
      input.validationStatus ?? "pending",
      boolToInt(input.isValidated ?? false),
      boolToInt(input.isOptedIn ?? false),
      input.optInSource ?? null,
      input.optedInAt ?? null,
      boolToInt(input.isPaused ?? false),
      input.pausedAt ?? null,
      input.optedOutAt ?? null,
      boolToInt(input.templateEligible ?? false),
      input.lastSuccessfulDeliveryAt ?? null,
      input.lastSuccessfulAttemptId ?? null,
      input.providerIdentifier ?? null,
      jsonValue(input.metadata ?? {}),
      timestamp,
      timestamp,
    );
  }

  const [target] = await listDeliveryTargets(env, input.userId, {
    watchlistId: input.watchlistId ?? null,
    channel: input.channel,
    limit: 1,
  });
  return target ?? null;
}

async function getDeliveryTargetByUniqueFields(
  env: AppEnv,
  input: {
    userId: string;
    watchlistId: string | null;
    channel: DeliveryChannel;
    targetValue: string;
  },
) {
  const row = await one<DeliveryTargetRow>(
    env,
    `
      SELECT *
      FROM delivery_target
      WHERE user_id = ?
        AND ${input.watchlistId === null ? "watchlist_id IS NULL" : "watchlist_id = ?"}
        AND channel = ?
        AND target_value = ?
      LIMIT 1
    `,
    ...[
      input.userId,
      ...(input.watchlistId === null ? [] : [input.watchlistId]),
      input.channel,
      input.targetValue,
    ],
  );

  return row ? toDeliveryTargetRecord(row) : null;
}

export async function getDeliveryTargetById(
  env: AppEnv,
  input: {
    userId: string;
    targetId: string;
  },
) {
  const row = await one<DeliveryTargetRow>(
    env,
    `
      SELECT *
      FROM delivery_target
      WHERE user_id = ?
        AND id = ?
      LIMIT 1
    `,
    input.userId,
    input.targetId,
  );

  return row ? toDeliveryTargetRecord(row) : null;
}

export async function getDeliveryTargetByProviderIdentifier(
  env: AppEnv,
  input: {
    channel: DeliveryChannel;
    providerIdentifier: string;
  },
) {
  const row = await one<DeliveryTargetRow>(
    env,
    `
      SELECT *
      FROM delivery_target
      WHERE channel = ?
        AND provider_identifier = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    input.channel,
    input.providerIdentifier,
  );

  return row ? toDeliveryTargetRecord(row) : null;
}

export async function getUserDeliveryProfile(env: AppEnv, userId: string) {
  const row = await one<{ id: string; email: string | null; name: string | null }>(
    env,
    `
      SELECT id, email, name
      FROM user
      WHERE id = ?
      LIMIT 1
    `,
    userId,
  );

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    name: row.name ?? "",
  };
}

export async function listDeliveryAttempts(
  env: AppEnv,
  options: {
    userId?: string;
    watchlistId?: string;
    channel?: DeliveryChannel;
    targetValue?: string;
    limit?: number;
  } = {},
) {
  const clauses = ["1 = 1"];
  const bindings: unknown[] = [];
  if (options.userId) {
    clauses.push("user_id = ?");
    bindings.push(options.userId);
  }
  if (options.watchlistId) {
    clauses.push("watchlist_id = ?");
    bindings.push(options.watchlistId);
  }
  if (options.channel) {
    clauses.push("channel = ?");
    bindings.push(options.channel);
  }
  if (options.targetValue) {
    clauses.push("target_value = ?");
    bindings.push(options.targetValue);
  }

  const rows = await many<DeliveryAttemptRow>(
    env,
    `
      SELECT *
      FROM delivery_attempt
      WHERE ${clauses.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT ?
    `,
    ...bindings,
    options.limit ?? 40,
  );

  return rows.map(toDeliveryAttemptRecord);
}

export async function getDeliveryAttemptByIdempotencyKey(
  env: AppEnv,
  idempotencyKey: string,
) {
  const row = await one<DeliveryAttemptRow>(
    env,
    "SELECT * FROM delivery_attempt WHERE idempotency_key = ?",
    idempotencyKey,
  );

  return row ? toDeliveryAttemptRecord(row) : null;
}

export async function getOperatorSnapshot(env: AppEnv) {
  const stuckThresholdIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const recentWindowIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    failingRuns,
    stuckRuns,
    failedProofs,
    budgetBlockedProofs,
    blockedTargets,
    deliveryFailures,
    degradedWatchlists,
    discoveryFailures,
    discoveryProviders,
  ] = await Promise.all([
    many<{
      run_id: string;
      watchlist_id: string;
      watchlist_name: string;
      started_at: string;
      error_code: string | null;
      error_message: string | null;
    }>(
      env,
      `
        SELECT
          watchlist_run.id AS run_id,
          watchlist.id AS watchlist_id,
          watchlist.name AS watchlist_name,
          watchlist_run.started_at,
          watchlist_run.error_code,
          watchlist_run.error_message
        FROM watchlist_run
        INNER JOIN watchlist ON watchlist.id = watchlist_run.watchlist_id
        WHERE watchlist_run.status = 'failed'
          AND watchlist_run.started_at >= ?
        ORDER BY watchlist_run.started_at DESC
        LIMIT 8
      `,
      recentWindowIso,
    ),
    many<{
      run_id: string;
      watchlist_id: string;
      watchlist_name: string;
      status: string;
      started_at: string;
    }>(
      env,
      `
        SELECT
          watchlist_run.id AS run_id,
          watchlist.id AS watchlist_id,
          watchlist.name AS watchlist_name,
          watchlist_run.status,
          watchlist_run.started_at
        FROM watchlist_run
        INNER JOIN watchlist ON watchlist.id = watchlist_run.watchlist_id
        WHERE watchlist_run.status IN ('pending', 'running')
          AND watchlist_run.started_at <= ?
        ORDER BY watchlist_run.started_at ASC
        LIMIT 8
      `,
      stuckThresholdIso,
    ),
    many<{
      proof_capture_id: string;
      watchlist_id: string;
      watchlist_name: string;
      attempted_at: string;
      failure_code: string | null;
      failure_reason: string | null;
    }>(
      env,
      `
        SELECT
          proof_capture.id AS proof_capture_id,
          watchlist.id AS watchlist_id,
          watchlist.name AS watchlist_name,
          proof_capture.attempted_at,
          proof_capture.failure_code,
          proof_capture.failure_reason
        FROM proof_capture
        INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
        INNER JOIN watchlist ON watchlist.id = proof_target.watchlist_id
        WHERE proof_capture.status = 'failed'
          AND proof_capture.attempted_at >= ?
        ORDER BY proof_capture.attempted_at DESC
        LIMIT 8
      `,
      recentWindowIso,
    ),
    many<{
      proof_capture_id: string;
      watchlist_id: string;
      watchlist_name: string;
      status: ProofStatus;
      attempted_at: string;
    }>(
      env,
      `
        SELECT
          proof_capture.id AS proof_capture_id,
          watchlist.id AS watchlist_id,
          watchlist.name AS watchlist_name,
          proof_capture.status,
          proof_capture.attempted_at
        FROM proof_capture
        INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
        INNER JOIN watchlist ON watchlist.id = proof_target.watchlist_id
        WHERE proof_capture.status IN ('skipped_due_to_budget', 'skipped_due_to_rate_limit')
          AND proof_capture.attempted_at >= ?
        ORDER BY proof_capture.attempted_at DESC
        LIMIT 8
      `,
      recentWindowIso,
    ),
    many<{
      delivery_target_id: string;
      watchlist_id: string | null;
      watchlist_name: string | null;
      channel: DeliveryChannel;
      target_value: string;
      is_opted_in: number;
      is_validated: number;
      is_paused: number;
      template_eligible: number;
      updated_at: string;
    }>(
      env,
      `
        SELECT
          delivery_target.id AS delivery_target_id,
          delivery_target.watchlist_id,
          watchlist.name AS watchlist_name,
          delivery_target.channel,
          delivery_target.target_value,
          delivery_target.is_opted_in,
          delivery_target.is_validated,
          delivery_target.is_paused,
          delivery_target.template_eligible,
          delivery_target.updated_at
        FROM delivery_target
        LEFT JOIN watchlist ON watchlist.id = delivery_target.watchlist_id
        WHERE delivery_target.channel = 'whatsapp'
          AND (
            delivery_target.is_opted_in = 0 OR
            delivery_target.is_validated = 0 OR
            delivery_target.is_paused = 1 OR
            delivery_target.template_eligible = 0 OR
            delivery_target.opted_out_at IS NOT NULL
          )
        ORDER BY delivery_target.updated_at DESC
        LIMIT 8
      `,
    ),
    many<{
      attempt_id: string;
      watchlist_id: string | null;
      watchlist_name: string | null;
      channel: DeliveryChannel;
      target_value: string;
      error_message: string | null;
      created_at: string;
    }>(
      env,
      `
        SELECT
          delivery_attempt.id AS attempt_id,
          delivery_attempt.watchlist_id,
          watchlist.name AS watchlist_name,
          delivery_attempt.channel,
          delivery_attempt.target_value,
          delivery_attempt.error_message,
          delivery_attempt.created_at
        FROM delivery_attempt
        LEFT JOIN watchlist ON watchlist.id = delivery_attempt.watchlist_id
        WHERE delivery_attempt.status = 'failed'
          AND delivery_attempt.created_at >= ?
        ORDER BY delivery_attempt.created_at DESC
        LIMIT 8
      `,
      recentWindowIso,
    ),
    many<{
      watchlist_id: string;
      watchlist_name: string;
      failed_runs: number;
      failed_proofs: number;
      failed_deliveries: number;
      last_seen_at: string | null;
    }>(
      env,
      `
        SELECT
          watchlist.id AS watchlist_id,
          watchlist.name AS watchlist_name,
          (
            SELECT COUNT(*)
            FROM watchlist_run
            WHERE watchlist_run.watchlist_id = watchlist.id
              AND watchlist_run.status = 'failed'
              AND watchlist_run.started_at >= ?
          ) AS failed_runs,
          (
            SELECT COUNT(*)
            FROM proof_target
            INNER JOIN proof_capture ON proof_capture.proof_target_id = proof_target.id
            WHERE proof_target.watchlist_id = watchlist.id
              AND proof_capture.status = 'failed'
              AND proof_capture.attempted_at >= ?
          ) AS failed_proofs,
          (
            SELECT COUNT(*)
            FROM delivery_attempt
            WHERE delivery_attempt.watchlist_id = watchlist.id
              AND delivery_attempt.status = 'failed'
              AND delivery_attempt.created_at >= ?
          ) AS failed_deliveries,
          (
            SELECT MAX(ts) FROM (
              SELECT watchlist_run.started_at AS ts
              FROM watchlist_run
              WHERE watchlist_run.watchlist_id = watchlist.id
              UNION ALL
              SELECT proof_capture.attempted_at AS ts
              FROM proof_target
              INNER JOIN proof_capture ON proof_capture.proof_target_id = proof_target.id
              WHERE proof_target.watchlist_id = watchlist.id
              UNION ALL
              SELECT delivery_attempt.created_at AS ts
              FROM delivery_attempt
              WHERE delivery_attempt.watchlist_id = watchlist.id
            )
          ) AS last_seen_at
        FROM watchlist
        WHERE watchlist.is_active = 1
        GROUP BY watchlist.id
        HAVING failed_runs > 0 OR failed_proofs > 0 OR failed_deliveries > 0
        ORDER BY (failed_runs + failed_proofs + failed_deliveries) DESC, last_seen_at DESC
        LIMIT 8
      `,
      recentWindowIso,
      recentWindowIso,
      recentWindowIso,
    ),
    many<{
      fetchId: string;
      provider: AdDiscoveryProvider;
      routeContext: DiscoveryRouteContext;
      country: string;
      cacheStatus: DiscoveryCacheStatus;
      failureClass: DiscoveryFailureClass | null;
      browserMsUsed: number | null;
      createdAt: string;
    }>(
      env,
      `
        SELECT
          discovery_fetch_log.id AS fetchId,
          discovery_fetch_log.provider,
          discovery_fetch_log.route_context AS routeContext,
          discovery_fetch_log.country,
          discovery_fetch_log.cache_status AS cacheStatus,
          discovery_fetch_log.failure_class AS failureClass,
          discovery_fetch_log.browser_ms_used AS browserMsUsed,
          discovery_fetch_log.created_at AS createdAt
        FROM discovery_fetch_log
        WHERE discovery_fetch_log.status = 'failed'
          AND discovery_fetch_log.created_at >= ?
        ORDER BY discovery_fetch_log.created_at DESC
        LIMIT 8
      `,
      recentWindowIso,
    ),
    many<{
      provider: AdDiscoveryProvider;
      status: MetaIntegrationStatus["status"];
      failureClass: DiscoveryFailureClass | null;
      summary: string;
      lastSuccessAt: string | null;
      lastFailureAt: string | null;
      updatedAt: string;
    }>(
      env,
      `
        SELECT
          provider,
          status,
          failure_class AS failureClass,
          summary,
          last_success_at AS lastSuccessAt,
          last_failure_at AS lastFailureAt,
          updated_at AS updatedAt
        FROM discovery_provider_state
        ORDER BY updated_at DESC
        LIMIT 4
      `,
    ),
  ]);

  return {
    summary: {
      failingRuns: failingRuns.length,
      stuckRuns: stuckRuns.length,
      failedProofs: failedProofs.length,
      budgetBlockedProofs: budgetBlockedProofs.length,
      blockedTargets: blockedTargets.length,
      deliveryFailures: deliveryFailures.length,
      degradedWatchlists: degradedWatchlists.length,
      discoveryFailures: discoveryFailures.length,
      discoveryProvidersNeedingAttention: discoveryProviders.filter(
        (provider) => provider.status !== "healthy",
      ).length,
    },
    failingRuns,
    stuckRuns,
    failedProofs,
    budgetBlockedProofs,
    blockedTargets,
    deliveryFailures,
    degradedWatchlists,
    discoveryFailures,
    discoveryProviders,
  };
}

export async function reconcileDeliveryAttemptByProviderMessageId(
  env: AppEnv,
  input: {
    provider: string;
    providerMessageId: string;
    webhookStatus: WebhookReconciliationStatus;
    status?: DeliveryAttemptStatus | null;
    providerStatusLastSeenAt: string;
    errorMessage?: string | null;
  },
) {
  const existing = await one<DeliveryAttemptRow>(
    env,
    `
      SELECT *
      FROM delivery_attempt
      WHERE provider = ?
        AND provider_message_id = ?
    `,
    input.provider,
    input.providerMessageId,
  );

  if (!existing) {
    return null;
  }

  const nextStatus = input.status ?? existing.status;
  const nextFailedAt =
    nextStatus === "failed" && !existing.failed_at
      ? input.providerStatusLastSeenAt
      : existing.failed_at;
  const nextSentAt =
    nextStatus === "sent" && !existing.sent_at
      ? input.providerStatusLastSeenAt
      : existing.sent_at;

  await run(
    env,
    `
      UPDATE delivery_attempt
      SET status = ?,
          webhook_status = ?,
          provider_status_last_seen_at = ?,
          error_message = COALESCE(?, error_message),
          sent_at = ?,
          failed_at = ?,
          updated_at = ?
      WHERE id = ?
    `,
    nextStatus,
    input.webhookStatus,
    input.providerStatusLastSeenAt,
    input.errorMessage ?? null,
    nextSentAt,
    nextFailedAt,
    nowIso(),
    existing.id,
  );

  const updated = await one<DeliveryAttemptRow>(
    env,
    "SELECT * FROM delivery_attempt WHERE id = ?",
    existing.id,
  );

  return updated ? toDeliveryAttemptRecord(updated) : null;
}

export async function createDeliveryAttempt(
  env: AppEnv,
  input: {
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
    providerMessageId?: string | null;
    providerStatusLastSeenAt?: string | null;
    templateName?: string | null;
    eventIds?: string[];
    payloadSnapshot?: JsonRecord;
    idempotencyKey?: string | null;
    errorMessage?: string | null;
    sentAt?: string | null;
    failedAt?: string | null;
  },
) {
  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO delivery_attempt (
        id,
        user_id,
        watchlist_id,
        digest_run_id,
        delivery_target_id,
        lane,
        channel,
        provider,
        status,
        webhook_status,
        target_value,
        provider_message_id,
        provider_status_last_seen_at,
        template_name,
        event_ids_json,
        payload_snapshot_json,
        idempotency_key,
        error_message,
        sent_at,
        failed_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    id,
    input.userId,
    input.watchlistId,
    input.digestRunId,
    input.deliveryTargetId,
    input.lane,
    input.channel,
    input.provider,
    input.status,
    input.webhookStatus,
    input.targetValue,
    input.providerMessageId ?? null,
    input.providerStatusLastSeenAt ?? null,
    input.templateName ?? null,
    jsonValue(input.eventIds ?? []),
    jsonValue(input.payloadSnapshot ?? {}),
    input.idempotencyKey ?? null,
    input.errorMessage ?? null,
    input.sentAt ?? null,
    input.failedAt ?? null,
    timestamp,
    timestamp,
  );

  return id;
}

export async function updateDeliveryAttemptResult(
  env: AppEnv,
  attemptId: string,
  input: {
    provider: string;
    status: DeliveryAttemptStatus;
    webhookStatus: WebhookReconciliationStatus;
    providerMessageId?: string | null;
    providerStatusLastSeenAt?: string | null;
    errorMessage?: string | null;
    sentAt?: string | null;
    failedAt?: string | null;
  },
) {
  await run(
    env,
    `
      UPDATE delivery_attempt
      SET provider = ?,
          status = ?,
          webhook_status = ?,
          provider_message_id = ?,
          provider_status_last_seen_at = ?,
          error_message = ?,
          sent_at = ?,
          failed_at = ?,
          updated_at = ?
      WHERE id = ?
    `,
    input.provider,
    input.status,
    input.webhookStatus,
    input.providerMessageId ?? null,
    input.providerStatusLastSeenAt ?? null,
    input.errorMessage ?? null,
    input.sentAt ?? null,
    input.failedAt ?? null,
    nowIso(),
    attemptId,
  );
}

export async function createLandingPageSnapshot(
  env: AppEnv,
  snapshot: NonNullable<AdRecord["landingPage"]>,
) {
  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO landing_page_snapshot (
        id,
        raw_url,
        canonical_url,
        raw_headline,
        normalized_headline,
        normalized_headline_hash,
        capture_method,
        artifact_key,
        metadata_json,
        cta_text,
        price_text,
        form_present,
        ocr_text,
        translated_text,
        captured_at,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
    `,
    id,
    snapshot.rawUrl,
    snapshot.canonicalUrl,
    snapshot.rawHeadline,
    snapshot.normalizedHeadline,
    snapshot.normalizedHeadlineHash,
    snapshot.captureMethod,
    snapshot.artifactKey ?? null,
    jsonValue(snapshot.metadata ?? null),
    snapshot.ctaText ?? null,
    snapshot.priceText ?? null,
    typeof snapshot.formPresent === "boolean" ? (snapshot.formPresent ? 1 : 0) : null,
    snapshot.capturedAt,
    timestamp,
  );

  await replaceAnalysisFields(env, "landing_page", id, buildLandingPageAnalysisFields(snapshot));

  return id;
}

export async function createAdObservation(
  env: AppEnv,
  input: {
    adId: string;
    watchlistRunId: string;
    landingPageSnapshotId: string | null;
    landingPageUrl: string | null;
    seenAt: string;
    isActive: boolean;
    metadata?: JsonRecord;
  },
) {
  const id = createId();
  await run(
    env,
    `
      INSERT INTO ad_observation (
        id,
        ad_id,
        watchlist_run_id,
        landing_page_snapshot_id,
        seen_at,
        is_active,
        landing_page_url,
        metadata_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    id,
    input.adId,
    input.watchlistRunId,
    input.landingPageSnapshotId,
    input.seenAt,
    input.isActive ? 1 : 0,
    input.landingPageUrl,
    jsonValue(input.metadata ?? {}),
    nowIso(),
  );

  return id;
}

export async function listObservationsForRun(env: AppEnv, runId: string) {
  return many<ObservationRow>(
    env,
    `
      SELECT
        ad_observation.id,
        ad_observation.ad_id,
        ad_observation.watchlist_run_id,
        ad_observation.landing_page_snapshot_id,
        ad_observation.landing_page_url,
        ad_observation.seen_at,
        ad_observation.is_active,
        ad_observation.metadata_json,
        landing_page_snapshot.normalized_headline_hash,
        landing_page_snapshot.raw_headline
      FROM ad_observation
      LEFT JOIN landing_page_snapshot
        ON landing_page_snapshot.id = ad_observation.landing_page_snapshot_id
      WHERE ad_observation.watchlist_run_id = ?
    `,
    runId,
  );
}

export async function createDigestRun(
  env: AppEnv,
  userId: string,
  periodStart: string,
  periodEnd: string,
  summary: JsonRecord,
) {
  const id = createId();
  await run(
    env,
    `
      INSERT OR IGNORE INTO digest_run (
        id,
        user_id,
        period_start,
        period_end,
        summary_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    id,
    userId,
    periodStart,
    periodEnd,
    jsonValue(summary),
    nowIso(),
  );

  const row = await one<DigestRunRow>(
    env,
    `
      SELECT *
      FROM digest_run
      WHERE user_id = ?
        AND period_start = ?
        AND period_end = ?
      LIMIT 1
    `,
    userId,
    periodStart,
    periodEnd,
  );

  return row?.id ?? id;
}

export async function clearDigestItems(env: AppEnv, digestRunId: string) {
  await run(env, "DELETE FROM digest_item WHERE digest_run_id = ?", digestRunId);
}

export async function addDigestItem(
  env: AppEnv,
  digestRunId: string,
  input: {
    watchlistId: string;
    watchlistName: string;
    eventType: WatchEventType;
    title: string;
    summary: string;
    metadata?: JsonRecord;
  },
) {
  await run(
    env,
    `
      INSERT INTO digest_item (
        id,
        digest_run_id,
        watchlist_id,
        watchlist_name,
        event_type,
        title,
        summary,
        metadata_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    createId(),
    digestRunId,
    input.watchlistId,
    input.watchlistName,
    input.eventType,
    input.title,
    input.summary,
    jsonValue(input.metadata ?? {}),
    nowIso(),
  );
}

export async function upsertDigestDelivery(
  env: AppEnv,
  digestRunId: string,
  input: Omit<DigestDeliveryRecord, "id" | "digestRunId">,
) {
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO digest_delivery (
        id,
        digest_run_id,
        provider,
        status,
        recipient_email,
        external_message_id,
        error_message,
        delivered_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(digest_run_id)
      DO UPDATE SET provider = excluded.provider,
                    status = excluded.status,
                    recipient_email = excluded.recipient_email,
                    external_message_id = excluded.external_message_id,
                    error_message = excluded.error_message,
                    delivered_at = excluded.delivered_at,
                    updated_at = excluded.updated_at
    `,
    createId(),
    digestRunId,
    input.provider,
    input.status,
    input.recipientEmail,
    input.externalMessageId,
    input.errorMessage,
    input.deliveredAt,
    timestamp,
    timestamp,
  );
}

const DIGEST_RUN_LIST_LIMIT = 60;

export async function listDigests(
  env: AppEnv,
  userId: string,
  limit: number = DIGEST_RUN_LIST_LIMIT,
) {
  const runs = await many<DigestRunRow>(
    env,
    `
      SELECT *
      FROM digest_run
      WHERE user_id = ?
      ORDER BY period_end DESC
      LIMIT ?
    `,
    userId,
    limit,
  );

  if (runs.length === 0) {
    return [];
  }

  // Join through digest_run instead of expanding run ids into `IN (?, ...)`:
  // D1 caps bound parameters at 100, so long-tenured users with many digest
  // runs would otherwise break this query permanently. Rows from runs that
  // tie on the oldest period_end but fall outside `runs` are ignored by the
  // run-id maps below.
  const oldestPeriodEnd = runs[runs.length - 1]!.period_end;
  const [items, deliveries] = await Promise.all([
    many<DigestItemRow>(
      env,
      `
        SELECT digest_item.*
        FROM digest_item
        INNER JOIN digest_run ON digest_run.id = digest_item.digest_run_id
        WHERE digest_run.user_id = ? AND digest_run.period_end >= ?
        ORDER BY digest_item.created_at ASC
      `,
      userId,
      oldestPeriodEnd,
    ),
    many<DigestDeliveryRow>(
      env,
      `
        SELECT digest_delivery.*
        FROM digest_delivery
        INNER JOIN digest_run ON digest_run.id = digest_delivery.digest_run_id
        WHERE digest_run.user_id = ? AND digest_run.period_end >= ?
      `,
      userId,
      oldestPeriodEnd,
    ),
  ]);
  const itemsByDigestId = new Map<string, DigestItemRow[]>();
  const deliveryByDigestId = new Map<string, DigestDeliveryRow>();

  for (const item of items) {
    const group = itemsByDigestId.get(item.digest_run_id) ?? [];
    group.push(item);
    itemsByDigestId.set(item.digest_run_id, group);
  }

  for (const delivery of deliveries) {
    deliveryByDigestId.set(delivery.digest_run_id, delivery);
  }

  return runs.map((run) => {
    const delivery = deliveryByDigestId.get(run.id) ?? null;
    return {
      id: run.id,
      userId: run.user_id,
      periodStart: run.period_start,
      periodEnd: run.period_end,
      createdAt: run.created_at,
      items: (itemsByDigestId.get(run.id) ?? []).map(toDigestItemRecord),
      delivery: delivery ? toDigestDeliveryRecord(delivery) : null,
    };
  });
}

export async function getDigest(env: AppEnv, digestRunId: string) {
  const run = await one<DigestRunRow>(env, "SELECT * FROM digest_run WHERE id = ?", digestRunId);
  if (!run) {
    return null;
  }
  const [items, delivery] = await Promise.all([
    many<DigestItemRow>(
      env,
      "SELECT * FROM digest_item WHERE digest_run_id = ? ORDER BY created_at ASC",
      digestRunId,
    ),
    one<DigestDeliveryRow>(env, "SELECT * FROM digest_delivery WHERE digest_run_id = ?", digestRunId),
  ]);

  return {
    id: run.id,
    userId: run.user_id,
    periodStart: run.period_start,
    periodEnd: run.period_end,
    createdAt: run.created_at,
    items: items.map(toDigestItemRecord),
    delivery: delivery ? toDigestDeliveryRecord(delivery) : null,
  } satisfies DigestRecord;
}

export async function getDigestByPeriod(
  env: AppEnv,
  userId: string,
  periodStart: string,
  periodEnd: string,
) {
  const row = await one<DigestRunRow>(
    env,
    `
      SELECT *
      FROM digest_run
      WHERE user_id = ?
        AND period_start = ?
        AND period_end = ?
      LIMIT 1
    `,
    userId,
    periodStart,
    periodEnd,
  );

  if (!row) {
    return null;
  }

  return getDigest(env, row.id);
}

export async function listRetryableDigestRuns(
  env: AppEnv,
  input: {
    since: string;
    limit: number;
  },
) {
  const rows = await many<
    DigestRunRow & { user_email: string; user_name: string }
  >(
    env,
    `
      SELECT digest_run.*, user.email AS user_email, user.name AS user_name
      FROM digest_run
      INNER JOIN user ON user.id = digest_run.user_id
      LEFT JOIN digest_delivery ON digest_delivery.digest_run_id = digest_run.id
      WHERE digest_run.period_end >= ?
        AND (digest_delivery.status = 'failed' OR digest_delivery.id IS NULL)
      ORDER BY digest_run.period_end ASC
      LIMIT ?
    `,
    input.since,
    input.limit,
  );

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    userName: row.user_name,
    periodStart: row.period_start,
    periodEnd: row.period_end,
  }));
}

export const SHARE_LINK_DEFAULT_TTL_DAYS = 90;

export async function createShareLink(
  env: AppEnv,
  session: AppSession,
  input: {
    resourceType: ShareResourceType;
    resourceId: string;
    isSnapshot: boolean;
    snapshotPayload?: JsonRecord | null;
    expiresAt?: string | null;
  },
) {
  const id = createId();
  const token = crypto.randomUUID().replaceAll("-", "");
  const expiresAt =
    input.expiresAt !== undefined
      ? input.expiresAt
      : new Date(Date.now() + SHARE_LINK_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await run(
    env,
    `
      INSERT INTO share_link (
        id,
        token,
        user_id,
        resource_type,
        resource_id,
        is_snapshot,
        snapshot_payload_json,
        created_at,
        expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    id,
    token,
    session.user.id,
    input.resourceType,
    input.resourceId,
    input.isSnapshot ? 1 : 0,
    input.snapshotPayload ? jsonValue(input.snapshotPayload) : null,
    nowIso(),
    expiresAt,
  );

  return { id, token, expiresAt };
}

export async function getShareLink(env: AppEnv, token: string) {
  // Share tokens are bearer credentials; expired or revoked links must
  // behave exactly like links that never existed. expires_at NULL is legacy
  // (pre-expiry links customers already sent out).
  const row = await one<ShareLinkRow>(
    env,
    `
      SELECT *
      FROM share_link
      WHERE token = ?
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
    `,
    token,
    nowIso(),
  );

  if (!row) {
    return null;
  }

  return toShareLinkRecord(row);
}

export async function getShareLinkById(env: AppEnv, userId: string, shareLinkId: string) {
  const row = await one<ShareLinkRow>(
    env,
    `
      SELECT *
      FROM share_link
      WHERE id = ?
        AND user_id = ?
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
      LIMIT 1
    `,
    shareLinkId,
    userId,
    nowIso(),
  );

  return row ? toShareLinkRecord(row) : null;
}

export async function listActiveShareLinks(env: AppEnv, userId: string, limit = 50) {
  const rows = await many<ShareLinkRow>(
    env,
    `
      SELECT *
      FROM share_link
      WHERE user_id = ?
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY created_at DESC
      LIMIT ?
    `,
    userId,
    nowIso(),
    limit,
  );

  return rows.map(toShareLinkRecord);
}

export async function revokeShareLink(env: AppEnv, userId: string, shareLinkId: string) {
  const db = ensureDb(env);
  const result = await db
    .prepare(
      `
        UPDATE share_link
        SET revoked_at = ?
        WHERE id = ?
          AND user_id = ?
          AND revoked_at IS NULL
      `,
    )
    .bind(nowIso(), shareLinkId, userId)
    .run();

  return Number(result.meta?.changes ?? 0) > 0;
}

export const WORKSPACE_BRAND_NAME_MAX_LENGTH = 60;

function normalizeWorkspaceBrandName(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().slice(0, WORKSPACE_BRAND_NAME_MAX_LENGTH).trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function getWorkspaceBranding(env: AppEnv, userId: string) {
  const row = await one<WorkspaceBrandingRow>(
    env,
    `
      SELECT user_id, brand_name, updated_at
      FROM workspace_branding
      WHERE user_id = ?
    `,
    userId,
  );

  return { brandName: row?.brand_name ?? null };
}

export async function upsertWorkspaceBranding(
  env: AppEnv,
  userId: string,
  input: { brandName: string | null | undefined },
) {
  const brandName = normalizeWorkspaceBrandName(input.brandName);

  await run(
    env,
    `
      INSERT INTO workspace_branding (user_id, brand_name, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        brand_name = excluded.brand_name,
        updated_at = excluded.updated_at
    `,
    userId,
    brandName,
    nowIso(),
  );

  return { brandName };
}

function toShareLinkRecord(row: ShareLinkRow): ShareLinkRecord {
  return {
    id: row.id,
    token: row.token,
    userId: row.user_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    isSnapshot: row.is_snapshot === 1,
    snapshotPayload: parseJson<JsonRecord | null>(row.snapshot_payload_json, null),
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? null,
    revokedAt: row.revoked_at ?? null,
  } satisfies ShareLinkRecord;
}

function toCustomerMetaConnectionRecord(
  row: CustomerMetaConnectionRow,
): CustomerMetaConnectionRecord {
  return {
    userId: row.user_id,
    encryptedAccessToken: row.encrypted_access_token,
    tokenLastFour: row.token_last_four,
    tokenFingerprint: row.token_fingerprint,
    status: row.status,
    summary: row.summary,
    lastCheckedAt: row.last_checked_at,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCustomerApiKeyRecord(row: CustomerApiKeyRow): CustomerApiKeyRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    actionsWriteEnabled: row.actions_write_enabled === 1,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAgentActionAuditRecord(row: AgentActionAuditRow): AgentActionAuditRecord {
  return {
    id: row.id,
    userId: row.user_id,
    apiKeyId: row.api_key_id ?? null,
    actionName: row.action_name,
    resourceType: row.resource_type ?? null,
    resourceId: row.resource_id ?? null,
    idempotencyKey: row.idempotency_key ?? null,
    status: row.status,
    result: parseJson<Record<string, unknown> | null>(row.result_json, null),
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAgentMemoryRecord(row: AgentMemoryRow): AgentMemoryRecord {
  return {
    id: row.id,
    userId: row.user_id,
    scope: row.scope,
    key: row.memory_key,
    watchlistId: row.watchlist_id ?? null,
    clientRoomId: row.client_room_id ?? null,
    value: parseJson<Record<string, unknown>>(row.value_json, {}),
    source: row.source ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toClientRoomRecord(row: ClientRoomRow, resourceRefs: ClientRoomResourceRef[] = []): ClientRoomRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    clientLabel: row.client_label ?? null,
    status: row.status,
    resourceRefs,
    notes: parseJson<Record<string, unknown>>(row.notes_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listCustomerApiKeys(env: AppEnv, userId: string) {
  const rows = await many<CustomerApiKeyRow>(
    env,
    `
      SELECT *
      FROM customer_api_key
      WHERE user_id = ?
      ORDER BY revoked_at ASC, created_at DESC
    `,
    userId,
  );

  return rows.map(toCustomerApiKeyRecord);
}

export async function insertCustomerApiKey(
  env: AppEnv,
  input: {
    userId: string;
    name: string;
    keyPrefix: string;
    keyHash: string;
    actionsWriteEnabled?: boolean;
  },
) {
  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO customer_api_key (
        id,
        user_id,
        name,
        key_prefix,
        key_hash,
        actions_write_enabled,
        last_used_at,
        revoked_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
    `,
    id,
    input.userId,
    input.name,
    input.keyPrefix,
    input.keyHash,
    boolToInt(Boolean(input.actionsWriteEnabled)),
    timestamp,
    timestamp,
  );

  const row = await one<CustomerApiKeyRow>(
    env,
    "SELECT * FROM customer_api_key WHERE id = ?",
    id,
  );

  if (!row) {
    throw new Error("Created API key could not be loaded.");
  }

  return toCustomerApiKeyRecord(row);
}

export async function getActiveCustomerApiKeyByHash(env: AppEnv, keyHash: string) {
  const row = await one<CustomerApiKeyRow>(
    env,
    `
      SELECT *
      FROM customer_api_key
      WHERE key_hash = ?
        AND revoked_at IS NULL
      LIMIT 1
    `,
    keyHash,
  );

  return row ? toCustomerApiKeyRecord(row) : null;
}

export async function recordCustomerApiKeyUsed(env: AppEnv, apiKeyId: string) {
  const timestamp = nowIso();
  await run(
    env,
    `
      UPDATE customer_api_key
      SET last_used_at = ?,
          updated_at = ?
      WHERE id = ?
        AND revoked_at IS NULL
    `,
    timestamp,
    timestamp,
    apiKeyId,
  );
}

export async function revokeCustomerApiKey(
  env: AppEnv,
  input: {
    userId: string;
    apiKeyId: string;
  },
) {
  const timestamp = nowIso();
  await run(
    env,
    `
      UPDATE customer_api_key
      SET revoked_at = ?,
          updated_at = ?
      WHERE id = ?
        AND user_id = ?
        AND revoked_at IS NULL
    `,
    timestamp,
    timestamp,
    input.apiKeyId,
    input.userId,
  );
}

export async function getCustomerMetaConnection(env: AppEnv, userId: string) {
  const row = await one<CustomerMetaConnectionRow>(
    env,
    `
      SELECT *
      FROM customer_meta_connection
      WHERE user_id = ?
      LIMIT 1
    `,
    userId,
  );

  return row ? toCustomerMetaConnectionRecord(row) : null;
}

export async function upsertCustomerMetaConnection(
  env: AppEnv,
  input: {
    userId: string;
    encryptedAccessToken: string;
    tokenLastFour: string;
    tokenFingerprint: string;
    status: CustomerMetaConnectionRecord["status"];
    summary: string;
    lastCheckedAt?: string | null;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
  },
) {
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO customer_meta_connection (
        user_id,
        encrypted_access_token,
        token_last_four,
        token_fingerprint,
        status,
        summary,
        last_checked_at,
        last_error_code,
        last_error_message,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id)
      DO UPDATE SET encrypted_access_token = excluded.encrypted_access_token,
                    token_last_four = excluded.token_last_four,
                    token_fingerprint = excluded.token_fingerprint,
                    status = excluded.status,
                    summary = excluded.summary,
                    last_checked_at = excluded.last_checked_at,
                    last_error_code = excluded.last_error_code,
                    last_error_message = excluded.last_error_message,
                    updated_at = excluded.updated_at
    `,
    input.userId,
    input.encryptedAccessToken,
    input.tokenLastFour,
    input.tokenFingerprint,
    input.status,
    input.summary,
    input.lastCheckedAt ?? timestamp,
    input.lastErrorCode ?? null,
    input.lastErrorMessage ?? null,
    timestamp,
    timestamp,
  );

  return getCustomerMetaConnection(env, input.userId);
}

export async function updateCustomerMetaConnectionStatus(
  env: AppEnv,
  input: {
    userId: string;
    status: CustomerMetaConnectionRecord["status"];
    summary: string;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
  },
) {
  const timestamp = nowIso();
  await run(
    env,
    `
      UPDATE customer_meta_connection
      SET status = ?,
          summary = ?,
          last_checked_at = ?,
          last_error_code = ?,
          last_error_message = ?,
          updated_at = ?
      WHERE user_id = ?
    `,
    input.status,
    input.summary,
    timestamp,
    input.lastErrorCode ?? null,
    input.lastErrorMessage ?? null,
    timestamp,
    input.userId,
  );

  return getCustomerMetaConnection(env, input.userId);
}

export async function deleteCustomerMetaConnection(env: AppEnv, userId: string) {
  await run(
    env,
    "DELETE FROM customer_meta_connection WHERE user_id = ?",
    userId,
  );
}

export async function logMetaIntegrationStatus(
  env: AppEnv,
  input: {
    status: MetaIntegrationStatus["status"];
    summary: string;
    errorCode?: string | null;
    errorMessage?: string | null;
    metadata?: JsonRecord;
  },
) {
  await run(
    env,
    `
      INSERT INTO meta_integration_log (
        id,
        status,
        summary,
        error_code,
        error_message,
        metadata_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    createId(),
    input.status,
    input.summary,
    input.errorCode ?? null,
    input.errorMessage ?? null,
    jsonValue(input.metadata ?? null),
    nowIso(),
  );
}

export async function getMetaIntegrationStatus(env: AppEnv) {
  const row = await one<MetaLogRow>(
    env,
    `
      SELECT status, summary, error_code, error_message, created_at
      FROM meta_integration_log
      ORDER BY created_at DESC
      LIMIT 1
    `,
  );

  return {
    status: row?.status ?? (env.META_AD_LIBRARY_TOKEN ? "degraded" : "demo"),
    provider: env.META_AD_LIBRARY_TOKEN ? "meta_api" : "demo",
    mode: env.META_AD_LIBRARY_TOKEN ? "diagnostic" : "demo",
    summary:
      row?.summary ??
      (env.META_AD_LIBRARY_TOKEN
        ? "Official Meta API is configured for limited diagnostic use."
        : "No live commercial discovery provider is configured. The app is running in explicit demo mode."),
    lastCheckedAt: row?.created_at ?? null,
    lastErrorCode: row?.error_code ?? null,
    lastErrorMessage: row?.error_message ?? null,
  } satisfies MetaIntegrationStatus;
}

export async function upsertDiscoveryCacheEntry(
  env: AppEnv,
  input: {
    cacheKey: string;
    provider: AdDiscoveryProvider;
    routeContext: DiscoveryRouteContext;
    queryFingerprint: string;
    country: string;
    cursor: string | null;
    payload: SearchResponse;
    fetchedAt: string;
    expiresAt: string;
    browserMsUsed?: number | null;
  },
) {
  const timestamp = nowIso();

  await run(
    env,
    `
      INSERT INTO discovery_cache_entry (
        cache_key,
        provider,
        route_context,
        query_fingerprint,
        country,
        cursor,
        payload_json,
        fetched_at,
        expires_at,
        browser_ms_used,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        provider = excluded.provider,
        route_context = excluded.route_context,
        query_fingerprint = excluded.query_fingerprint,
        country = excluded.country,
        cursor = excluded.cursor,
        payload_json = excluded.payload_json,
        fetched_at = excluded.fetched_at,
        expires_at = excluded.expires_at,
        browser_ms_used = excluded.browser_ms_used,
        updated_at = excluded.updated_at
    `,
    input.cacheKey,
    input.provider,
    input.routeContext,
    input.queryFingerprint,
    input.country,
    input.cursor,
    jsonValue(input.payload),
    input.fetchedAt,
    input.expiresAt,
    input.browserMsUsed ?? null,
    timestamp,
    timestamp,
  );
}

export async function getDiscoveryCacheEntry(env: AppEnv, cacheKey: string) {
  const row = await one<DiscoveryCacheEntryRow>(
    env,
    `
      SELECT
        cache_key,
        provider,
        route_context,
        query_fingerprint,
        country,
        cursor,
        payload_json,
        fetched_at,
        expires_at,
        browser_ms_used,
        created_at,
        updated_at
      FROM discovery_cache_entry
      WHERE cache_key = ?
      LIMIT 1
    `,
    cacheKey,
  );

  if (!row) {
    return null;
  }

  const payload = parseDiscoveryCachePayload(row.payload_json);
  if (!payload) {
    return null;
  }

  return {
    cacheKey: row.cache_key,
    provider: row.provider,
    routeContext: row.route_context,
    queryFingerprint: row.query_fingerprint,
    country: row.country,
    cursor: row.cursor,
    payload,
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at,
    browserMsUsed: row.browser_ms_used,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createDiscoveryFetchLog(
  env: AppEnv,
  input: {
    provider: AdDiscoveryProvider;
    routeContext: DiscoveryRouteContext;
    queryFingerprint: string;
    country: string;
    status: DiscoveryFetchStatus;
    cacheStatus: DiscoveryCacheStatus;
    failureClass: DiscoveryFailureClass | null;
    browserMsUsed?: number | null;
    metadata?: Record<string, unknown> | null;
  },
) {
  await run(
    env,
    `
      INSERT INTO discovery_fetch_log (
        id,
        provider,
        route_context,
        query_fingerprint,
        country,
        status,
        cache_status,
        failure_class,
        browser_ms_used,
        metadata_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    createId(),
    input.provider,
    input.routeContext,
    input.queryFingerprint,
    input.country,
    input.status,
    input.cacheStatus,
    input.failureClass,
    input.browserMsUsed ?? null,
    jsonValue(input.metadata ?? null),
    nowIso(),
  );
}

export async function upsertDiscoveryProviderState(
  env: AppEnv,
  input: {
    provider: AdDiscoveryProvider;
    status: MetaIntegrationStatus["status"];
    failureClass: DiscoveryFailureClass | null;
    summary: string;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    metadata?: Record<string, unknown> | null;
  },
) {
  await run(
    env,
    `
      INSERT INTO discovery_provider_state (
        provider,
        status,
        failure_class,
        summary,
        last_success_at,
        last_failure_at,
        metadata_json,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET
        status = excluded.status,
        failure_class = excluded.failure_class,
        summary = excluded.summary,
        last_success_at = excluded.last_success_at,
        last_failure_at = excluded.last_failure_at,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `,
    input.provider,
    input.status,
    input.failureClass,
    input.summary,
    input.lastSuccessAt,
    input.lastFailureAt,
    jsonValue(input.metadata ?? null),
    nowIso(),
  );
}

export async function getDiscoveryProviderState(env: AppEnv, provider: AdDiscoveryProvider) {
  const row = await one<DiscoveryProviderStateRow>(
    env,
    `
      SELECT
        provider,
        status,
        failure_class,
        summary,
        last_success_at,
        last_failure_at,
        metadata_json,
        updated_at
      FROM discovery_provider_state
      WHERE provider = ?
      LIMIT 1
    `,
    provider,
  );

  if (!row) {
    return null;
  }

  return {
    provider: row.provider,
    status: row.status,
    failureClass: row.failure_class,
    summary: row.summary,
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
    metadata: parseJson<Record<string, unknown> | null>(row.metadata_json, null),
    updatedAt: row.updated_at,
  };
}

export async function getLaunchReadinessSignals(env: AppEnv, now: Date = new Date()) {
  const since = new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString();
  const [
    proofs,
    deliveries,
    slackTargets,
    slackDeliveries,
    whatsappTargets,
    whatsappDeliveries,
    watchlistRuns,
  ] = await Promise.all([
    one<{
      recent_count: number;
      latest_at: string | null;
    }>(
      env,
      `
        SELECT
          COUNT(*) AS recent_count,
          MAX(succeeded_at) AS latest_at
        FROM proof_capture
        WHERE status = 'succeeded'
          AND succeeded_at >= ?
          AND COALESCE(json_extract(capture_metadata_json, '$.kind'), '') != 'launch_readiness_canary'
      `,
      since,
    ),
    one<{
      recent_attempts: number;
      recent_sent: number;
      latest_at: string | null;
    }>(
      env,
      `
        SELECT
          COUNT(*) AS recent_attempts,
          SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS recent_sent,
          MAX(COALESCE(sent_at, created_at)) AS latest_at
        FROM delivery_attempt
        WHERE digest_run_id IS NOT NULL
          AND created_at >= ?
      `,
      since,
    ),
    one<{
      configured_targets: number;
      usable_targets: number;
      latest_successful_delivery_at: string | null;
    }>(
      env,
      `
        SELECT
          COUNT(*) AS configured_targets,
          SUM(
            CASE
              WHEN is_opted_in = 1
                AND is_validated = 1
                AND is_paused = 0
                AND validation_status = 'validated'
                AND opted_out_at IS NULL
              THEN 1
              ELSE 0
            END
          ) AS usable_targets,
          MAX(last_successful_delivery_at) AS latest_successful_delivery_at
        FROM delivery_target
        WHERE channel = 'slack'
      `,
    ),
    one<{
      recent_attempts: number;
      recent_sent: number;
      latest_at: string | null;
    }>(
      env,
      `
        SELECT
          COUNT(*) AS recent_attempts,
          SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS recent_sent,
          MAX(COALESCE(sent_at, created_at)) AS latest_at
        FROM delivery_attempt
        WHERE channel = 'slack'
          AND created_at >= ?
      `,
      since,
    ),
    one<{
      configured_targets: number;
      usable_targets: number;
      latest_successful_delivery_at: string | null;
    }>(
      env,
      `
        SELECT
          COUNT(*) AS configured_targets,
          SUM(
            CASE
              WHEN is_opted_in = 1
                AND is_validated = 1
                AND is_paused = 0
                AND validation_status = 'validated'
                AND template_eligible = 1
                AND opted_out_at IS NULL
              THEN 1
              ELSE 0
            END
          ) AS usable_targets,
          MAX(last_successful_delivery_at) AS latest_successful_delivery_at
        FROM delivery_target
        WHERE channel = 'whatsapp'
      `,
    ),
    one<{
      recent_attempts: number;
      recent_sent: number;
      latest_at: string | null;
    }>(
      env,
      `
        SELECT
          SUM(CASE WHEN lane = 'customer' THEN 1 ELSE 0 END) AS recent_attempts,
          SUM(
            CASE
              WHEN lane = 'customer'
                AND status = 'sent'
                AND webhook_status = 'delivered'
              THEN 1
              ELSE 0
            END
          ) AS recent_sent,
          MAX(
            CASE
              WHEN lane = 'customer'
                AND status = 'sent'
                AND webhook_status = 'delivered'
              THEN COALESCE(provider_status_last_seen_at, sent_at, created_at)
              ELSE NULL
            END
          ) AS latest_at
        FROM delivery_attempt
        WHERE channel = 'whatsapp'
          AND created_at >= ?
      `,
      since,
    ),
    one<{
      recent_count: number;
      latest_at: string | null;
    }>(
      env,
      `
        SELECT
          COUNT(*) AS recent_count,
          MAX(finished_at) AS latest_at
        FROM watchlist_run
        WHERE status = 'succeeded'
          AND finished_at >= ?
      `,
      since,
    ),
  ]);

  return {
    since,
    proof: {
      recentSuccessfulCaptures: Number(proofs?.recent_count ?? 0),
      latestSucceededAt: proofs?.latest_at ?? null,
    },
    digestDelivery: {
      recentAttempts: Number(deliveries?.recent_attempts ?? 0),
      recentSent: Number(deliveries?.recent_sent ?? 0),
      latestAttemptAt: deliveries?.latest_at ?? null,
    },
    slackDelivery: {
      configuredTargets: Number(slackTargets?.configured_targets ?? 0),
      usableTargets: Number(slackTargets?.usable_targets ?? 0),
      latestTargetSuccessAt: slackTargets?.latest_successful_delivery_at ?? null,
      recentAttempts: Number(slackDeliveries?.recent_attempts ?? 0),
      recentSent: Number(slackDeliveries?.recent_sent ?? 0),
      latestAttemptAt: slackDeliveries?.latest_at ?? null,
    },
    whatsappDelivery: {
      providerConfigured: isWhatsAppProviderConfigured(env),
      customerReady: isCustomerWhatsAppReady(env),
      webhookConfigured: isWhatsAppWebhookConfigured(env),
      configuredTargets: Number(whatsappTargets?.configured_targets ?? 0),
      usableTargets: Number(whatsappTargets?.usable_targets ?? 0),
      latestTargetSuccessAt: whatsappTargets?.latest_successful_delivery_at ?? null,
      recentAttempts: Number(whatsappDeliveries?.recent_attempts ?? 0),
      recentSent: Number(whatsappDeliveries?.recent_sent ?? 0),
      latestAttemptAt: whatsappDeliveries?.latest_at ?? null,
    },
    monitoring: {
      recentSuccessfulRuns: Number(watchlistRuns?.recent_count ?? 0),
      latestSucceededAt: watchlistRuns?.latest_at ?? null,
    },
  };
}
