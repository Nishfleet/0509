import type { AppEnv } from "~/lib/env.server";
import {
  canUsePresenceFeature,
  getPresenceLimits,
  presenceModeAllowed,
} from "~/lib/presence-entitlements";
import {
  pollPresenceTarget,
  validatePresenceTarget,
} from "~/lib/presence-connector-registry.server";
import { evaluatePresenceWorkspaceAccess } from "~/lib/presence-internal-access.server";
import {
  countSourceTargetsForEntity,
  countTrackedEntities,
  createTrackedEntity,
  getPollCursor,
  getSourceConnectionForEntity,
  listPollCursorsForTargets,
  getTrackedEntity,
  listPresenceItems,
  listSourceTargetsForEntity,
  listTrackedEntities,
  reconcilePresenceItemsAfterPoll,
  softDeleteTrackedEntity,
  updateSourceTargetCoverageLabel,
  upsertPollCursor,
  upsertPresenceItems,
  upsertSourceTarget,
} from "~/lib/presence-data.server";
import { presenceUrlHash } from "~/lib/presence-hash";
import {
  connectorHasCustomerPollPath,
  connectorOperationalForPolling,
} from "~/lib/presence-access-gates.server";
import { getUserPlan } from "~/lib/plan.server";
import type {
  PresenceConnectorId,
  PresenceTrackingMode,
  SourceTargetRecord,
} from "~/lib/presence-types";

export class PresenceServiceError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function requirePresenceWorkspaceAccess(env: AppEnv, workspaceUserId: string) {
  const access = await evaluatePresenceWorkspaceAccess(env, workspaceUserId);
  if (!access.allowed) {
    throw new PresenceServiceError(
      access.reasonCode ?? "presence_gated",
      access.reasonMessage ?? "Presence tracking is not available.",
      403,
    );
  }
  return access;
}

export async function requirePresencePlanAccess(
  env: AppEnv,
  userId: string,
  mode: PresenceTrackingMode,
) {
  const plan = await getUserPlan(env, userId);
  if (!canUsePresenceFeature(plan, "presence_competitor_tracking") && !canUsePresenceFeature(plan, "presence_self_tracking")) {
    throw new PresenceServiceError("plan_gated", "Presence tracking is not included in your current plan.", 403);
  }
  if (!presenceModeAllowed(plan, mode)) {
    throw new PresenceServiceError(
      "mode_gated",
      mode === "self"
        ? "Self presence tracking requires Starter or Agency."
        : "Competitor presence tracking is not available on your plan.",
      403,
    );
  }
  return { plan, limits: getPresenceLimits(plan) };
}

function requireConnectorCustomerPollPath(connectorId: PresenceConnectorId) {
  if (connectorHasCustomerPollPath(connectorId)) {
    return;
  }

  throw new PresenceServiceError(
    "poll_not_implemented",
    `${connectorId} presence polling is not active for customer-facing coverage yet.`,
    403,
  );
}

export async function createPresenceEntity(
  env: AppEnv,
  userId: string,
  input: {
    trackingMode: PresenceTrackingMode;
    label: string;
    canonicalUrl?: string | null;
    notes?: string | null;
  },
) {
  await requirePresenceWorkspaceAccess(env, userId);
  const { limits } = await requirePresencePlanAccess(env, userId, input.trackingMode);
  const total = await countTrackedEntities(env, userId);
  if (total >= limits.maxTrackedEntities) {
    throw new PresenceServiceError("entity_limit", "You've reached your tracked entity limit.");
  }
  const modeCount = await countTrackedEntities(env, userId, { trackingMode: input.trackingMode });
  const modeLimit =
    input.trackingMode === "self" ? limits.maxSelfEntities : limits.maxCompetitorEntities;
  if (modeCount >= modeLimit) {
    throw new PresenceServiceError("mode_limit", `You've reached your ${input.trackingMode} entity limit.`);
  }

  return createTrackedEntity(env, {
    userId,
    trackingMode: input.trackingMode,
    label: input.label,
    canonicalUrl: input.canonicalUrl ?? null,
    notes: input.notes ?? null,
  });
}

export async function addPresenceSourceTarget(
  env: AppEnv,
  userId: string,
  entityId: string,
  connectorId: PresenceConnectorId,
  input: {
    targetUrl?: string | null;
    targetHandle?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await requirePresenceWorkspaceAccess(env, userId);
  const entity = await getTrackedEntity(env, userId, entityId);
  if (!entity) {
    throw new PresenceServiceError("not_found", "Tracked entity not found.", 404);
  }
  const { limits, plan } = await requirePresencePlanAccess(env, userId, entity.trackingMode);

  if (connectorId === "website" && !canUsePresenceFeature(plan, "presence_website_sources")) {
    throw new PresenceServiceError("feature_gated", "Website presence sources are not on your plan.", 403);
  }
  if (connectorId !== "website" && !canUsePresenceFeature(plan, "presence_social_connect")) {
    throw new PresenceServiceError("feature_gated", "Social presence connections require Starter or Agency.", 403);
  }
  requireConnectorCustomerPollPath(connectorId);

  const perEntityLimit =
    connectorId === "website" ? limits.maxWebsiteSourcesPerEntity : limits.maxSocialSourcesPerEntity;
  const current = await countSourceTargetsForEntity(env, entityId, connectorId);
  if (current >= perEntityLimit) {
    throw new PresenceServiceError("source_limit", `You've reached the ${connectorId} source limit for this entity.`);
  }

  const connection =
    connectorId !== "website"
      ? await getSourceConnectionForEntity(env, userId, entityId, connectorId)
      : null;

  const validated = await validatePresenceTarget(env, connectorId, {
    trackingMode: entity.trackingMode,
    targetUrl: input.targetUrl,
    targetHandle: input.targetHandle,
    metadata: input.metadata,
  }, {
    userId,
    trackingMode: entity.trackingMode,
    connection,
  });

  if (!validated.ok || !validated.targetKey) {
    throw new PresenceServiceError(
      validated.errorCode ?? "invalid_target",
      validated.errorMessage ?? "Could not validate presence source.",
    );
  }

  const target = await upsertSourceTarget(env, {
    userId,
    trackedEntityId: entityId,
    connectorId,
    targetKey: validated.targetKey,
    targetUrl: validated.targetUrl ?? input.targetUrl ?? null,
    targetHandle: validated.targetHandle ?? input.targetHandle ?? null,
    metadata: { ...(validated.metadata ?? {}), ...(input.metadata ?? {}) },
    coverageLabel: validated.coverageLabel,
  });

  return { entity, target, validated };
}

export async function pollPresenceSourceTarget(
  env: AppEnv,
  userId: string,
  targetId: string,
  options: { fetchImpl?: typeof fetch; budgetUnits?: number } = {},
) {
  await requirePresenceWorkspaceAccess(env, userId);
  const { getSourceTarget } = await import("~/lib/presence-data.server");
  const target = await getSourceTarget(env, userId, targetId);
  if (!target) {
    throw new PresenceServiceError("not_found", "Source target not found.", 404);
  }
  if (!target.isActive) {
    throw new PresenceServiceError("source_inactive", "Source target is not active.", 404);
  }
  const entity = await getTrackedEntity(env, userId, target.trackedEntityId);
  if (!entity) {
    throw new PresenceServiceError("not_found", "Tracked entity not found.", 404);
  }
  const { plan } = await requirePresencePlanAccess(env, userId, entity.trackingMode);
  if (target.connectorId === "website" && !canUsePresenceFeature(plan, "presence_website_sources")) {
    throw new PresenceServiceError("feature_gated", "Website presence sources are not on your plan.", 403);
  }
  if (target.connectorId !== "website" && !canUsePresenceFeature(plan, "presence_social_connect")) {
    throw new PresenceServiceError("feature_gated", "Social presence connections require Starter or Agency.", 403);
  }
  requireConnectorCustomerPollPath(target.connectorId);

  const cursor = await getPollCursor(env, target.id);
  const connection = target.connectorId !== "website"
    ? await getSourceConnectionForEntity(env, userId, entity.id, target.connectorId)
    : null;

  const pollResult = await pollPresenceTarget(env, target, entity, {
    connection,
    cursor: cursor
      ? { etag: cursor.etag, lastModified: cursor.lastModified }
      : undefined,
    fetchImpl: options.fetchImpl,
  });

  const now = new Date().toISOString();
  const priorCursor = cursor?.cursor ?? {};

  let upsertStats = { inserted: 0, updated: 0, changedUrlHashes: [] as string[] };
  let reconcileStats = { tombstoned: 0, tombstonedUrlHashes: [] as string[] };
  let resultTarget: SourceTargetRecord = target;
  if (pollResult.ok) {
    if (pollResult.items.length > 0) {
      upsertStats = await upsertPresenceItems(env, { sourceTarget: target, items: pollResult.items });
    }
    if (
      pollResult.coverageLabel &&
      pollResult.coverageLabel !== target.coverageLabel
    ) {
      resultTarget =
        (await updateSourceTargetCoverageLabel(env, userId, target.id, pollResult.coverageLabel)) ?? {
          ...target,
          coverageLabel: pollResult.coverageLabel,
        };
    }

    const completeSnapshot = Boolean(pollResult.cursor?.completeSnapshot);
    if (completeSnapshot) {
      const observedUrlHashes = await Promise.all(
        pollResult.items.map((item) => presenceUrlHash(item.canonicalUrl)),
      );
      reconcileStats = await reconcilePresenceItemsAfterPoll(env, {
        sourceTarget: target,
        observedUrlHashes,
        completeSnapshot,
      });
    }
  }

  const syncCycleCount = Number(priorCursor.syncCycleCount ?? 0) + (pollResult.ok ? 1 : 0);
  const changedCount = upsertStats.inserted + upsertStats.updated + reconcileStats.tombstoned;
  const lastChangedUrlHashes =
    pollResult.ok && changedCount > 0
      ? Array.from(new Set([...upsertStats.changedUrlHashes, ...reconcileStats.tombstonedUrlHashes]))
      : [];
  const lastChangedAt =
    pollResult.ok && changedCount > 0
      ? now
      : typeof priorCursor.lastChangedAt === "string"
        ? priorCursor.lastChangedAt
        : null;
  await upsertPollCursor(env, target.id, {
    cursor: {
      ...(pollResult.cursor ?? priorCursor),
      syncCycleCount,
      lastChangedAt,
      lastChangeCount: pollResult.ok ? changedCount : Number(priorCursor.lastChangeCount ?? 0),
      lastChangedUrlHashes,
    },
    etag: pollResult.etag ?? cursor?.etag ?? null,
    lastModified: pollResult.lastModified ?? cursor?.lastModified ?? null,
    lastPolledAt: now,
    lastSuccessAt: pollResult.ok ? now : cursor?.lastSuccessAt ?? null,
    lastErrorCode: pollResult.ok ? null : pollResult.errorCode ?? "poll_failed",
    lastErrorMessage: pollResult.ok ? null : pollResult.errorMessage ?? null,
  });

  return { pollResult, upsertStats, reconcileStats, target: resultTarget, entity };
}

const PRESENCE_POLL_BUDGET_UNITS = 40;
const POLLING_SKIP_CURSOR_ERROR_CODES = new Set(["feature_gated", "mode_gated", "plan_gated"]);

export async function runPresencePollingBatch(env: AppEnv, options: { limit?: number } = {}) {
  const { listActiveSourceTargetsForPolling } = await import("~/lib/presence-data.server");
  const { getTrackedEntity } = await import("~/lib/presence-data.server");
  const targets = await listActiveSourceTargetsForPolling(env, options.limit ?? 20);
  let spentUnits = 0;
  let skippedRollout = 0;
  const results: Array<{ targetId: string; ok: boolean; errorCode?: string; syncCycleCount?: number }> = [];

  for (const target of targets) {
    if (spentUnits >= PRESENCE_POLL_BUDGET_UNITS) break;
    const entity = await getTrackedEntity(env, target.userId, target.trackedEntityId);
    if (!entity) continue;
    if (!(await connectorOperationalForPolling(env, target.connectorId, entity.trackingMode, target.userId))) {
      await upsertPollCursor(env, target.id, {
        lastPolledAt: new Date().toISOString(),
        lastErrorCode: "connector_not_operational",
        lastErrorMessage: `${target.connectorId} is not operational for polling.`,
      });
      skippedRollout += 1;
      continue;
    }
    try {
      const { pollResult } = await pollPresenceSourceTarget(env, target.userId, target.id);
      spentUnits += pollResult.costUnits ?? 1;
      const cursor = pollResult.cursor as Record<string, unknown> | undefined;
      results.push({
        targetId: target.id,
        ok: pollResult.ok,
        errorCode: pollResult.errorCode,
        syncCycleCount: typeof cursor?.syncCycleCount === "number" ? cursor.syncCycleCount : undefined,
      });
    } catch (error) {
      if (error instanceof PresenceServiceError && POLLING_SKIP_CURSOR_ERROR_CODES.has(error.code)) {
        await upsertPollCursor(env, target.id, {
          lastPolledAt: new Date().toISOString(),
          lastErrorCode: error.code,
          lastErrorMessage: error.message,
        });
      }
      results.push({
        targetId: target.id,
        ok: false,
        errorCode: error instanceof PresenceServiceError ? error.code : "poll_exception",
      });
    }
  }

  return { spentUnits, skippedRollout, polled: results.length, results };
}

export async function getPresenceWorkspaceSnapshot(env: AppEnv, userId: string) {
  const entities = await listTrackedEntities(env, userId);
  const items = await listPresenceItems(env, userId, { connectorId: "website", limit: 30 });
  const perEntitySources = await Promise.all(
    entities.map(async (entity) => {
      const sources = await listSourceTargetsForEntity(env, userId, entity.id);
      return {
        entity,
        sources: sources.filter((source) =>
          connectorHasCustomerPollPath(source.connectorId),
        ),
      };
    }),
  );
  // ONE cursor query for the whole workspace — the per-target read in a
  // loop was an N+1 costing hundreds of D1 reads at Agency caps.
  const allTargetIds = perEntitySources.flatMap(({ sources }) =>
    sources.map((source) => source.id),
  );
  const cursorsById = new Map(
    (await listPollCursorsForTargets(env, allTargetIds)).map((cursor) => [
      cursor.sourceTargetId,
      cursor,
    ]),
  );
  const enriched = perEntitySources.map(({ entity, sources }) => {
    // The list row must show CHECK time, not record-mutation time — an
    // entity edited yesterday but never successfully polled has no
    // freshness to claim.
    const cursors = sources.map((source) => cursorsById.get(source.id) ?? null);
    const lastPollAt = cursors.reduce<string | null>((latest, cursor) => {
      const at = cursor?.lastSuccessAt ?? null;
      if (!at) return latest;
      return !latest || at > latest ? at : latest;
    }, null);
    const lastPollFailed = cursors.some(
      (cursor) =>
        Boolean(cursor?.lastPolledAt) &&
        (Boolean(cursor?.lastErrorCode) ||
          !cursor?.lastSuccessAt ||
          (cursor.lastPolledAt as string) > (cursor.lastSuccessAt as string)),
    );
    return { entity, sources, lastPollAt, lastPollFailed };
  });
  return { entities: enriched, recentItems: items };
}

export async function deletePresenceEntity(env: AppEnv, userId: string, entityId: string) {
  await requirePresenceWorkspaceAccess(env, userId);
  const entity = await getTrackedEntity(env, userId, entityId);
  if (!entity) {
    throw new PresenceServiceError("not_found", "Tracked entity not found.", 404);
  }
  await softDeleteTrackedEntity(env, userId, entityId);
  return { ok: true as const };
}
