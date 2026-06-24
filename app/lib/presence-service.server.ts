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
  getTrackedEntity,
  listPresenceItems,
  listSourceTargetsForEntity,
  listTrackedEntities,
  softDeleteTrackedEntity,
  upsertPollCursor,
  upsertPresenceItems,
  upsertSourceTarget,
} from "~/lib/presence-data.server";
import { getUserPlan } from "~/lib/plan.server";
import type { PresenceConnectorId, PresenceTrackingMode } from "~/lib/presence-types";

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
  const access = evaluatePresenceWorkspaceAccess(env, workspaceUserId);
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
    throw new PresenceServiceError("entity_limit", "You have reached your tracked entity limit.");
  }
  const modeCount = await countTrackedEntities(env, userId, { trackingMode: input.trackingMode });
  const modeLimit =
    input.trackingMode === "self" ? limits.maxSelfEntities : limits.maxCompetitorEntities;
  if (modeCount >= modeLimit) {
    throw new PresenceServiceError("mode_limit", `You have reached your ${input.trackingMode} entity limit.`);
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

  const perEntityLimit =
    connectorId === "website" ? limits.maxWebsiteSourcesPerEntity : limits.maxSocialSourcesPerEntity;
  const current = await countSourceTargetsForEntity(env, entityId, connectorId);
  if (current >= perEntityLimit) {
    throw new PresenceServiceError("source_limit", `You have reached the ${connectorId} source limit for this entity.`);
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
  const entity = await getTrackedEntity(env, userId, target.trackedEntityId);
  if (!entity) {
    throw new PresenceServiceError("not_found", "Tracked entity not found.", 404);
  }

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
  await upsertPollCursor(env, target.id, {
    cursor: pollResult.cursor ?? cursor?.cursor ?? {},
    etag: pollResult.etag ?? cursor?.etag ?? null,
    lastModified: pollResult.lastModified ?? cursor?.lastModified ?? null,
    lastPolledAt: now,
    lastSuccessAt: pollResult.ok ? now : cursor?.lastSuccessAt ?? null,
    lastErrorCode: pollResult.ok ? null : pollResult.errorCode ?? "poll_failed",
    lastErrorMessage: pollResult.ok ? null : pollResult.errorMessage ?? null,
  });

  let upsertStats = { inserted: 0, updated: 0 };
  if (pollResult.ok && pollResult.items.length > 0) {
    upsertStats = await upsertPresenceItems(env, { sourceTarget: target, items: pollResult.items });
  }

  return { pollResult, upsertStats, target, entity };
}

const PRESENCE_POLL_BUDGET_UNITS = 40;

export async function runPresencePollingBatch(env: AppEnv, options: { limit?: number } = {}) {
  const { listActiveSourceTargetsForPolling } = await import("~/lib/presence-data.server");
  const targets = await listActiveSourceTargetsForPolling(env, options.limit ?? 20);
  let spentUnits = 0;
  const results: Array<{ targetId: string; ok: boolean; errorCode?: string }> = [];

  for (const target of targets) {
    if (spentUnits >= PRESENCE_POLL_BUDGET_UNITS) break;
    try {
      const { pollResult } = await pollPresenceSourceTarget(env, target.userId, target.id);
      spentUnits += pollResult.costUnits ?? 1;
      results.push({ targetId: target.id, ok: pollResult.ok, errorCode: pollResult.errorCode });
    } catch (error) {
      results.push({
        targetId: target.id,
        ok: false,
        errorCode: error instanceof PresenceServiceError ? error.code : "poll_exception",
      });
    }
  }

  return { spentUnits, results };
}

export async function getPresenceWorkspaceSnapshot(env: AppEnv, userId: string) {
  const entities = await listTrackedEntities(env, userId);
  const items = await listPresenceItems(env, userId, { limit: 30 });
  const enriched = await Promise.all(
    entities.map(async (entity) => ({
      entity,
      sources: await listSourceTargetsForEntity(env, userId, entity.id),
    })),
  );
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
