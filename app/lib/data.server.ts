import { buildLandingPageAnalysisFields } from "~/lib/analysis.server";
import {
  hydrateAdsWithPersistedCreatives as hydrateAdsWithPersistedCreativesImpl,
  listAdsByIds,
  replaceAnalysisFields,
  upsertAd as upsertAdImpl,
} from "~/lib/ad-persistence.server";
import {
  ensureDb,
  execute as run,
  queryAll as many,
  queryIn,
  queryOne as one,
} from "~/lib/data/d1.server";
import {
  boolToInt,
  createId,
  jsonValue,
  nowIso,
  parseJson,
  type JsonRecord,
} from "~/lib/data/helpers.server";
import {
  countLeadingFailures,
  isSoftScanFailure,
} from "~/lib/data/watchlist-runs.server";
import {
  isCustomerWhatsAppReady,
  isWhatsAppProviderConfigured,
  isWhatsAppWebhookConfigured,
  type AppEnv,
} from "~/lib/env.server";
import { buildExternalProofAd } from "~/lib/external-proof.server";
import {
  decodeListCursor,
  nextListCursorFromPage,
  resolveListPageLimit,
  type ListPageOptions,
  type ListPageResult,
} from "~/lib/list-pagination";
import { fingerprintSavedQuery, normalizeSavedQuery } from "~/lib/normalize";
import { getScheduledMonitoringPolicy } from "~/lib/plan-entitlements";
import { normalizeSupportCaseInput, SupportCaseInputError } from "~/lib/support";
import { SUPPORT_CASE_EVENT_TYPES } from "~/lib/types";
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
  DeliveryAttemptStatus,
  DeliveryChannel,
  DiscoveryCacheStatus,
  DiscoveryFailureClass,
  DiscoveryFetchStatus,
  DiscoveryRouteContext,
  DigestDeliveryRecord,
  DigestItemRecord,
  DigestRecord,
  AdDiscoveryProvider,
  MetaIntegrationStatus,
  NormalizedSavedQuery,
  ProofStatus,
  SavedQueryRecord,
  ShareLinkRecord,
  ShareResourceType,
  SupportCaseCategory,
  SupportCaseEventRecord,
  SupportCaseEventType,
  SupportCasePriority,
  SupportCaseRecord,
  SupportCaseStatus,
  WatchEventType,
  WebhookReconciliationStatus,
  SearchResponse,
} from "~/lib/types";


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

interface SupportCaseRow {
  id: string;
  user_id: string;
  request_key: string | null;
  category: SupportCaseCategory;
  priority: SupportCasePriority;
  status: SupportCaseStatus;
  subject: string;
  detail: string;
  context_json: string;
  created_at: string;
  updated_at: string;
}

interface SupportCaseEventRow {
  id: string;
  case_id: string;
  user_id: string;
  event_type: SupportCaseEventType;
  message: string;
  visible_to_customer: number;
  metadata_json: string;
  created_at: string;
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
  brand_website: string | null;
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


export { listAdsByIds, replaceAnalysisFields } from "~/lib/ad-persistence.server";
export { nowIso, createId } from "~/lib/data/helpers.server";
export {
  listWatchlistsPage,
  listWatchlists,
  listActiveWatchlistsPage,
  listActiveWatchlists,
  getWatchlist,
  createWatchlistWithinLimit,
  createWatchlist,
  updateWatchlist,
  setWatchlistActive,
  listWebMentionTargets,
  listWebMentionObservations,
  syncWebMentionTargetsForUser,
  type CreateWatchlistInput,
  type CreateWatchlistWithinLimitResult,
  deactivateWatchlistsBeyondPlanLimit,
  reactivateWatchlistsUpToPlanLimit,
  hasInFlightWatchlistRun,
  createWatchlistRun,
  finishWatchlistRun,
  getRecentSuccessfulRuns,
  buildCapacitySkipIdempotencyKey,
  recordWatchlistCapacitySkip,
  listWatchlistRuns,
  touchWatchlistScanned,
  isSoftScanFailure,
  countLeadingFailures,
  getSuccessfulRunStatsForUserBetween,
  createAdObservation,
  listObservationsForRunPage,
  listObservationsForRun,
  legacyWatchEventImportanceScore,
  listWatchEvents,
  listWatchEventsByIds,
  listEventCandidates,
  listWatchEventsBetween,
  createWatchEvent,
  createEventCandidate,
  getProofTargetByIdentity,
  upsertProofTarget,
  listProofCapturesForTarget,
  listProofCapturesForTargets,
  listSuccessfulProofCapturesForAd,
  listLastSuccessfulProofCapturesForAds,
  listRecentProofCapturesForWatchlist,
  countProofCapturesForWatchlistSince,
  countProofCapturesForWorkspaceSince,
  getSuccessfulProofCaptureStatsForUser,
  listRecentWorkspaceProofCaptures,
  createProofCapture,
  getWatchlistDeliveryConfig,
  upsertWatchlistDeliveryConfig,
  type ObservationRow,
} from "~/lib/data/watchlists.server";


export {
  grantProofUsageCredit,
  grantDodoPlanAccess,
  DODO_WEBHOOK_PROCESSING_LEASE_MS,
  applyDodoPlanGrantWithWatchlistReconcile,
  applyDodoPlanRevokeWithWatchlistReconcile,
  applyDodoRefundWithWatchlistReconcile,
  applyDodoPlanPaymentIssueWithLedger,
  applyDodoProofCreditGrantWithLedger,
  finalizeDodoWebhookLedgerOnly,
  DODO_PLAN_CHECKOUT_LOCK_MINUTES,
  DODO_SUBSCRIPTION_PLAN_CHANGE_LOCK_MINUTES,
  DODO_SUBSCRIPTION_PLAN_CHANGE_PENDING_STATUS,
  DODO_SUBSCRIPTION_PLAN_CHANGE_SCHEDULED_STATUS,
  isDodoSubscriptionPlanChangeStatus,
  isBlockingDodoSubscriptionPlanChangeStatus,
  claimDodoSubscriptionPlanChange,
  clearDodoSubscriptionPlanChangeClaim,
  markDodoSubscriptionPlanChangeScheduled,
  claimDodoPlanCheckout,
  clearDodoPlanCheckout,
  revokeDodoPlanAccess,
  beginDodoWebhookEventProcessing,
  claimDodoWebhookEvent,
  failDodoWebhookEventProcessing,
  markDodoWebhookEventFinished,
  markDodoPlanPaymentIssue,
  revokeDodoAccessForRefundedPayment,
  getUserIdForDodoPayment,
  getUserIdForDodoLifecycle,
  getUserPlanBillingInfo,
  type DodoWebhookLedgerOutcome,
  type DodoWebhookLedgerFinalize,
  type DodoWebhookProcessingClaim,
  type UserPlanBillingInfo,
} from "~/lib/data/billing.server";

export {
  legacyWorkspaceDeliveryDefaults,
  migrateAutoProvisionedEmailTargets,
  listRetryableInstantAttempts,
  getWorkspaceDeliveryConfig,
  upsertWorkspaceDeliveryConfig,
  listDeliveryTargets,
  getDeliveryTargetReadinessStats,
  upsertDeliveryTarget,
  getDeliveryTargetById,
  getDeliveryTargetByProviderIdentifier,
  getUserDeliveryProfile,
  listDeliveryAttempts,
  getDeliveryAttemptByIdempotencyKey,
  reconcileDeliveryAttemptByProviderMessageId,
  createDeliveryAttempt,
  updateDeliveryAttemptResult,
} from "~/lib/data/delivery-records.server";


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

export async function listRecentAgentActionAudits(
  env: AppEnv,
  userId: string,
  options: {
    actionName?: string | null;
    status?: AgentActionAuditStatus | null;
    resourceType?: string | null;
    limit?: number;
    offset?: number;
  } = {},
) {
  const actionName = options.actionName ?? null;
  const status = options.status ?? null;
  const resourceType = options.resourceType ?? null;
  const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 10)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));

  const rows = await many<AgentActionAuditRow>(
    env,
    `
      SELECT *
      FROM agent_action_audit
      WHERE user_id = ?
        AND (? IS NULL OR action_name = ?)
        AND (? IS NULL OR status = ?)
        AND (? IS NULL OR resource_type = ?)
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `,
    userId,
    actionName,
    actionName,
    status,
    status,
    resourceType,
    resourceType,
    limit,
    offset,
  );

  return rows.map(toAgentActionAuditRecord);
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

export async function listAgentMemoryForClientRooms(
  env: AppEnv,
  userId: string,
  roomIds: string[],
  options: {
    limitPerRoom?: number | null;
  } = {},
) {
  const uniqueRoomIds = Array.from(new Set(roomIds.filter(Boolean)));
  if (uniqueRoomIds.length === 0) {
    return [];
  }

  const limitPerRoom = Math.max(1, Math.min(100, Math.floor(options.limitPerRoom ?? 20)));
  const rows = await queryIn<AgentMemoryRow>(env, {
    buildSql: (placeholders) => `
      SELECT *
      FROM (
        SELECT
          agent_memory.*,
          ROW_NUMBER() OVER (
            PARTITION BY client_room_id
            ORDER BY updated_at DESC
          ) AS room_rank
        FROM agent_memory
        WHERE user_id = ?
          AND watchlist_id IS NULL
          AND client_room_id IN (${placeholders})
      )
      WHERE room_rank <= ?
      ORDER BY updated_at DESC
    `,
    values: uniqueRoomIds,
    prefix: [userId],
    suffix: [limitPerRoom],
    chunkSize: 80,
  });

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
    const conflictingRoom = await one<ClientRoomRow>(
      env,
      `
        SELECT *
        FROM client_room
        WHERE user_id = ?
          AND name = ?
          AND id <> ?
        LIMIT 1
      `,
      userId,
      name,
      input.roomId,
    );
    if (conflictingRoom) {
      return null;
    }

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

    const updatedRoom = await getClientRoom(env, userId, input.roomId);
    if (!updatedRoom) {
      return null;
    }

    if (hasResourceRefs) {
      await replaceClientRoomResourceRefs(env, userId, input.roomId, input.resourceRefs ?? []);
      return getClientRoom(env, userId, input.roomId);
    }

    return updatedRoom;
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

export async function createSupportCase(
  env: AppEnv,
  input: {
    userId: string;
    category: unknown;
    subject: unknown;
    detail: unknown;
    priority?: unknown;
    context?: JsonRecord | null;
    requestKey?: string | null;
    reopenClosed?: boolean;
  },
) {
  const normalized = normalizeSupportCaseInput({
    category: input.category,
    priority: input.priority ?? "normal",
    subject: input.subject,
    detail: input.detail,
  });
  const id = createId();
  const timestamp = nowIso();
  const requestKey = normalizeOptionalIdempotencyKey(input.requestKey);

  if (requestKey) {
    const existing = await one<SupportCaseRow>(
      env,
      `
        SELECT *
        FROM support_case
        WHERE user_id = ?
          AND request_key = ?
        LIMIT 1
      `,
      input.userId,
      requestKey,
    );
    if (existing) {
      if (existing.status === "closed" && input.reopenClosed) {
        const reopened = await reopenSupportCaseForRequest(env, {
          caseId: existing.id,
          userId: input.userId,
          category: normalized.category,
          priority: normalized.priority,
          subject: normalized.subject,
          detail: normalized.detail,
          context: input.context ?? {},
          timestamp,
        });
        if (reopened) {
          return {
            ...reopened,
            alreadyExists: false,
            reopened: true,
          };
        }
      }

      return {
        ...toSupportCaseRecord(existing),
        alreadyExists: true,
      };
    }
  }

  await run(
    env,
    `
      INSERT OR IGNORE INTO support_case (
        id,
        user_id,
        request_key,
        category,
        priority,
        status,
        subject,
        detail,
        context_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
    `,
    id,
    input.userId,
    requestKey,
    normalized.category,
    normalized.priority,
    normalized.subject,
    normalized.detail,
    jsonValue(input.context ?? {}),
    timestamp,
    timestamp,
  );

  if (requestKey) {
    const row = await one<SupportCaseRow>(
      env,
      `
        SELECT *
        FROM support_case
        WHERE user_id = ?
          AND request_key = ?
        LIMIT 1
      `,
      input.userId,
      requestKey,
    );

    if (!row) {
      return null;
    }

    const createdNewCase = row.id === id;
    if (createdNewCase) {
      await recordSupportCaseOpenedEvent(env, {
        caseId: row.id,
        userId: input.userId,
        category: normalized.category,
        priority: normalized.priority,
        context: input.context ?? {},
      });
    }

    return {
      ...toSupportCaseRecord(row),
      alreadyExists: !createdNewCase,
    };
  }

  const row = await one<SupportCaseRow>(
    env,
    `
      SELECT *
      FROM support_case
      WHERE id = ?
        AND user_id = ?
      LIMIT 1
    `,
    id,
    input.userId,
  );

  if (!row) {
    return null;
  }

  await recordSupportCaseOpenedEvent(env, {
    caseId: row.id,
    userId: input.userId,
    category: normalized.category,
    priority: normalized.priority,
    context: input.context ?? {},
  });

  return {
    ...toSupportCaseRecord(row),
    alreadyExists: false,
  };
}

function normalizeOptionalIdempotencyKey(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 120 ? trimmed : null;
}

export async function listSupportCases(
  env: AppEnv,
  userId: string,
  options: {
    status?: SupportCaseStatus | "all" | null;
    limit?: number | null;
  } = {},
) {
  const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 20)));
  const status = options.status ?? "all";
  const rows = status === "all"
    ? await many<SupportCaseRow>(
      env,
      `
        SELECT *
        FROM support_case
        WHERE user_id = ?
        ORDER BY updated_at DESC
        LIMIT ?
      `,
      userId,
      limit,
    )
    : await many<SupportCaseRow>(
      env,
      `
        SELECT *
        FROM support_case
        WHERE user_id = ?
          AND status = ?
        ORDER BY updated_at DESC
        LIMIT ?
      `,
      userId,
      status,
      limit,
    );

  return rows.map(toSupportCaseRecord);
}

export async function getSupportCase(env: AppEnv, userId: string, caseId: string) {
  const row = await one<SupportCaseRow>(
    env,
    `
      SELECT *
      FROM support_case
      WHERE id = ?
        AND user_id = ?
      LIMIT 1
    `,
    caseId,
    userId,
  );

  return row ? toSupportCaseRecord(row) : null;
}

export async function createSupportCaseEvent(
  env: AppEnv,
  input: {
    caseId: string;
    userId: string;
    eventType: unknown;
    message: unknown;
    visibleToCustomer?: boolean;
    metadata?: JsonRecord | null;
  },
) {
  const eventType = readSupportCaseEventType(input.eventType);
  if (!eventType) {
    throw new SupportCaseInputError("invalid_support_case_event", "Choose a valid support case event.");
  }

  const message = normalizeSupportCaseEventMessage(input.message);
  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO support_case_event (
        id,
        case_id,
        user_id,
        event_type,
        message,
        visible_to_customer,
        metadata_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    id,
    input.caseId,
    input.userId,
    eventType,
    message,
    input.visibleToCustomer === false ? 0 : 1,
    jsonValue(input.metadata ?? {}),
    timestamp,
  );

  const row = await one<SupportCaseEventRow>(
    env,
    `
      SELECT *
      FROM support_case_event
      WHERE id = ?
      LIMIT 1
    `,
    id,
  );

  return row ? toSupportCaseEventRecord(row) : null;
}

export async function listSupportCaseEvents(
  env: AppEnv,
  userId: string,
  caseId: string,
  options: {
    limit?: number | null;
  } = {},
) {
  const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 30)));
  const rows = await many<SupportCaseEventRow>(
    env,
    `
      SELECT *
      FROM (
        SELECT *
        FROM support_case_event
        WHERE case_id = ?
          AND user_id = ?
          AND visible_to_customer = 1
        ORDER BY created_at DESC
        LIMIT ?
      )
      ORDER BY created_at ASC
    `,
    caseId,
    userId,
    limit,
  );

  return rows.map(toSupportCaseEventRecord);
}

function readSupportCaseEventType(value: unknown): SupportCaseEventType | null {
  return SUPPORT_CASE_EVENT_TYPES.includes(value as SupportCaseEventType)
    ? (value as SupportCaseEventType)
    : null;
}

function normalizeSupportCaseEventMessage(value: unknown) {
  if (typeof value !== "string") {
    throw new SupportCaseInputError("invalid_support_case_event_message", "Add a support case event message.");
  }

  const message = value.trim();
  if (!message || message.length > 1000) {
    throw new SupportCaseInputError(
      "invalid_support_case_event_message",
      "Keep support case event messages between 1 and 1,000 characters.",
    );
  }

  return message;
}

async function recordSupportCaseOpenedEvent(
  env: AppEnv,
  input: {
    caseId: string;
    userId: string;
    category: SupportCaseCategory;
    priority: SupportCasePriority;
    context: JsonRecord;
  },
) {
  try {
    await createSupportCaseEvent(env, {
      caseId: input.caseId,
      userId: input.userId,
      eventType: "case_opened",
      message: supportCaseOpenedEventMessage(input.context),
      visibleToCustomer: true,
      metadata: {
        category: input.category,
        priority: input.priority,
        ...supportCaseOpenedEventMetadata(input.context),
      },
    });
  } catch (error) {
    console.error("[support] opened case event persistence failed", error);
  }
}

async function reopenSupportCaseForRequest(
  env: AppEnv,
  input: {
    caseId: string;
    userId: string;
    category: SupportCaseCategory;
    priority: SupportCasePriority;
    subject: string;
    detail: string;
    context: JsonRecord;
    timestamp: string;
  },
) {
  await run(
    env,
    `
      UPDATE support_case
      SET category = ?,
          priority = ?,
          status = 'open',
          subject = ?,
          detail = ?,
          context_json = ?,
          updated_at = ?
      WHERE id = ?
        AND user_id = ?
        AND status = 'closed'
    `,
    input.category,
    input.priority,
    input.subject,
    input.detail,
    jsonValue(input.context),
    input.timestamp,
    input.caseId,
    input.userId,
  );

  const row = await one<SupportCaseRow>(
    env,
    `
      SELECT *
      FROM support_case
      WHERE id = ?
        AND user_id = ?
      LIMIT 1
    `,
    input.caseId,
    input.userId,
  );
  if (!row) {
    return null;
  }

  await recordSupportCaseReopenedEvent(env, {
    caseId: row.id,
    userId: input.userId,
    category: input.category,
    priority: input.priority,
    context: input.context,
  });

  return toSupportCaseRecord(row);
}

async function recordSupportCaseReopenedEvent(
  env: AppEnv,
  input: {
    caseId: string;
    userId: string;
    category: SupportCaseCategory;
    priority: SupportCasePriority;
    context: JsonRecord;
  },
) {
  try {
    await createSupportCaseEvent(env, {
      caseId: input.caseId,
      userId: input.userId,
      eventType: "status_changed",
      message: "Support case reopened from a new signed-in request.",
      visibleToCustomer: true,
      metadata: {
        category: input.category,
        priority: input.priority,
        fromStatus: "closed",
        toStatus: "open",
        ...supportCaseOpenedEventMetadata(input.context),
      },
    });
  } catch (error) {
    console.error("[support] reopened case event persistence failed", error);
  }
}

function supportCaseOpenedEventMessage(context: JsonRecord) {
  const createdFrom = typeof context.createdFrom === "string" ? context.createdFrom : null;
  if (createdFrom === "signed_in_support") {
    return "Support case opened from the signed-in support form.";
  }
  if (createdFrom === "agent_action") {
    return "Support case opened by an account agent action.";
  }

  return "Support case opened.";
}

function supportCaseOpenedEventMetadata(context: JsonRecord): JsonRecord {
  const metadata: JsonRecord = {};
  if (typeof context.createdFrom === "string") {
    metadata.createdFrom = context.createdFrom;
  }
  if (typeof context.source === "string") {
    metadata.source = context.source;
  }
  return metadata;
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

function isMissingTableError(error: unknown, tableName: string) {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("no such table") && message.includes(tableName);
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


export async function getOldestUserId(env: AppEnv) {
  const row = await one<{ id: string }>(
    env,
    "SELECT id FROM user ORDER BY createdAt ASC LIMIT 1",
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


const COLLECTION_LIST_COLUMNS = `
  id,
  user_id,
  name,
  description,
  created_at,
  updated_at
`;

const COLLECTION_ITEM_LIST_COLUMNS = `
  id,
  collection_id,
  ad_id,
  note,
  ad_snapshot_json,
  created_at,
  updated_at
`;

const USER_LIST_PAGE_SIZE = 500;

export async function listCollectionsPage(
  env: AppEnv,
  userId: string,
  options: ListPageOptions = {},
): Promise<ListPageResult<CollectionRecord>> {
  const limit = resolveListPageLimit(options.limit, USER_LIST_PAGE_SIZE);
  const cursor = decodeListCursor(options.cursor);
  const rows = await many<CollectionRow>(
    env,
    `
      SELECT ${COLLECTION_LIST_COLUMNS}
      FROM collection
      WHERE user_id = ?
        ${cursor ? "AND (updated_at < ? OR (updated_at = ? AND id < ?))" : ""}
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `,
    ...(cursor
      ? [userId, cursor.sortValue, cursor.sortValue, cursor.id, limit]
      : [userId, limit]),
  );
  const items = rows.map(toCollectionRecord);
  return {
    items,
    nextCursor: nextListCursorFromPage(
      items,
      limit,
      (item) => item.updatedAt,
      (item) => item.id,
    ),
  };
}

export async function listCollections(
  env: AppEnv,
  userId: string,
  options: ListPageOptions = {},
) {
  const page = await listCollectionsPage(env, userId, options);
  return page.items;
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

export async function listCollectionItemsPage(
  env: AppEnv,
  collectionId: string,
  options: ListPageOptions = {},
): Promise<ListPageResult<CollectionItemRecord>> {
  const limit = resolveListPageLimit(options.limit, USER_LIST_PAGE_SIZE);
  const cursor = decodeListCursor(options.cursor);
  const rows = await many<CollectionItemRow>(
    env,
    `
      SELECT ${COLLECTION_ITEM_LIST_COLUMNS}
      FROM collection_item
      WHERE collection_id = ?
        ${cursor ? "AND (created_at < ? OR (created_at = ? AND id < ?))" : ""}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `,
    ...(cursor
      ? [collectionId, cursor.sortValue, cursor.sortValue, cursor.id, limit]
      : [collectionId, limit]),
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

  const items = rows.map<CollectionItemRecord>((row: CollectionItemRow) => ({
    id: row.id,
    collectionId: row.collection_id,
    adId: row.ad_id,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ad: parseJson<AdRecord>(row.ad_snapshot_json, {} as AdRecord),
    tags: tagsByItemId.get(row.id) ?? [],
  }));

  return {
    items,
    nextCursor: nextListCursorFromPage(
      items,
      limit,
      (item) => item.createdAt,
      (item) => item.id,
    ),
  };
}

export async function listCollectionItems(
  env: AppEnv,
  collectionId: string,
  options: ListPageOptions = {},
) {
  const page = await listCollectionItemsPage(env, collectionId, options);
  return page.items;
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


export async function closeCounterMoveFollowUp(
  env: AppEnv,
  input: {
    auditId: string;
    userId: string;
    eventId: string;
  },
) {
  const audit = await one<AgentActionAuditRow>(
    env,
    `
      SELECT *
      FROM agent_action_audit
      WHERE id = ?
        AND user_id = ?
        AND action_name = 'counter_move_brief.create'
        AND status = 'succeeded'
    `,
    input.auditId,
    input.userId,
  );
  if (!audit) {
    return { ok: false as const, reason: "not_found" as const };
  }

  const result = parseJson<Record<string, unknown>>(audit.result_json, {});
  const brief =
    result.brief && typeof result.brief === "object" && !Array.isArray(result.brief)
      ? (result.brief as Record<string, unknown>)
      : {};
  const workflow =
    brief.workflow && typeof brief.workflow === "object" && !Array.isArray(brief.workflow)
      ? (brief.workflow as Record<string, unknown>)
      : {};
  const followUps = Array.isArray(workflow.followUps) ? workflow.followUps : [];
  let matched = false;
  const nextFollowUps = followUps.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return entry;
    }
    const followUp = entry as Record<string, unknown>;
    if (followUp.eventId !== input.eventId || followUp.status === "closed") {
      return followUp;
    }
    matched = true;
    return {
      ...followUp,
      status: "closed",
    };
  });

  if (!matched) {
    return { ok: false as const, reason: "follow_up_not_found" as const };
  }

  const openCount = nextFollowUps.filter(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      (entry as Record<string, unknown>).status !== "closed",
  ).length;

  const nextWorkflow = {
    ...workflow,
    followUps: nextFollowUps,
    openCount,
    status: openCount > 0 ? workflow.status ?? "needs_review" : "quiet",
  };
  const nextBrief = {
    ...brief,
    workflow: nextWorkflow,
  };
  const nextResult = {
    ...result,
    brief: nextBrief,
  };

  const updated = await finishAgentActionAudit(env, audit.id, {
    status: "succeeded",
    result: nextResult,
  });

  return updated ? { ok: true as const, audit: updated } : { ok: false as const, reason: "update_failed" as const };
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

// Targeted "customer-at-risk" signals for the daily operator alert —
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

function resolvePaidScanStaleCutoffIso(
  plan: "scout" | "starter" | "agency",
  nowMs: number,
) {
  const cadence = getScheduledMonitoringPolicy(plan).scheduledScanCadence;
  const staleAfterHours =
    cadence === "every_3h" ? 7 : cadence === "every_6h" ? 13 : 36;
  return new Date(nowMs - staleAfterHours * 60 * 60 * 1000).toISOString();
}

// Monday operator email: the handful of numbers that say whether the
// business moved last week. Read-only aggregates, cheap enough for cron.
export async function getWeeklyBusinessSummary(env: AppEnv): Promise<WeeklyBusinessSummary> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [signupRow, activatedRow, payingRows, dunningRow, revokedRow, digestRows, staleRow] =
    await Promise.all([
      one<{ count: number }>(env, `SELECT COUNT(*) AS count FROM user WHERE createdAt >= ?`, weekAgo),
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
            AND dodo_status IN ('payment.failed', 'subscription.failed', 'subscription.on_hold')
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
            AND user_plan.plan != 'free'
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
  // can't see them — staleness can: an active paid watchlist that has missed
  // multiple regular scan windows means capacity is overflowing or the cron is
  // broken. This is the cadence-aware capacity canary.
  const nowMs = Date.now();
  const scoutStaleCutoff = resolvePaidScanStaleCutoffIso("scout", nowMs);
  const starterStaleCutoff = resolvePaidScanStaleCutoffIso("starter", nowMs);
  const agencyStaleCutoff = resolvePaidScanStaleCutoffIso("agency", nowMs);
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
        AND (
          (user_plan.plan = 'scout'
            AND watchlist.created_at < ?
            AND (watchlist.last_scanned_at IS NULL OR watchlist.last_scanned_at < ?))
          OR (user_plan.plan = 'starter'
            AND watchlist.created_at < ?
            AND (watchlist.last_scanned_at IS NULL OR watchlist.last_scanned_at < ?))
          OR (user_plan.plan = 'agency'
            AND watchlist.created_at < ?
            AND (watchlist.last_scanned_at IS NULL OR watchlist.last_scanned_at < ?))
        )
      ORDER BY watchlist.last_scanned_at ASC
      LIMIT 10
    `,
    scoutStaleCutoff,
    scoutStaleCutoff,
    starterStaleCutoff,
    starterStaleCutoff,
    agencyStaleCutoff,
    agencyStaleCutoff,
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


export async function getOperatorSnapshot(env: AppEnv) {
  const stuckThresholdIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const recentWindowIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    failingRuns,
    stuckRuns,
    failedProofs,
    budgetBlockedProofs,
    blockedTargets,
    deliveryAttention,
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
      status: DeliveryAttemptStatus;
      webhook_status: WebhookReconciliationStatus;
      provider_status_last_seen_at: string | null;
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
          delivery_attempt.status,
          delivery_attempt.webhook_status,
          delivery_attempt.provider_status_last_seen_at,
          delivery_attempt.error_message,
          delivery_attempt.created_at
        FROM delivery_attempt
        LEFT JOIN watchlist ON watchlist.id = delivery_attempt.watchlist_id
        WHERE (
            delivery_attempt.status = 'failed' OR
            (
              delivery_attempt.status = 'pending' AND
              delivery_attempt.webhook_status = 'provider_unknown'
            )
          )
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
      deliveryFailures: deliveryAttention.filter((attempt) => attempt.status === "failed").length,
      deliveryAttention: deliveryAttention.length,
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
    deliveryFailures: deliveryAttention.filter(
      (attempt) => attempt.status === "failed",
    ),
    deliveryAttention,
    degradedWatchlists,
    discoveryFailures,
    discoveryProviders,
  };
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
        AND (
          digest_delivery.status = 'failed'
          OR digest_delivery.id IS NULL
        )
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
export const WORKSPACE_BRAND_WEBSITE_MAX_LENGTH = 2048;

function normalizeWorkspaceBrandName(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().slice(0, WORKSPACE_BRAND_NAME_MAX_LENGTH).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeWorkspaceBrandWebsite(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().slice(0, WORKSPACE_BRAND_WEBSITE_MAX_LENGTH).trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function getWorkspaceBranding(env: AppEnv, userId: string) {
  const row = await one<WorkspaceBrandingRow>(
    env,
    `
      SELECT user_id, brand_name, brand_website, updated_at
      FROM workspace_branding
      WHERE user_id = ?
    `,
    userId,
  );

  return { brandName: row?.brand_name ?? null, brandWebsite: row?.brand_website ?? null };
}

export async function upsertWorkspaceBranding(
  env: AppEnv,
  userId: string,
  input: { brandName?: string | null | undefined; brandWebsite?: string | null | undefined },
) {
  const current = await getWorkspaceBranding(env, userId);
  const hasBrandName = Object.prototype.hasOwnProperty.call(input, "brandName");
  const hasBrandWebsite = Object.prototype.hasOwnProperty.call(input, "brandWebsite");
  const brandName = hasBrandName ? normalizeWorkspaceBrandName(input.brandName) : current.brandName;
  const brandWebsite = hasBrandWebsite ? normalizeWorkspaceBrandWebsite(input.brandWebsite) : current.brandWebsite;

  await run(
    env,
    `
      INSERT INTO workspace_branding (user_id, brand_name, brand_website, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        brand_name = excluded.brand_name,
        brand_website = excluded.brand_website,
        updated_at = excluded.updated_at
    `,
    userId,
    brandName,
    brandWebsite,
    nowIso(),
  );

  return { brandName, brandWebsite };
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

function toSupportCaseRecord(row: SupportCaseRow): SupportCaseRecord {
  return {
    id: row.id,
    userId: row.user_id,
    requestKey: row.request_key ?? null,
    category: row.category,
    priority: row.priority,
    status: row.status,
    subject: row.subject,
    detail: row.detail,
    context: parseJson<Record<string, unknown>>(row.context_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSupportCaseEventRecord(row: SupportCaseEventRow): SupportCaseEventRecord {
  return {
    id: row.id,
    caseId: row.case_id,
    userId: row.user_id,
    eventType: row.event_type,
    message: row.message,
    visibleToCustomer: row.visible_to_customer === 1,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    createdAt: row.created_at,
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

  try {
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
  } catch (error) {
    if (isMissingTableError(error, "discovery_cache_entry")) {
      return;
    }
    throw error;
  }
}

export async function getDiscoveryCacheEntry(env: AppEnv, cacheKey: string) {
  let row: DiscoveryCacheEntryRow | null;
  try {
    row = await one<DiscoveryCacheEntryRow>(
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
  } catch (error) {
    if (isMissingTableError(error, "discovery_cache_entry")) {
      return null;
    }
    throw error;
  }

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
  try {
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
  } catch (error) {
    if (isMissingTableError(error, "discovery_fetch_log")) {
      return;
    }
    throw error;
  }
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
  try {
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
  } catch (error) {
    if (isMissingTableError(error, "discovery_provider_state")) {
      return;
    }
    throw error;
  }
}

export async function getDiscoveryProviderState(env: AppEnv, provider: AdDiscoveryProvider) {
  let row: DiscoveryProviderStateRow | null;
  try {
    row = await one<DiscoveryProviderStateRow>(
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
  } catch (error) {
    if (isMissingTableError(error, "discovery_provider_state")) {
      return null;
    }
    throw error;
  }

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
    emailDeliveries,
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
          MAX(COALESCE(provider_status_last_seen_at, sent_at, updated_at, created_at)) AS latest_at
        FROM delivery_attempt
        WHERE digest_run_id IS NOT NULL
          AND lane = 'customer'
          AND channel = 'email'
          AND provider = 'cloudflare_email'
          AND COALESCE(provider_status_last_seen_at, sent_at, updated_at, created_at) >= ?
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
        WHERE channel = 'email'
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
    emailDelivery: {
      recentAttempts: Number(emailDeliveries?.recent_attempts ?? 0),
      recentSent: Number(emailDeliveries?.recent_sent ?? 0),
      latestAttemptAt: emailDeliveries?.latest_at ?? null,
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
