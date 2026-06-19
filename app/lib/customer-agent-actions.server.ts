import {
  applyWebsiteSearchFallback,
  hasInvalidCompetitorWebsite,
  normalizeCompetitorWebsiteInput,
  watchlistFingerprint,
} from "~/lib/competitor-website";
import type { AppEnv } from "~/lib/env.server";
import {
  AgentActionIdempotencyConflictError,
  AgentActionReplayUnavailableError,
  runAuditedAgentAction,
  sanitizeAgentActionMetadata,
} from "~/lib/agent-actions.server";
import { normalizeSavedQuery } from "~/lib/normalize";
import { parseReportId } from "~/lib/report";
import { normalizeWatchlistTrackingRole } from "~/lib/watchlist-role";
import type {
  AgentActionAuditRecord,
  AgentMemoryRecord,
  AgentMemoryScope,
  AppSession,
  ClientRoomRecord,
  ClientRoomResourceRef,
  DiscoveryFailureClass,
  ShareResourceType,
} from "~/lib/types";

export const CUSTOMER_AGENT_ACTION_NAMES = [
  "watchlist.create",
  "watchlist.refresh",
  "watchlist.pause",
  "watchlist.resume",
  "proof.add_external",
  "share.create",
  "report.create",
  "report.share",
  "counter_move_brief.create",
  "memory.upsert",
  "memory.list",
  "client_room.upsert",
  "client_room.list",
] as const;

export type CustomerAgentActionName = (typeof CUSTOMER_AGENT_ACTION_NAMES)[number];

const IDEMPOTENCY_REQUIRED_ACTIONS = new Set<CustomerAgentActionName>([
  "watchlist.create",
  "watchlist.refresh",
  "watchlist.pause",
  "watchlist.resume",
  "proof.add_external",
  "share.create",
  "report.share",
  "memory.upsert",
  "client_room.upsert",
]);

export interface CustomerAgentActionContext {
  userId: string;
  apiKeyId: string | null;
  idempotencyKey?: string | null;
  source: "mcp" | "api_v1";
  executionContext?: ExecutionContext | null;
  origin?: string | null;
}

export class CustomerAgentActionError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    options: {
      status?: number;
      details?: Record<string, unknown>;
    } = {},
  ) {
    super(message);
    this.name = "CustomerAgentActionError";
    this.code = code;
    this.status = options.status ?? 400;
    this.details = options.details ?? {};
  }
}

export function customerAgentActionErrorPayload(error: unknown) {
  if (error instanceof CustomerAgentActionError) {
    return {
      status: error.status,
      body: {
        ok: false,
        error: error.code,
        message: error.message,
        ...error.details,
      },
    };
  }

  if (error instanceof AgentActionIdempotencyConflictError) {
    return {
      status: 409,
      body: {
        ok: false,
        error: "idempotency_conflict",
        message: error.message,
      },
    };
  }

  if (error instanceof AgentActionReplayUnavailableError) {
    return {
      status: 409,
      body: {
        ok: false,
        error: "idempotency_replay_unavailable",
        message: error.message,
      },
    };
  }

  return {
    status: 500,
    body: {
      ok: false,
      error: "agent_action_failed",
      message: error instanceof Error ? error.message : "Agent action failed.",
    },
  };
}

export function normalizeCustomerAgentActionName(value: string | null | undefined): CustomerAgentActionName | null {
  const normalized = value?.trim().toLowerCase();
  return CUSTOMER_AGENT_ACTION_NAMES.includes(normalized as CustomerAgentActionName)
    ? (normalized as CustomerAgentActionName)
    : null;
}

export function customerAgentActionRequiresIdempotency(actionName: CustomerAgentActionName) {
  return IDEMPOTENCY_REQUIRED_ACTIONS.has(actionName);
}

export async function runCustomerAgentAction(
  env: AppEnv,
  context: CustomerAgentActionContext,
  actionName: CustomerAgentActionName,
  input: Record<string, unknown>,
) {
  const requestFingerprint = buildAgentActionRequestFingerprint(actionName, input);
  if (customerAgentActionRequiresIdempotency(actionName) && !context.idempotencyKey?.trim()) {
    throw new CustomerAgentActionError(
      "missing_idempotency_key",
      "Provide idempotencyKey or an Idempotency-Key header before running this action.",
    );
  }

  return runAuditedAgentAction<Record<string, unknown>>(env, {
    userId: context.userId,
    apiKeyId: context.apiKeyId,
    actionName,
    idempotencyKey: context.idempotencyKey,
    metadata: {
      source: context.source,
      requestFingerprint,
    },
  }, async () => {
    try {
      if (actionName === "watchlist.create") {
        const result = await createWatchlistFromAgent(env, context, input);
        return {
          resourceType: "watchlist",
          resourceId: result.watchlist.id,
          result,
          metadata: {
            watchlistId: result.watchlist.id,
          },
        };
      }

      if (actionName === "watchlist.refresh") {
        const result = await refreshWatchlistFromAgent(env, context.userId, input);
        return {
          resourceType: "watchlist",
          resourceId: result.watchlist.id,
          result,
          metadata: {
            watchlistId: result.watchlist.id,
          },
        };
      }

      if (actionName === "watchlist.pause" || actionName === "watchlist.resume") {
        const result = await setWatchlistActiveFromAgent(env, context.userId, input, actionName === "watchlist.resume");
        return {
          resourceType: "watchlist",
          resourceId: result.watchlist.id,
          result,
          metadata: {
            watchlistId: result.watchlist.id,
          },
        };
      }

      if (actionName === "proof.add_external") {
        const result = await addExternalProofFromAgent(env, context.userId, input);
        return {
          resourceType: "collection",
          resourceId: result.collectionId,
          result,
          metadata: {
            collectionId: result.collectionId,
            adId: result.ad.metaAdId,
          },
        };
      }

      if (actionName === "share.create") {
        const result = await createShareFromAgent(env, context, input);
        return {
          resourceType: result.resourceType,
          resourceId: result.resourceId,
          result,
          metadata: {
            shareLinkId: result.share.id,
            resourceType: result.resourceType,
            resourceId: result.resourceId,
          },
        };
      }

      if (actionName === "report.create") {
        const result = await buildReportFromAgent(env, context.userId, input);
        return {
          resourceType: "report",
          resourceId: result.report.reportId,
          result,
          metadata: {
            reportId: result.report.reportId,
          },
        };
      }

      if (actionName === "report.share") {
        const result = await shareReportFromAgent(env, context, input);
        return {
          resourceType: "report",
          resourceId: result.report.reportId,
          result,
          metadata: {
            reportId: result.report.reportId,
            shareLinkId: result.share.id,
          },
        };
      }

      if (actionName === "counter_move_brief.create") {
        const result = await buildCounterMoveBriefFromAgent(env, context.userId, input);
        return {
          resourceType: "watchlist",
          resourceId: result.brief.watchlistId,
          result,
          metadata: {
            watchlistId: result.brief.watchlistId,
            moveCount: result.brief.moves.length,
          },
        };
      }

      if (actionName === "memory.upsert") {
        const result = await upsertMemoryFromAgent(env, context, input);
        return {
          resourceType: "agent_memory",
          resourceId: result.memory.id,
          result,
          metadata: {
            memoryId: result.memory.id,
            scope: result.memory.scope,
            key: result.memory.key,
          },
        };
      }

      if (actionName === "memory.list") {
        const result = await listMemoryFromAgent(env, context.userId, input);
        return {
          resourceType: "agent_memory",
          resourceId: result.scope ?? "all",
          result,
          metadata: {
            scope: result.scope ?? "all",
            count: result.memories.length,
          },
        };
      }

      if (actionName === "client_room.upsert") {
        const result = await upsertClientRoomFromAgent(env, context, input);
        return {
          resourceType: "client_room",
          resourceId: result.room.id,
          result,
          metadata: {
            roomId: result.room.id,
            resourceCount: result.room.resourceRefs.length,
          },
        };
      }

      if (actionName === "client_room.list") {
        const result = await listClientRoomsFromAgent(env, context.userId, input);
        return {
          resourceType: "client_room",
          resourceId: result.status ?? "all",
          result,
          metadata: {
            status: result.status ?? "all",
            count: result.rooms.length,
          },
        };
      }

      throw new CustomerAgentActionError("unsupported_action", "Unsupported agent action.", { status: 404 });
    } catch (error) {
      if (error instanceof Response) {
        throw await customerErrorFromResponse(error);
      }
      throw error;
    }
  }, {
    replayCompleted: (audit) => replayCustomerAgentAction(env, context, actionName, audit),
  });
}

async function replayCustomerAgentAction(
  env: AppEnv,
  context: CustomerAgentActionContext,
  actionName: CustomerAgentActionName,
  audit: AgentActionAuditRecord,
) {
  if (actionName !== "share.create" && actionName !== "report.share") {
    return null;
  }
  return replayShareResultFromAudit(env, context, audit);
}

async function replayShareResultFromAudit(
  env: AppEnv,
  context: CustomerAgentActionContext,
  audit: AgentActionAuditRecord,
) {
  const result = audit.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }
  const shareValue = result.share;
  if (!shareValue || typeof shareValue !== "object" || Array.isArray(shareValue)) {
    return null;
  }
  const shareId = readString(shareValue as Record<string, unknown>, "id");
  if (!shareId) {
    return null;
  }

  const { getShareLinkById } = await import("~/lib/data.server");
  const share = await getShareLinkById(env, context.userId, shareId);
  if (!share) {
    return null;
  }

  return {
    ...result,
    share: {
      id: share.id,
      token: share.token,
      expiresAt: share.expiresAt,
    },
    shareUrl: shareUrl(context, share.token),
  };
}

async function createWatchlistFromAgent(
  env: AppEnv,
  context: CustomerAgentActionContext,
  input: Record<string, unknown>,
) {
  const { checkPlanLimit } = await import("~/lib/plan.server");
  const { createWatchlist } = await import("~/lib/data.server");
  const { queueFirstWatchlistScan } = await import("~/lib/monitoring.server");

  const targetLabelInput = readString(input, "targetLabel") ?? readString(input, "query");
  const competitorWebsite = normalizeCompetitorWebsiteInput(readString(input, "competitorWebsite") ?? "");
  if (hasInvalidCompetitorWebsite(competitorWebsite)) {
    throw new CustomerAgentActionError("invalid_competitor_website", competitorWebsite.error ?? "Invalid website.");
  }

  const query = targetLabelInput ?? competitorWebsite.searchTerm;
  if (!query) {
    throw new CustomerAgentActionError(
      "missing_target",
      "Provide targetLabel, query, or competitorWebsite before creating a watchlist.",
    );
  }

  const limit = await checkPlanLimit(env, context.userId, "watchlists");
  if (!limit.allowed) {
    throw new CustomerAgentActionError("plan_limit_exceeded", "You have reached your competitor tracking limit.", {
      status: 402,
      details: {
        limit: limit.limit,
        current: limit.current,
      },
    });
  }

  const country = readString(input, "targetCountry") ?? readString(input, "country") ?? "all";
  const normalizedQuery = applyWebsiteSearchFallback(
    normalizeSavedQuery("advertiser", {
      query,
      country,
    }),
    competitorWebsite,
  );
  const inferredName = competitorWebsite.displayName ?? normalizedQuery.filters.query;
  const name = readString(input, "name") ?? `${inferredName} watch`;
  const trackingRole = normalizeWatchlistTrackingRole(readString(input, "trackingRole"));
  const watchlist = await createWatchlist(env, context.userId, {
    name,
    targetType: "advertiser",
    targetId: competitorWebsite.normalizedUrl ?? normalizedQuery.filters.query,
    targetFingerprint: watchlistFingerprint(normalizedQuery, competitorWebsite),
    targetLabel: normalizedQuery.filters.query,
    targetCountry: normalizedQuery.filters.country,
    trackingRole,
  });

  if (!watchlist) {
    throw new CustomerAgentActionError("watchlist_create_failed", "Could not create this watchlist.", {
      status: 500,
    });
  }

  const shouldQueueFirstScan = readBoolean(input, "queueFirstScan", true);
  const firstScanQueued = shouldQueueFirstScan
    ? queueFirstWatchlistScan(env, context.executionContext ?? undefined, watchlist)
    : false;

  return {
    ok: true,
    action: "watchlist.create",
    watchlist,
    firstScanQueued,
  };
}

async function addExternalProofFromAgent(
  env: AppEnv,
  userId: string,
  input: Record<string, unknown>,
) {
  const { addExternalProofToCollection, getCollection } = await import("~/lib/data.server");
  const collectionId = requireString(input, "collectionId");
  const collection = await getCollection(env, collectionId, userId);

  if (!collection) {
    throw new CustomerAgentActionError("collection_not_found", "Board not found.", { status: 404 });
  }

  const ad = await addExternalProofToCollection(env, userId, collection.id, {
    advertiser: requireString(input, "advertiser"),
    proofUrl: requireString(input, "proofUrl"),
    channel: readString(input, "channel") ?? "Other",
    hook: requireString(input, "hook"),
    offer: readString(input, "offer"),
    cta: readString(input, "cta"),
    note: readString(input, "note"),
    observedAt: readString(input, "observedAt"),
    spend: readString(input, "spend"),
    impressions: readString(input, "impressions"),
    reach: readString(input, "reach"),
    tags: readStringList(input, "tags"),
  });

  return {
    ok: true,
    action: "proof.add_external",
    collectionId: collection.id,
    ad,
    message: `Saved ${ad.platforms[0] ?? "external"} proof for ${ad.advertiser}.`,
  };
}

async function createShareFromAgent(
  env: AppEnv,
  context: CustomerAgentActionContext,
  input: Record<string, unknown>,
) {
  const { createShareLink } = await import("~/lib/data.server");
  const resourceType = readShareResourceType(input);
  if (resourceType === "report") {
    throw new CustomerAgentActionError(
      "unsupported_share_resource",
      "Use report.share to create a report snapshot link.",
    );
  }

  const resourceId = requireString(input, "resourceId");
  await assertShareResourceOwned(env, context.userId, resourceType, resourceId);
  const share = await createShareLink(env, agentSession(context.userId, context.apiKeyId), {
    resourceType,
    resourceId,
    isSnapshot: false,
  });

  return {
    ok: true,
    action: "share.create",
    resourceType,
    resourceId,
    share,
    shareUrl: shareUrl(context, share.token),
  };
}

async function buildReportFromAgent(
  env: AppEnv,
  userId: string,
  input: Record<string, unknown>,
) {
  const { report } = await loadReportDocumentForAgent(env, userId, input);
  return {
    ok: true,
    action: "report.create",
    report,
  };
}

async function shareReportFromAgent(
  env: AppEnv,
  context: CustomerAgentActionContext,
  input: Record<string, unknown>,
) {
  const { createShareLink } = await import("~/lib/data.server");
  const report = (await loadReportDocumentForAgent(env, context.userId, input)).report;
  const share = await createShareLink(env, agentSession(context.userId, context.apiKeyId), {
    resourceType: "report",
    resourceId: report.reportId,
    isSnapshot: true,
    snapshotPayload: report as unknown as Record<string, unknown>,
  });

  return {
    ok: true,
    action: "report.share",
    report,
    share,
    shareUrl: shareUrl(context, share.token),
  };
}

async function loadReportDocumentForAgent(
  env: AppEnv,
  userId: string,
  input: Record<string, unknown>,
) {
  const {
    getCollection,
    getWatchlist,
    listAdsByIds,
    listCollectionItems,
    listWatchEvents,
  } = await import("~/lib/data.server");
  const {
    buildCollectionReport,
    buildWatchlistReport,
  } = await import("~/lib/report-builder.server");
  const parsedReport = parseReportId(readString(input, "reportId") ?? "");
  const resourceType = parsedReport?.resourceType ?? readReportResourceType(input);
  const resourceId = parsedReport?.resourceId ?? requireString(input, "resourceId");

  if (resourceType === "collection") {
    const collection = await getCollection(env, resourceId, userId);
    if (!collection) {
      throw new CustomerAgentActionError("collection_not_found", "Board not found.", { status: 404 });
    }

    return {
      ok: true,
      report: buildCollectionReport({
        collection,
        items: await listCollectionItems(env, collection.id),
      }),
    };
  }

  const watchlist = await getWatchlist(env, resourceId, userId);
  if (!watchlist) {
    throw new CustomerAgentActionError("watchlist_not_found", "Watchlist not found.", { status: 404 });
  }

  const events = await listWatchEvents(env, watchlist.id, 60);
  const ads = await listAdsByIds(
    env,
    events
      .map((event) => event.adId)
      .filter((adId): adId is string => Boolean(adId)),
  );

  return {
    ok: true,
    report: buildWatchlistReport({
      watchlist,
      events,
      adsById: new Map(ads.map((ad) => [ad.metaAdId, ad])),
    }),
  };
}

async function buildCounterMoveBriefFromAgent(
  env: AppEnv,
  userId: string,
  input: Record<string, unknown>,
) {
  const {
    getWatchlist,
    listAdsByIds,
    listWatchEvents,
  } = await import("~/lib/data.server");
  const { buildCounterMoveBrief } = await import("~/lib/counter-move-brief.server");
  const watchlistId = requireString(input, "watchlistId");
  const watchlist = await getWatchlist(env, watchlistId, userId);
  if (!watchlist) {
    throw new CustomerAgentActionError("watchlist_not_found", "Watchlist not found.", { status: 404 });
  }

  const limit = readInteger(input, "limit", 5);
  const events = await listWatchEvents(env, watchlist.id, Math.max(1, Math.min(60, limit * 3)));
  const linkedAdIds = events
    .map((event) => event.adId)
    .filter((adId): adId is string => Boolean(adId));
  const ads = linkedAdIds.length > 0 ? await listAdsByIds(env, linkedAdIds) : [];
  const brief = buildCounterMoveBrief({
    watchlist,
    events,
    adsById: new Map(ads.map((ad) => [ad.metaAdId, ad])),
    limit,
    timeZone: readString(input, "timeZone"),
  });

  return {
    ok: true,
    action: "counter_move_brief.create",
    brief,
  };
}

async function upsertMemoryFromAgent(
  env: AppEnv,
  context: CustomerAgentActionContext,
  input: Record<string, unknown>,
) {
  const { upsertAgentMemory } = await import("~/lib/data.server");
  const watchlistId = readString(input, "watchlistId");
  const clientRoomId = readString(input, "clientRoomId");
  await assertMemoryScopeOwned(env, context.userId, { watchlistId, clientRoomId });
  const memory = await upsertAgentMemory(env, context.userId, {
    scope: readAgentMemoryScope(input),
    key: readMemoryKey(input),
    watchlistId,
    clientRoomId,
    value: readMemoryValue(input),
    source: readMemorySource(input) ?? context.source,
  });

  if (!memory) {
    throw new CustomerAgentActionError("memory_upsert_failed", "Could not save memory.", { status: 500 });
  }

  return {
    ok: true,
    action: "memory.upsert",
    memory: safeMemoryRecord(memory),
  };
}

async function listMemoryFromAgent(
  env: AppEnv,
  userId: string,
  input: Record<string, unknown>,
) {
  const { listAgentMemory } = await import("~/lib/data.server");
  const scope = readOptionalAgentMemoryScope(input);
  const watchlistId = readString(input, "watchlistId");
  const clientRoomId = readString(input, "clientRoomId");
  await assertMemoryScopeOwned(env, userId, { watchlistId, clientRoomId });
  const memories = await listAgentMemory(env, userId, {
    scope,
    ...(watchlistId ? { watchlistId } : {}),
    ...(clientRoomId ? { clientRoomId } : {}),
    limit: readInteger(input, "limit", 50),
  });

  return {
    ok: true,
    action: "memory.list",
    scope,
    memories: memories.map(safeMemoryRecord),
  };
}

async function upsertClientRoomFromAgent(
  env: AppEnv,
  context: CustomerAgentActionContext,
  input: Record<string, unknown>,
) {
  const { upsertClientRoom } = await import("~/lib/data.server");
  const resourceRefs = readClientRoomResourceRefs(input);
  if (typeof resourceRefs !== "undefined") {
    await assertClientRoomResourceRefsOwned(env, context.userId, resourceRefs);
  }
  const room = await upsertClientRoom(env, context.userId, {
    roomId: readString(input, "roomId"),
    name: requireString(input, "name"),
    clientLabel: readString(input, "clientLabel"),
    status: readClientRoomStatus(input),
    resourceRefs,
    notes: readOptionalObject(input, "notes"),
  });

  if (!room) {
    throw new CustomerAgentActionError("client_room_upsert_failed", "Could not save client room.", { status: 500 });
  }

  return {
    ok: true,
    action: "client_room.upsert",
    room,
  };
}

async function listClientRoomsFromAgent(
  env: AppEnv,
  userId: string,
  input: Record<string, unknown>,
) {
  const { listClientRooms } = await import("~/lib/data.server");
  const status = readOptionalClientRoomStatus(input) ?? "active";
  const rooms = await listClientRooms(env, userId, {
    status,
    limit: readInteger(input, "limit", 50),
  });

  return {
    ok: true,
    action: "client_room.list",
    status,
    rooms,
  };
}

async function refreshWatchlistFromAgent(env: AppEnv, userId: string, input: Record<string, unknown>) {
  const { CommercialDiscoveryError } = await import("~/lib/ad-source.server");
  const { getWatchlist } = await import("~/lib/data.server");
  const { runWatchlistManual } = await import("~/lib/monitoring.server");
  const { getUserPlan } = await import("~/lib/plan.server");
  const watchlistId = requireString(input, "watchlistId");
  const watchlist = await getWatchlist(env, watchlistId, userId);

  if (!watchlist || !watchlist.isActive) {
    throw new CustomerAgentActionError("watchlist_not_found", "Watchlist not found.", { status: 404 });
  }

  const plan = await getUserPlan(env, userId);
  if (plan === "free") {
    throw new CustomerAgentActionError(
      "plan_limit_exceeded",
      "Fresh checks are included in paid plans - upgrade to refresh this watchlist.",
      { status: 402 },
    );
  }

  try {
    await runWatchlistManual(env, watchlist);
  } catch (error) {
    if (error instanceof CommercialDiscoveryError) {
      throw new CustomerAgentActionError(
        error.failureClass,
        formatWatchlistRefreshFailure(error.failureClass, error.retryAfterSeconds),
        {
          status: error.failureClass === "rate_limited" ? 429 : 503,
          details: {
            retryAfterSeconds: error.retryAfterSeconds,
          },
        },
      );
    }

    if (
      error instanceof Error &&
      (error.message.includes("refreshed recently") ||
        error.message.includes("already running") ||
        error.message.includes("could not be resolved"))
    ) {
      throw new CustomerAgentActionError("watchlist_refresh_unavailable", error.message, { status: 409 });
    }

    throw error;
  }

  return {
    ok: true,
    action: "watchlist.refresh",
    watchlist,
    message: `${watchlist.name} refreshed successfully.`,
  };
}

async function assertShareResourceOwned(
  env: AppEnv,
  userId: string,
  resourceType: Exclude<ShareResourceType, "report">,
  resourceId: string,
) {
  const { getCollection, getDigest, getWatchlist } = await import("~/lib/data.server");

  if (resourceType === "collection") {
    const collection = await getCollection(env, resourceId, userId);
    if (!collection) {
      throw new CustomerAgentActionError("collection_not_found", "Board not found.", { status: 404 });
    }
    return;
  }

  if (resourceType === "watchlist") {
    const watchlist = await getWatchlist(env, resourceId, userId);
    if (!watchlist) {
      throw new CustomerAgentActionError("watchlist_not_found", "Watchlist not found.", { status: 404 });
    }
    return;
  }

  const digest = await getDigest(env, resourceId);
  if (!digest || digest.userId !== userId) {
    throw new CustomerAgentActionError("digest_not_found", "Digest not found.", { status: 404 });
  }
}

async function setWatchlistActiveFromAgent(
  env: AppEnv,
  userId: string,
  input: Record<string, unknown>,
  isActive: boolean,
) {
  const { checkPlanLimit } = await import("~/lib/plan.server");
  const { getWatchlist, setWatchlistActive } = await import("~/lib/data.server");
  const watchlistId = requireString(input, "watchlistId");
  const watchlist = await getWatchlist(env, watchlistId, userId);

  if (!watchlist) {
    throw new CustomerAgentActionError("watchlist_not_found", "Watchlist not found.", { status: 404 });
  }

  if (isActive && !watchlist.isActive) {
    const limit = await checkPlanLimit(env, userId, "watchlists");
    if (!limit.allowed) {
      throw new CustomerAgentActionError(
        "plan_limit_exceeded",
        "You have reached your competitor tracking limit - pause another watchlist first.",
        {
          status: 402,
          details: {
            limit: limit.limit,
            current: limit.current,
          },
        },
      );
    }
  }

  const changed = await setWatchlistActive(env, userId, watchlist.id, isActive);
  if (!changed) {
    throw new CustomerAgentActionError("watchlist_update_failed", "Could not update this watchlist.", {
      status: 500,
    });
  }

  return {
    ok: true,
    action: isActive ? "watchlist.resume" : "watchlist.pause",
    watchlist: {
      ...watchlist,
      isActive,
    },
    message: isActive
      ? "Watchlist resumed. It rejoins the next scheduled scan."
      : "Watchlist paused. Scans and alerts stop, the history stays, and the plan slot is free.",
  };
}

function requireString(input: Record<string, unknown>, field: string) {
  const value = readString(input, field);
  if (!value) {
    throw new CustomerAgentActionError("missing_field", `${field} is required.`);
  }
  return value;
}

function readString(input: Record<string, unknown>, field: string) {
  const value = input[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBoolean(input: Record<string, unknown>, field: string, fallback: boolean) {
  const value = input[field];
  return typeof value === "boolean" ? value : fallback;
}

function readInteger(input: Record<string, unknown>, field: string, fallback: number) {
  const value = input[field];
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Math.floor(Number(value));
  }
  return fallback;
}

function readStringList(input: Record<string, unknown>, field: string) {
  const value = input[field];
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
      .map((entry) => entry.trim());
  }
  const single = readString(input, field);
  return single
    ? single
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
    : [];
}

function readShareResourceType(input: Record<string, unknown>): ShareResourceType {
  const value = readString(input, "resourceType");
  if (value === "collection" || value === "watchlist" || value === "digest" || value === "report") {
    return value;
  }
  throw new CustomerAgentActionError(
    "invalid_resource_type",
    "resourceType must be collection, watchlist, digest, or report.",
  );
}

function readReportResourceType(input: Record<string, unknown>) {
  const value = readString(input, "resourceType") ?? readString(input, "reportResourceType");
  if (value === "collection" || value === "watchlist") {
    return value;
  }
  throw new CustomerAgentActionError("invalid_resource_type", "resourceType must be collection or watchlist.");
}

function readAgentMemoryScope(input: Record<string, unknown>): AgentMemoryScope {
  return readOptionalAgentMemoryScope(input) ?? "workspace";
}

function readOptionalAgentMemoryScope(input: Record<string, unknown>): AgentMemoryScope | null {
  const value = readString(input, "scope");
  if (!value) {
    return null;
  }
  if (value === "workspace" || value === "customer" || value === "brand" || value === "competitor") {
    return value;
  }
  throw new CustomerAgentActionError(
    "invalid_memory_scope",
    "scope must be workspace, customer, brand, or competitor.",
  );
}

function readMemoryKey(input: Record<string, unknown>) {
  const key = requireString(input, "key");
  if (isSecretishField(key)) {
    throw new CustomerAgentActionError("secret_memory_rejected", "Memory keys cannot describe secrets or credentials.");
  }
  return key;
}

function readMemorySource(input: Record<string, unknown>) {
  const source = readString(input, "source");
  if (source && isSecretishField(source)) {
    throw new CustomerAgentActionError("secret_memory_rejected", "Memory source cannot describe secrets or credentials.");
  }
  return source;
}

function readMemoryValue(input: Record<string, unknown>) {
  const value = input.value;
  rejectSecretishMemoryValue(value);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
    return { value };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return sanitizeAgentActionMetadata(value);
  }
  if (Array.isArray(value)) {
    return {
      items: value.map((entry) =>
        entry && typeof entry === "object" && !Array.isArray(entry)
          ? sanitizeAgentActionMetadata(entry)
          : entry,
      ),
    };
  }
  throw new CustomerAgentActionError("missing_field", "value is required.");
}

function safeMemoryRecord(memory: AgentMemoryRecord): AgentMemoryRecord {
  return {
    ...memory,
    value: sanitizeAgentActionMetadata(memory.value),
    source: memory.source && isSecretishField(memory.source) ? null : memory.source,
  };
}

function rejectSecretishMemoryValue(value: unknown) {
  if (typeof value === "string") {
    if (isSecretishString(value)) {
      throw new CustomerAgentActionError("secret_memory_rejected", "Memory values cannot contain secrets or credentials.");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      rejectSecretishMemoryValue(entry);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretishField(key)) {
        throw new CustomerAgentActionError("secret_memory_rejected", "Memory values cannot contain secret fields.");
      }
      rejectSecretishMemoryValue(nested);
    }
  }
}

function readOptionalObject(input: Record<string, unknown>, field: string) {
  const value = input[field];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return sanitizeAgentActionMetadata(value);
}

function readOptionalClientRoomStatus(input: Record<string, unknown>): ClientRoomRecord["status"] | "all" | null {
  const value = readString(input, "status");
  if (!value) {
    return null;
  }
  if (value === "active" || value === "archived" || value === "all") {
    return value;
  }
  throw new CustomerAgentActionError("invalid_room_status", "status must be active, archived, or all.");
}

function readClientRoomStatus(input: Record<string, unknown>): ClientRoomRecord["status"] {
  const status = readOptionalClientRoomStatus(input);
  if (!status || status === "all") {
    return "active";
  }
  return status;
}

function readClientRoomResourceRefs(input: Record<string, unknown>) {
  const value = input.resourceRefs ?? input.resources;
  if (typeof value === "undefined") {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new CustomerAgentActionError("invalid_resource_refs", "resourceRefs must be an array.");
  }

  const refs = value.slice(0, 25).map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new CustomerAgentActionError("invalid_resource_refs", "Each resource ref must be an object.");
    }
    const ref = entry as Record<string, unknown>;
    const resourceType = readClientRoomResourceType(ref);
    const resourceId = requireString(ref, "resourceId");
    const label = readString(ref, "label");
    return {
      resourceType,
      resourceId,
      ...(label ? { label } : {}),
    } satisfies ClientRoomResourceRef;
  });

  return Array.from(
    new Map(refs.map((ref) => [`${ref.resourceType}:${ref.resourceId}`, ref])).values(),
  );
}

function readClientRoomResourceType(input: Record<string, unknown>): ShareResourceType {
  const value = readString(input, "resourceType");
  if (value === "collection" || value === "watchlist" || value === "digest" || value === "report") {
    return value;
  }
  throw new CustomerAgentActionError(
    "invalid_resource_type",
    "client room resources must be collection, watchlist, digest, or report.",
  );
}

async function assertClientRoomResourceRefsOwned(
  env: AppEnv,
  userId: string,
  refs: ClientRoomResourceRef[],
) {
  for (const ref of refs) {
    if (ref.resourceType === "report") {
      await assertReportResourceOwned(env, userId, ref.resourceId);
    } else {
      await assertShareResourceOwned(env, userId, ref.resourceType, ref.resourceId);
    }
  }
}

async function assertReportResourceOwned(env: AppEnv, userId: string, reportId: string) {
  const parsedReport = parseReportId(reportId);
  if (!parsedReport) {
    throw new CustomerAgentActionError(
      "invalid_report_id",
      "report resources must use a report id such as collection:<id> or watchlist:<id>.",
    );
  }

  if (parsedReport.resourceType === "collection") {
    await assertShareResourceOwned(env, userId, "collection", parsedReport.resourceId);
    return;
  }

  await assertShareResourceOwned(env, userId, "watchlist", parsedReport.resourceId);
}

async function assertMemoryScopeOwned(
  env: AppEnv,
  userId: string,
  input: {
    watchlistId: string | null;
    clientRoomId: string | null;
  },
) {
  if (input.watchlistId && input.clientRoomId) {
    throw new CustomerAgentActionError(
      "invalid_memory_scope",
      "Memory can be scoped to either a watchlist or a client room, not both.",
    );
  }

  if (input.watchlistId) {
    const { getWatchlist } = await import("~/lib/data.server");
    const watchlist = await getWatchlist(env, input.watchlistId, userId);
    if (!watchlist) {
      throw new CustomerAgentActionError("watchlist_not_found", "Watchlist not found.", { status: 404 });
    }
  }

  if (input.clientRoomId) {
    const { getClientRoom } = await import("~/lib/data.server");
    const room = await getClientRoom(env, userId, input.clientRoomId);
    if (!room) {
      throw new CustomerAgentActionError("client_room_not_found", "Client room not found.", { status: 404 });
    }
  }
}

function agentSession(userId: string, apiKeyId: string | null): AppSession {
  return {
    user: {
      id: userId,
      email: "",
      name: "API key",
    },
    session: {
      id: apiKeyId ? `api-key:${apiKeyId}` : "api-key",
      userId,
      expiresAt: "",
    },
  };
}

function shareUrl(context: CustomerAgentActionContext, token: string) {
  return context.origin ? new URL(`/share/${token}`, context.origin).toString() : `/share/${token}`;
}

async function customerErrorFromResponse(response: Response) {
  const message = await response.text().catch(() => "") || response.statusText || "Agent action failed.";
  return new CustomerAgentActionError("invalid_action_input", message, {
    status: response.status >= 400 ? response.status : 400,
  });
}

function formatWatchlistRefreshFailure(
  failureClass: DiscoveryFailureClass,
  retryAfterSeconds: number | null = null,
) {
  switch (failureClass) {
    case "rate_limited":
      return retryAfterSeconds && retryAfterSeconds > 0
        ? `Competitor ad checks are temporarily rate limited. Retry after about ${formatRetryAfterLabel(
            retryAfterSeconds,
          )}. Scheduled checks will keep retrying.`
        : "Competitor ad checks are temporarily rate limited. Scheduled checks will keep retrying.";
    case "timeout":
      return "Competitor ad check timed out. Try again in a few minutes.";
    case "login_wall":
      return "Meta blocked the ad library check just now. Try again in a few minutes.";
    default:
      return "Competitor ad checks are temporarily unavailable. Try again in a few minutes.";
  }
}

function formatRetryAfterLabel(retryAfterSeconds: number) {
  if (retryAfterSeconds < 60) {
    return `${retryAfterSeconds}s`;
  }

  const minutes = Math.ceil(retryAfterSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function isSecretishField(value: string) {
  return /^(key|token|secret|password)$/i.test(value.trim()) ||
    /(authorization|bearer|credential|encrypted|password|secret|token|webhook|api[_-]?key|privatekey|accesskey)/i
    .test(value);
}

function isSecretishString(value: string) {
  return /(?:^f9_live_|bearer\s+|xox[baprs]-|sk-[a-z0-9]|hooks\.slack\.com\/services|\/share\/[a-z0-9_-]{12,}|https:\/\/[^/\s]+\/share\/[a-z0-9_-]{12,})/i
    .test(value);
}

function buildAgentActionRequestFingerprint(actionName: CustomerAgentActionName, input: Record<string, unknown>) {
  return fnv1a32(`${actionName}:${stableStringify(sanitizeAgentActionInputForFingerprint(input))}`);
}

function sanitizeAgentActionInputForFingerprint(input: Record<string, unknown>) {
  const sanitized = sanitizeAgentActionMetadata(input);
  delete sanitized.action;
  delete sanitized.idempotencyKey;
  return sanitized;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, nestedValue]) => typeof nestedValue !== "undefined")
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableStringify(nestedValue)}`).join(",")}}`;
  }
  return "null";
}

function fnv1a32(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
