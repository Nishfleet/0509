import {
  listAdsByIds,
  replaceAnalysisFields,
  hydrateAdsWithPersistedCreatives,
  upsertAd,
  createLandingPageSnapshot,
  upsertDiscoveryCacheEntry,
  getDiscoveryCacheEntry,
  createDiscoveryFetchLog,
  upsertDiscoveryProviderState,
  getDiscoveryProviderState,
} from "~/lib/data/ads.server";
import {
  listCollectionsPage,
  listCollections,
  getCollection,
  createCollection,
  listCollectionItemsPage,
  listCollectionItems,
  updateCollectionItem,
  addAdToCollection,
  addExternalProofToCollection,
  deleteCollection,
  deleteCollectionItem,
} from "~/lib/data/collections.server";
import {
  findAgentActionAuditByIdempotencyKey,
  listRecentAgentActionAudits,
  createAgentActionAudit,
  claimAgentActionAudit,
  finishAgentActionAudit,
  closeCounterMoveFollowUp,
  upsertAgentMemory,
  listAgentMemory,
  listAgentMemoryForClientRooms,
  getClientRoom,
  upsertClientRoom,
  listClientRooms,
  listCustomerApiKeys,
  insertCustomerApiKey,
  getActiveCustomerApiKeyByHash,
  recordCustomerApiKeyUsed,
  revokeCustomerApiKey,
  getCustomerMetaConnection,
  upsertCustomerMetaConnection,
  updateCustomerMetaConnectionStatus,
  deleteCustomerMetaConnection,
} from "~/lib/data/customer-api.server";
import {
  ensureDb,
  execute as run,
  queryAll as many,
  queryOne as one,
} from "~/lib/data/d1.server";
import {
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
import { fingerprintSavedQuery, normalizeSavedQuery } from "~/lib/normalize";
import { getScheduledMonitoringPolicy } from "~/lib/plan-entitlements";
import { normalizeSupportCaseInput, SupportCaseInputError } from "~/lib/support";
import { SUPPORT_CASE_EVENT_TYPES } from "~/lib/types";
import type {
  AdDiscoveryProvider,
  AppSession,
  DeliveryAttemptStatus,
  DeliveryChannel,
  DiscoveryCacheStatus,
  DiscoveryFailureClass,
  DiscoveryRouteContext,
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
  WebhookReconciliationStatus,
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

export { nowIso, createId } from "~/lib/data/helpers.server";
export {
  listAdsByIds,
  replaceAnalysisFields,
  hydrateAdsWithPersistedCreatives,
  upsertAd,
  createLandingPageSnapshot,
  upsertDiscoveryCacheEntry,
  getDiscoveryCacheEntry,
  createDiscoveryFetchLog,
  upsertDiscoveryProviderState,
  getDiscoveryProviderState,
};
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

export {
  createDigestRun,
  clearDigestItems,
  addDigestItem,
  upsertDigestDelivery,
  listDigests,
  getDigest,
  getDigestByPeriod,
  listRetryableDigestRuns,
} from "~/lib/data/digests.server";

export {
  listCollectionsPage,
  listCollections,
  getCollection,
  createCollection,
  listCollectionItemsPage,
  listCollectionItems,
  updateCollectionItem,
  addAdToCollection,
  addExternalProofToCollection,
  deleteCollection,
  deleteCollectionItem,
};

export {
  findAgentActionAuditByIdempotencyKey,
  listRecentAgentActionAudits,
  createAgentActionAudit,
  claimAgentActionAudit,
  finishAgentActionAudit,
  closeCounterMoveFollowUp,
  upsertAgentMemory,
  listAgentMemory,
  listAgentMemoryForClientRooms,
  getClientRoom,
  upsertClientRoom,
  listClientRooms,
  listCustomerApiKeys,
  insertCustomerApiKey,
  getActiveCustomerApiKeyByHash,
  recordCustomerApiKeyUsed,
  revokeCustomerApiKey,
  getCustomerMetaConnection,
  upsertCustomerMetaConnection,
  updateCustomerMetaConnectionStatus,
  deleteCustomerMetaConnection,
};

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
