import {
  applyWebsiteSearchFallback,
  competitorTrackingLabel,
  hasInvalidCompetitorWebsite,
  isHttpCompetitorWebsite,
  normalizeCompetitorWebsiteInput,
  watchlistFingerprint,
} from "~/lib/competitor-website";
import type { AppEnv } from "~/lib/env.server";
import {
  AgentActionStaleWriteError,
  runAtomicAgentAction,
  runAuditedAgentAction,
  sanitizeAgentActionMetadata,
} from "~/lib/agent-actions.server";
import {
  AgentMemoryInputError,
  isSecretishMemoryString,
  readOptionalSafeAgentMemoryScope,
  readSafeAgentMemoryKey,
  readSafeAgentMemoryScope,
  readSafeAgentMemorySource,
  readSafeAgentMemoryValue,
  rejectSecretishMemoryValue,
  safeAgentMemoryRecord,
  sanitizeAgentFacingValue,
} from "~/lib/agent-memory.server";
import type { CustomerAgentActionName } from "~/lib/agent-action-catalog";
import {
  isSlackWebhookDeliveryCustomerFacing,
  isTeamsWebhookDeliveryCustomerFacing,
  isWhatsAppDeliveryCustomerFacing,
  slackDeliveryUnavailableMessage,
  whatsappDeliveryUnavailableMessage,
} from "~/lib/ga-customer-surface";
import { normalizeSavedQuery } from "~/lib/normalize";
import { isClientReportEligibleWatchEvent } from "~/lib/proof-classification";
import { createReportId, parseReportId } from "~/lib/report";
import { loadOwnedReportDocument } from "~/lib/report-loader.server";
import { normalizeTimeZone, safeTimeZone } from "~/lib/safe-timezone";
import { createApprovedReportSnapshot, evaluateReportReadiness } from "~/lib/report-approval";
import {
  normalizeSupportCaseInput,
  requiresWorkspaceOwnerAuthority,
  SupportCaseInputError,
} from "~/lib/support";
import { normalizeWatchlistTrackingRole } from "~/lib/watchlist-role";
import { createId, nowIso } from "~/lib/data/helpers.server";
import {
  prepareAtomicShareLinkInsert,
  SHARE_LINK_DEFAULT_TTL_DAYS,
} from "~/lib/data/shares.server";
import {
  prepareAtomicClientRoomUpsert,
  preserveClientRoomReportApprovals,
  sameClientRoomResourceRefs,
  strictlyNewerClientRoomTimestamp,
} from "~/lib/data/customer-api-rooms.server";
import type { CounterMoveFollowUpChannel } from "~/lib/counter-move-brief.server";
import {
  buildAgentActionRequestFingerprint,
  clampListLimit,
  CustomerAgentActionError,
  customerAgentActionRequiresIdempotency,
  customerAgentActionSupportsIdempotency,
  readBoolean,
  readInteger,
  readOptionalBoolean,
  readString,
  readStringList,
  requireString,
  type CustomerAgentActionContext,
} from "~/lib/customer-agent-actions/request.server";
import {
  createSupportCaseFromAgent,
  listSupportCasesFromAgent,
} from "~/lib/customer-agent-actions/support-cases.server";
import { listWebMentionsFromAgent } from "~/lib/customer-agent-actions/web-mentions.server";
import type {
  AgentActionAuditRecord,
  AgentMemoryRecord,
  AgentMemoryScope,
  ClientRoomRecord,
  ClientRoomResourceRef,
  DeliveryChannel,
  DeliveryQuietHours,
  DeliveryTargetRecord,
  DiscoveryFailureClass,
  SensitivityMode,
  ShareResourceType,
  WatchlistDeliveryConfigRecord,
  WatchEventRecord,
} from "~/lib/types";

export { CUSTOMER_AGENT_ACTION_NAMES } from "~/lib/agent-action-catalog";
export type { CustomerAgentActionName } from "~/lib/agent-action-catalog";
export {
  buildAgentActionRequestFingerprint,
  CustomerAgentActionError,
  customerAgentActionErrorPayload,
  customerAgentActionRequiresIdempotency,
  normalizeCustomerAgentActionName,
} from "~/lib/customer-agent-actions/request.server";
export type { CustomerAgentActionContext } from "~/lib/customer-agent-actions/request.server";

const WORKSPACE_OWNER_ONLY_ACTIONS = new Set<CustomerAgentActionName>([
  "source.meta.retest",
  "delivery_targets.list",
  "delivery_settings.update",
  "delivery_target.update",
]);

function actionReversal(
  action: CustomerAgentActionName,
  input: Record<string, unknown>,
  note: string,
  options: { requiresExplicitApproval?: boolean } = {},
) {
  return {
    action,
    input,
    requiresNewIdempotencyKey: true,
    requiresExplicitApproval: options.requiresExplicitApproval ?? false,
    note,
  };
}

export async function runCustomerAgentAction(
  env: AppEnv,
  context: CustomerAgentActionContext,
  actionName: CustomerAgentActionName,
  input: Record<string, unknown>,
) {
  const requestFingerprint = buildAgentActionRequestFingerprint(actionName, input);
  const normalizedIdempotencyKey = context.idempotencyKey?.trim() ?? null;
  const idempotencyKey = customerAgentActionSupportsIdempotency(actionName) ? normalizedIdempotencyKey : null;
  if (customerAgentActionRequiresIdempotency(actionName) && !idempotencyKey) {
    throw new CustomerAgentActionError(
      "missing_idempotency_key",
      "Provide idempotencyKey or an Idempotency-Key header before running this action.",
    );
  }
  if (actionName === "support_case.create" && idempotencyKey && idempotencyKey.length > 120) {
    throw new CustomerAgentActionError(
      "invalid_idempotency_key",
      "Support-case idempotency keys must be 120 characters or fewer.",
      { status: 400 },
    );
  }

  if (actionName === "share.create" || actionName === "report.share" || actionName === "client_room.upsert") {
    const { resolveWorkspaceDataUserId } = await import("~/lib/workspace.server");
    const { requireCustomerAgentActionFeature } = await import("~/lib/plan-feature-gate.server");
    const workspaceUserId = await resolveWorkspaceDataUserId(env, context.userId);
    const actionGate = await requireCustomerAgentActionFeature(env, workspaceUserId, actionName, input);
    if (!actionGate.ok) {
      throw new CustomerAgentActionError("plan_gated", "This capability is not included in your current plan.");
    }
    if (actionName === "report.share" && readOptionalBoolean(input, "reviewed") !== true) {
      throw new CustomerAgentActionError(
        "review_required",
        "Set reviewed to true before sharing the current report.",
      );
    }

    try {
      return await runAtomicAgentAction<Record<string, unknown>>(
        env,
        {
          userId: context.userId,
          apiKeyId: context.apiKeyId,
          actionName,
          idempotencyKey,
          metadata: { source: context.source },
        },
        {
          requestFingerprint,
          prepare: (db, auditId) => actionName === "client_room.upsert"
            ? prepareAtomicClientRoomAction(env, context, workspaceUserId, input, auditId, requestFingerprint, db)
            : prepareAtomicShareAction(env, context, workspaceUserId, actionName, input, auditId, requestFingerprint, db),
        },
      );
    } catch (error) {
      if (error instanceof AgentActionStaleWriteError) {
        throw new CustomerAgentActionError(
          "stale_write",
          "This client room changed since it was read. Reload it and retry with a new idempotency key.",
          { status: 409 },
        );
      }
      throw error;
    }
  }

  return runAuditedAgentAction<Record<string, unknown>>(env, {
    userId: context.userId,
    apiKeyId: context.apiKeyId,
    actionName,
    idempotencyKey,
    metadata: {
      source: context.source,
      requestFingerprint,
    },
  }, async () => {
    const { resolveWorkspace } = await import("~/lib/workspace.server");
    const { requireCustomerAgentActionFeature } = await import("~/lib/plan-feature-gate.server");
    const workspace = await resolveWorkspace(env, context.userId);
    const { workspaceUserId } = workspace;
    if (workspace.isMember && WORKSPACE_OWNER_ONLY_ACTIONS.has(actionName)) {
      throw new CustomerAgentActionError(
        "workspace_owner_required",
        "Only the workspace owner can manage source access and delivery settings.",
        { status: 403 },
      );
    }
    const actionGate = await requireCustomerAgentActionFeature(
      env,
      workspaceUserId,
      actionName,
      input,
    );
    if (!actionGate.ok) {
      throw new CustomerAgentActionError("plan_gated", "This capability is not included in your current plan.");
    }

    try {
      let normalizedSupportInput: ReturnType<typeof normalizeSupportCaseInput> | null = null;
      if (actionName === "support_case.create") {
        normalizedSupportInput = normalizeSupportCaseInput({
          category: input.category,
          priority: input.priority ?? "normal",
          subject: input.subject,
          detail: input.detail,
        });
        if (workspace.isMember && requiresWorkspaceOwnerAuthority(normalizedSupportInput)) {
          throw new CustomerAgentActionError(
            "workspace_owner_required",
            "Ask the workspace owner to open cancellation, plan-change, or team-seat requests.",
            { status: 403 },
          );
        }
      }

      if (actionName === "source.meta.retest") {
        await context.authorizeExternalEffect?.();
        const result = await retestMetaSourceFromAgent(env, workspaceUserId);
        return {
          resourceType: "source_connection",
          resourceId: "meta",
          result,
          metadata: {
            source: result.source,
            ok: result.ok,
            status: result.connection.status,
            errorCode: result.testResult.errorCode,
          },
        };
      }

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

      if (actionName === "watchlist.update") {
        const result = await updateWatchlistFromAgent(env, workspaceUserId, input);
        return {
          resourceType: "watchlist",
          resourceId: result.watchlist.id,
          result,
          metadata: {
            watchlistId: result.watchlist.id,
            replacedWatchlistId: result.replacedWatchlistId,
          },
        };
      }

      if (actionName === "watchlist.refresh") {
        const result = await refreshWatchlistFromAgent(env, workspaceUserId, context, input);
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
        const result = await setWatchlistActiveFromAgent(env, workspaceUserId, context.userId, input, actionName === "watchlist.resume");
        return {
          resourceType: "watchlist",
          resourceId: result.watchlist.id,
          result,
          metadata: {
            watchlistId: result.watchlist.id,
          },
        };
      }

      if (actionName === "collection.create") {
        const result = await createCollectionFromAgent(env, workspaceUserId, context.userId, input);
        return {
          resourceType: "collection",
          resourceId: result.collection.id,
          result,
          metadata: {
            collectionId: result.collection.id,
          },
        };
      }

      if (actionName === "proof.add_external") {
        const result = await addExternalProofFromAgent(env, workspaceUserId, input);
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

      if (actionName === "delivery_targets.list") {
        const result = await listDeliveryTargetsFromAgent(env, workspaceUserId, input);
        return {
          resourceType: "delivery_target",
          resourceId: result.watchlistId ?? "workspace",
          result,
          metadata: {
            watchlistId: result.watchlistId,
            count: result.targets.length,
          },
        };
      }

      if (actionName === "delivery_settings.update") {
        const result = await updateDeliverySettingsFromAgent(env, workspaceUserId, input);
        return {
          resourceType: "watchlist_delivery_config",
          resourceId: result.config.watchlistId,
          result,
          metadata: {
            watchlistId: result.config.watchlistId,
          },
        };
      }

      if (actionName === "delivery_target.update") {
        const result = await updateDeliveryTargetFromAgent(env, workspaceUserId, input);
        return {
          resourceType: "delivery_target",
          resourceId: result.target.id,
          result,
          metadata: {
            targetId: result.target.id,
            channel: result.target.channel,
            isPaused: result.target.isPaused,
          },
        };
      }

      if (actionName === "web_mentions.list") {
        const result = await listWebMentionsFromAgent(env, workspaceUserId, input);
        return {
          resourceType: "web_mentions",
          resourceId: result.watchlistId ?? "workspace",
          result,
          metadata: {
            watchlistId: result.watchlistId,
            targetCount: result.targets.length,
            observationCount: result.observations.length,
          },
        };
      }

      if (actionName === "report.create") {
        const result = await buildReportFromAgent(env, workspaceUserId, input);
        return {
          resourceType: "report",
          resourceId: result.report.reportId,
          result,
          metadata: {
            reportId: result.report.reportId,
          },
        };
      }

      if (actionName === "counter_move_brief.create") {
        const result = await buildCounterMoveBriefFromAgent(env, workspaceUserId, input);
        return {
          resourceType: "watchlist",
          resourceId: result.brief.watchlistId,
          result,
          metadata: {
            watchlistId: result.brief.watchlistId,
            moveCount: result.brief.moves.length,
            workflowStatus: result.brief.workflow.status,
            followUpOpenCount: result.brief.workflow.openCount,
            followUpChannel: result.brief.workflow.channel,
            followUpExpiresAt: result.brief.workflow.expiresAt,
          },
        };
      }

      if (actionName === "memory.upsert") {
        const result = await upsertMemoryFromAgent(env, workspaceUserId, context, input);
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
        const result = await listMemoryFromAgent(env, workspaceUserId, input);
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

      if (actionName === "client_room.list") {
        const result = await listClientRoomsFromAgent(env, workspaceUserId, input);
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

      if (actionName === "support_case.create") {
        const result = await createSupportCaseFromAgent(
          env,
          workspaceUserId,
          context,
          normalizedSupportInput ?? input,
        );
        return {
          resourceType: "support_case",
          resourceId: result.supportCase.id,
          result,
          auditStatus: result.ok ? "succeeded" as const : "failed" as const,
          errorCode: result.ok ? null : "support_notification_failed",
          errorMessage: result.ok
            ? null
            : "Support case was saved, but the operator notification failed.",
          metadata: {
            supportCaseId: result.supportCase.id,
            category: result.supportCase.category,
            priority: result.supportCase.priority,
          },
        };
      }

      if (actionName === "support_case.list") {
        const result = await listSupportCasesFromAgent(env, context.userId, input);
        return {
          resourceType: "support_case",
          resourceId: result.status ?? "all",
          result,
          metadata: {
            status: result.status ?? "all",
            count: result.cases.length,
          },
        };
      }

      if (actionName === "get_change_history") {
        const { getChangeHistoryFromAgent } = await import("~/lib/customer-agent-actions/change-history.server");
        const history = await getChangeHistoryFromAgent(env, workspaceUserId, input, context.origin ?? null);
        return {
          resourceType: "change_history",
          resourceId: history.domain,
          result: history,
          metadata: {
            domain: history.domain,
            since: history.since,
            offerChangeCount: history.offerChanges.length,
            eventCount: history.events.length,
          },
        };
      }

      if (actionName === "get_offer_state_at") {
        const { getOfferStateAtFromAgent } = await import("~/lib/customer-agent-actions/change-history.server");
        const offerState = await getOfferStateAtFromAgent(env, input, context.origin ?? null);
        return {
          resourceType: "offer_state",
          resourceId: offerState.domain,
          result: offerState,
          metadata: {
            domain: offerState.domain,
            date: offerState.date,
            capturedAt: offerState.state?.capturedAt ?? null,
          },
        };
      }

      if (actionName === "diff_offer") {
        const { diffOfferFromAgent } = await import("~/lib/customer-agent-actions/change-history.server");
        const offerDiff = await diffOfferFromAgent(env, input, context.origin ?? null);
        return {
          resourceType: "offer_diff",
          resourceId: offerDiff.domain,
          result: offerDiff,
          metadata: {
            domain: offerDiff.domain,
            dateA: offerDiff.dateA,
            dateB: offerDiff.dateB,
          },
        };
      }

      if (actionName === "list_suppressed") {
        const { listSuppressedFromAgent } = await import("~/lib/customer-agent-actions/change-history.server");
        const suppressed = await listSuppressedFromAgent(env, workspaceUserId, input, context.origin ?? null);
        return {
          resourceType: "suppressed_events",
          resourceId: suppressed.domain,
          result: suppressed,
          metadata: {
            domain: suppressed.domain,
            count: suppressed.events.length,
          },
        };
      }

      throw new CustomerAgentActionError("unsupported_action", "Unsupported agent action.", { status: 404 });
    } catch (error) {
      if (error instanceof Response) {
        throw await customerErrorFromResponse(error);
      }
      if (error instanceof SupportCaseInputError) {
        throw new CustomerAgentActionError(error.code, error.message, { status: error.status });
      }
      throw error;
    }
  }, {
    replayCompleted: (audit) => replayCustomerAgentAction(env, context, actionName, audit),
    retryFailed: actionName === "support_case.create",
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

async function retestMetaSourceFromAgent(env: AppEnv, userId: string) {
  const { retestSavedCustomerMetaToken } = await import("~/lib/customer-meta.server");
  const retest = await retestSavedCustomerMetaToken(env, userId);
  if (!retest.connection) {
    throw new CustomerAgentActionError(
      "source_connection_missing",
      "No Meta source connection is saved for this workspace.",
      {
        status: 404,
        details: {
          source: "meta_ad_library",
        },
      },
    );
  }

  return {
    ok: retest.ok,
    action: "source.meta.retest",
    source: "meta_ad_library",
    connection: {
      status: retest.connection.status,
      summary: retest.connection.summary,
      lastCheckedAt: retest.connection.lastCheckedAt,
      lastErrorCode: retest.connection.lastErrorCode,
      updatedAt: retest.connection.updatedAt,
    },
    testResult: {
      ok: retest.testResult.ok,
      status: retest.testResult.status,
      summary: retest.testResult.summary,
      errorCode: retest.testResult.errorCode,
    },
    message: retest.testResult.summary,
  };
}

async function createWatchlistFromAgent(
  env: AppEnv,
  context: CustomerAgentActionContext,
  input: Record<string, unknown>,
) {
  const { checkPlanLimit } = await import("~/lib/plan.server");
  const {
    createWatchlistWithinLimit,
    deleteUnscannedWatchlistCreatedByFailedAgentAction,
  } = await import("~/lib/data.server");
  const { queueFirstWatchlistScan } = await import("~/lib/monitoring.server");
  const { resolveWorkspaceDataUserId } = await import("~/lib/workspace.server");

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

  const workspaceUserId = await resolveWorkspaceDataUserId(env, context.userId);

  const { requireVerifiedEmailForRetention } = await import("~/lib/email-verification.server");
  const verification = await requireVerifiedEmailForRetention(env, workspaceUserId);
  if (!verification.ok) {
    throw new CustomerAgentActionError("email_unverified", verification.message, {
      status: 403,
    });
  }

  const limit = await checkPlanLimit(env, workspaceUserId, "watchlists");

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
  const shouldQueueFirstScan = readBoolean(input, "queueFirstScan", true);
  if (shouldQueueFirstScan) {
    await context.authorizeExternalEffect?.();
  }
  const result = await createWatchlistWithinLimit(env, workspaceUserId, {
    name,
    targetType: "advertiser",
    targetId: competitorWebsite.normalizedUrl ?? normalizedQuery.filters.query,
    targetFingerprint: watchlistFingerprint(normalizedQuery, competitorWebsite),
    targetLabel: competitorTrackingLabel(competitorWebsite, normalizedQuery.filters.query),
    targetCountry: normalizedQuery.filters.country,
    trackingRole,
  }, limit.limit);

  if (result.status === "over_cap") {
    throw new CustomerAgentActionError("plan_limit_exceeded", "You've reached your competitor tracking limit.", {
      status: 402,
      details: {
        limit: result.limit,
        current: result.current,
      },
    });
  }

  const watchlist = result.watchlist;

  if (!watchlist) {
    throw new CustomerAgentActionError("watchlist_create_failed", "Could not create this watchlist.", {
      status: 500,
    });
  }

  if (shouldQueueFirstScan) {
    try {
      await context.authorizeExternalEffect?.();
    } catch (error) {
      if (result.status === "created") {
        try {
          await deleteUnscannedWatchlistCreatedByFailedAgentAction(env, workspaceUserId, watchlist.id);
        } catch {
          throw new CustomerAgentActionError(
            "watchlist_create_recovery_failed",
            "The API-key check failed after saving the competitor, and automatic recovery could not be confirmed. Contact support before retrying.",
            { status: 503 },
          );
        }
      }
      throw error;
    }
  }
  const firstScanQueued = shouldQueueFirstScan
    ? await queueFirstWatchlistScan(env, context.executionContext ?? undefined, watchlist)
    : false;

  return {
    ok: true,
    action: "watchlist.create",
    watchlist,
    firstScanQueued,
    reversal: actionReversal(
      "watchlist.pause",
      { watchlistId: watchlist.id },
      "Pause this watchlist to stop future scans and alerts. History and audit records stay intact.",
    ),
  };
}

async function updateWatchlistFromAgent(
  env: AppEnv,
  userId: string,
  input: Record<string, unknown>,
) {
  const { getWatchlist, updateWatchlist } = await import("~/lib/data.server");
  const watchlistId = requireString(input, "watchlistId");
  const watchlist = await getWatchlist(env, watchlistId, userId);
  if (!watchlist || !watchlist.isActive) {
    throw new CustomerAgentActionError("watchlist_not_found", "Watchlist not found.", { status: 404 });
  }

  const name = readString(input, "name") ?? watchlist.name;
  const trackingRole = normalizeWatchlistTrackingRole(readString(input, "trackingRole") ?? watchlist.trackingRole);
  const targetLabelInput = readString(input, "targetLabel") ?? readString(input, "query");
  const hasCompetitorWebsiteInput = Object.prototype.hasOwnProperty.call(input, "competitorWebsite");
  const previousCompetitorWebsite = normalizeCompetitorWebsiteInput(
    isHttpCompetitorWebsite(watchlist.targetId) ? watchlist.targetId : "",
  );
  const competitorWebsiteInput = input.competitorWebsite;
  if (hasCompetitorWebsiteInput && typeof competitorWebsiteInput !== "string") {
    throw new CustomerAgentActionError(
      "invalid_competitor_website",
      "competitorWebsite must be a website string when provided.",
    );
  }
  const competitorWebsite = hasCompetitorWebsiteInput
    ? normalizeCompetitorWebsiteInput(competitorWebsiteInput as string)
    : previousCompetitorWebsite;

  if (hasInvalidCompetitorWebsite(competitorWebsite)) {
    throw new CustomerAgentActionError("invalid_competitor_website", competitorWebsite.error ?? "Invalid website.");
  }

  const websiteChanged =
    (competitorWebsite.normalizedUrl ?? null) !== (previousCompetitorWebsite.normalizedUrl ?? null);
  const targetLabel =
    targetLabelInput ??
    (hasCompetitorWebsiteInput && websiteChanged
      ? competitorWebsite.searchTerm ?? competitorWebsite.displayName ?? null
      : null) ??
    watchlist.targetLabel;
  const hasTargetCountryInput =
    Object.prototype.hasOwnProperty.call(input, "targetCountry") ||
    Object.prototype.hasOwnProperty.call(input, "country");
  const targetCountryInput = readString(input, "targetCountry") ?? readString(input, "country");
  const countryForQuery = hasTargetCountryInput
    ? targetCountryInput ?? "all"
    : watchlist.targetCountry ?? "India";
  const countryForStorage = hasTargetCountryInput ? countryForQuery : watchlist.targetCountry;
  const normalizedQuery = applyWebsiteSearchFallback(
    normalizeSavedQuery("advertiser", {
      query: targetLabel,
      country: countryForQuery,
    }),
    competitorWebsite,
  );
  const targetFieldsChanged = hasCompetitorWebsiteInput || Boolean(targetLabelInput) || hasTargetCountryInput;
  const nextTarget =
    watchlist.targetType === "saved_query"
      ? {
          targetType: watchlist.targetType,
          targetId: watchlist.targetId,
          targetFingerprint: watchlist.targetFingerprint,
          targetLabel: watchlist.targetLabel,
          targetCountry: watchlist.targetCountry,
          trackingRole,
        }
      : {
          targetType: "advertiser" as const,
          targetId: targetFieldsChanged
            ? competitorWebsite.normalizedUrl ?? normalizedQuery.filters.query
            : watchlist.targetId,
          targetFingerprint: targetFieldsChanged
            ? watchlistFingerprint(normalizedQuery, competitorWebsite)
            : watchlist.targetFingerprint,
          targetLabel: targetFieldsChanged
            ? competitorTrackingLabel(competitorWebsite, normalizedQuery.filters.query)
            : watchlist.targetLabel,
          targetCountry: countryForStorage,
          trackingRole,
        };

  try {
    const updated = await updateWatchlist(env, userId, watchlist.id, {
      name,
      ...nextTarget,
    });
    if (!updated) {
      throw new CustomerAgentActionError("watchlist_update_failed", "Could not update this watchlist.", {
        status: 500,
      });
    }

    return {
      ok: true,
      action: "watchlist.update",
      watchlist: updated,
      replacedWatchlistId: updated.id !== watchlist.id ? watchlist.id : null,
      message: updated.id !== watchlist.id
        ? "Watchlist retargeted. Delivery settings moved to the replacement watchlist."
        : "Watchlist updated.",
    };
  } catch (error) {
    if (error instanceof Error && error.message === "watchlist_duplicate_target") {
      throw new CustomerAgentActionError(
        "watchlist_duplicate_target",
        "Another active watchlist already tracks that target.",
        { status: 409 },
      );
    }
    throw error;
  }
}

async function createCollectionFromAgent(
  env: AppEnv,
  workspaceUserId: string,
  actorUserId: string,
  input: Record<string, unknown>,
) {
  const { checkPlanLimit } = await import("~/lib/plan.server");
  const { createCollectionWithinLimit } = await import("~/lib/data.server");
  const name = requireString(input, "name");
  const limit = await checkPlanLimit(env, workspaceUserId, "collections");
  if (!limit.allowed) {
    throw new CustomerAgentActionError("plan_limit_exceeded", "You've reached your workspace collection limit.", {
      status: 402,
      details: {
        limit: limit.limit,
        current: limit.current,
      },
    });
  }

  const collectionResult = await createCollectionWithinLimit(env, workspaceUserId, {
    name,
    description: readString(input, "description"),
  }, limit.limit);
  if (collectionResult.status === "over_cap") {
    throw new CustomerAgentActionError(
      "plan_limit_exceeded",
      "You've reached your workspace collection limit.",
      {
        status: 402,
        details: {
          limit: collectionResult.limit,
          current: collectionResult.current,
        },
      },
    );
  }

  const collection = collectionResult.collection;
  if (!collection) {
    throw new CustomerAgentActionError("collection_create_failed", "Could not create this collection.", {
      status: 500,
    });
  }

  return {
    ok: true,
    action: "collection.create",
    collection,
    message: `Created ${collection.name}.`,
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
    message: `Saved ${ad.platforms[0] ?? "external"} evidence for ${ad.advertiser}.`,
  };
}

async function prepareAtomicShareAction(
  env: AppEnv,
  context: CustomerAgentActionContext,
  workspaceUserId: string,
  actionName: "share.create" | "report.share",
  input: Record<string, unknown>,
  auditId: string,
  requestFingerprint: string,
  db: D1Database,
) {
  const shareId = createId();
  const token = crypto.randomUUID().replaceAll("-", "");
  const createdAt = nowIso();
  const expiresAt = new Date(
    Date.now() + SHARE_LINK_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  if (actionName === "share.create") {
    const resourceType = readShareResourceType(input);
    if (resourceType === "report") {
      throw new CustomerAgentActionError(
        "unsupported_share_resource",
        "Use report.share to create a report snapshot link.",
      );
    }
    const resourceId = requireString(input, "resourceId");
    await assertShareResourceOwned(env, workspaceUserId, resourceType, resourceId);
    const result = {
      ok: true,
      action: "share.create",
      resourceType,
      resourceId,
      share: { id: shareId, token, expiresAt },
      shareUrl: shareUrl(context, token),
    };
    return {
      statement: prepareAtomicShareLinkInsert(db, {
        auditId,
        auditUserId: context.userId,
        apiKeyId: context.apiKeyId,
        userId: workspaceUserId,
        actionName,
        idempotencyKey: context.idempotencyKey?.trim() ?? "",
        requestFingerprint,
        resourceType,
        resourceId,
        ownerResourceType: resourceType,
        isSnapshot: false,
        shareId,
        token,
        createdAt,
        expiresAt,
      }),
      resourceType,
      resourceId,
      result,
    };
  }

  const { report, memoryContext } = await loadReportDocumentForAgent(env, workspaceUserId, input);
  const parsedReport = parseReportId(report.reportId);
  if (!parsedReport) {
    throw new CustomerAgentActionError(
      "invalid_report_id",
      "reports must use a collection or watchlist report id.",
    );
  }
  const snapshotPayload = createApprovedReportSnapshot(
    sanitizeAgentReportShareSnapshot(report),
  );
  if (!snapshotPayload) {
    throw new CustomerAgentActionError(
      "evidence_not_ready",
      "Current report evidence must be saved and verified before sharing.",
    );
  }
  const result = {
    ok: true,
    action: "report.share",
    report,
    memoryContext,
    share: { id: shareId, token, expiresAt },
    shareUrl: shareUrl(context, token),
  };
  return {
    statement: prepareAtomicShareLinkInsert(db, {
      auditId,
      auditUserId: context.userId,
      apiKeyId: context.apiKeyId,
      userId: workspaceUserId,
      actionName,
      idempotencyKey: context.idempotencyKey?.trim() ?? "",
      requestFingerprint,
      resourceType: "report",
      resourceId: report.reportId,
      ownerResourceType: parsedReport.resourceType,
      isSnapshot: true,
      snapshotPayload: snapshotPayload as unknown as Record<string, unknown>,
      shareId,
      token,
      createdAt,
      expiresAt,
    }),
    resourceType: "report",
    resourceId: report.reportId,
    result,
  };
}

async function prepareAtomicClientRoomAction(
  env: AppEnv,
  context: CustomerAgentActionContext,
  workspaceUserId: string,
  input: Record<string, unknown>,
  auditId: string,
  requestFingerprint: string,
  db: D1Database,
) {
  const { getClientRoom, getClientRoomByName } = await import("~/lib/data.server");
  const resourceRefs = readClientRoomResourceRefs(input);
  const hasNotes = Object.prototype.hasOwnProperty.call(input, "notes");
  const notes = hasNotes ? readClientRoomNotes(input) : null;
  const requestedRoomId = readString(input, "roomId");
  const name = readClientRoomDisplayName(input, "name", "Client room name");
  const existing = requestedRoomId
    ? await getClientRoom(env, workspaceUserId, requestedRoomId)
    : await getClientRoomByName(env, workspaceUserId, name);
  if (requestedRoomId && !existing) {
    throw new CustomerAgentActionError("client_room_not_found", "Client room not found.", { status: 404 });
  }
  const expectedUpdatedAt = readString(input, "expectedUpdatedAt");
  if (requestedRoomId && !expectedUpdatedAt) {
    throw new CustomerAgentActionError(
      "missing_expected_updated_at",
      "Reload this client room and include its expectedUpdatedAt value before updating it.",
      { status: 409 },
    );
  }
  if (requestedRoomId && existing && expectedUpdatedAt !== existing.updatedAt) {
    throw new CustomerAgentActionError(
      "stale_write",
      "This client room changed since it was read. Reload it and retry with a new idempotency key.",
      { status: 409 },
    );
  }

  const roomId = requestedRoomId ?? existing?.id ?? createId();
  const status = readClientRoomStatus(input);
  const clientLabel = readOptionalClientRoomDisplayName(input, "clientLabel", "Client label");
  const finalRefs = resourceRefs ?? existing?.resourceRefs ?? [];
  await assertClientRoomResourceRefsOwned(env, workspaceUserId, finalRefs);
  await assertClientRoomReportRefsReady(env, workspaceUserId, finalRefs);
  const refsChanged = typeof resourceRefs !== "undefined" && !sameClientRoomResourceRefs(
    existing?.resourceRefs ?? [],
    finalRefs,
  );
  const retainedNotes = hasNotes
    ? preserveClientRoomReportApprovals(notes ?? {}, existing?.notes ?? {})
    : existing?.notes ?? {};
  const finalNotes = refsChanged ? withoutClientRoomReportApprovals(retainedNotes) : retainedNotes;
  const timestamp = strictlyNewerClientRoomTimestamp(existing?.updatedAt, nowIso());
  const prepared = prepareAtomicClientRoomUpsert(db, {
    auditId,
    auditUserId: context.userId,
    userId: workspaceUserId,
    idempotencyKey: context.idempotencyKey?.trim() ?? "",
    requestFingerprint,
    roomId,
    name,
    clientLabel,
    status,
    notesJson: JSON.stringify(finalNotes),
    hasNotes,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    expectedUpdatedAt,
    invalidateApprovals: refsChanged,
    isUpdate: Boolean(existing),
    resourceRefs: typeof resourceRefs === "undefined"
      ? null
      : resourceRefs.map((ref) => {
          if (ref.resourceType === "report") {
            const parsedReport = parseReportId(ref.resourceId);
            if (!parsedReport) {
              throw new CustomerAgentActionError(
                "invalid_report_id",
                "report resources must use a report id such as collection:<id> or watchlist:<id>.",
              );
            }
            return {
              resourceType: ref.resourceType,
              resourceId: ref.resourceId,
              label: ref.label,
              ownerResourceType: parsedReport.resourceType,
              ownerResourceId: parsedReport.resourceId,
            };
          }
          return {
            resourceType: ref.resourceType,
            resourceId: ref.resourceId,
            label: ref.label,
            ownerResourceType: ref.resourceType,
            ownerResourceId: ref.resourceId,
          };
        }),
  });
  const result = {
    ok: true,
    action: "client_room.upsert",
    room: safeClientRoomRecord({
      id: roomId,
      userId: workspaceUserId,
      name,
      clientLabel,
      status,
      resourceRefs: finalRefs,
      notes: finalNotes,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }),
  };

  return {
    statement: prepared.statements,
    effectExpectations: prepared.effectExpectations,
    classifyBatchFailure: expectedUpdatedAt
      ? async () => {
          const current = await getClientRoom(env, workspaceUserId, roomId);
          return current?.updatedAt === expectedUpdatedAt ? null : "stale_write" as const;
        }
      : undefined,
    resourceType: "client_room",
    resourceId: roomId,
    result,
  };
}

async function buildReportFromAgent(
  env: AppEnv,
  userId: string,
  input: Record<string, unknown>,
) {
  const { report, memoryContext } = await loadReportDocumentForAgent(env, userId, input);
  return {
    ok: true,
    action: "report.create",
    report,
    memoryContext,
  };
}

function sanitizeAgentReportShareSnapshot<T extends { reportId: string; resourceId: string }>(report: T) {
  return JSON.parse(JSON.stringify({
    ...report,
    reportId: "shared-report",
    resourceId: "shared",
  })) as T;
}

async function loadReportDocumentForAgent(
  env: AppEnv,
  userId: string,
  input: Record<string, unknown>,
) {
  const {
    getCollection,
		getLatestDigestRunSummaryForWatchlist,
    getWatchlist,
    listAdsByIds,
    listCollectionItems,
    listProofCapturePairsForEventIds,
    listWatchEvents,
  } = await import("~/lib/data.server");
  const parsedReport = parseReportId(readString(input, "reportId") ?? "");
  const resourceType = parsedReport?.resourceType ?? readReportResourceType(input);
  const resourceId = parsedReport?.resourceId ?? requireString(input, "resourceId");
  const report = await loadOwnedReportDocument(
    env,
    userId,
    createReportId(resourceType, resourceId),
    {
      getCollection,
      getLatestDigestRunSummaryForWatchlist,
      getWatchlist,
      listAdsByIds,
      listCollectionItems,
      listProofCapturePairsForEventIds,
      listWatchEvents,
    },
    {
      parallelWatchlistLookups: true,
      requireActiveWatchlist: true,
    },
  );
  if (!report) {
    if (resourceType === "collection") {
      throw new CustomerAgentActionError("collection_not_found", "Board not found.", { status: 404 });
    }
    throw new CustomerAgentActionError("watchlist_not_found", "Watchlist not found.", { status: 404 });
  }
  return {
    ok: true,
    report,
    memoryContext: await loadMemoryContextForAgent(
      env,
      userId,
      report.resourceType === "watchlist" ? { watchlistId: report.resourceId } : undefined,
    ),
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
  const events = (await listWatchEvents(env, watchlist.id, Math.max(1, Math.min(60, limit * 3))))
    .filter(isProofBackedWatchEvent);
  const linkedAdIds = events
    .map((event) => event.adId)
    .filter((adId): adId is string => Boolean(adId));
  const ads = linkedAdIds.length > 0 ? await listAdsByIds(env, linkedAdIds) : [];
  const workflow = readCounterMoveWorkflow(input);
  const brief = buildCounterMoveBrief({
    watchlist,
    events,
    adsById: new Map(ads.map((ad) => [ad.metaAdId, ad])),
    limit,
    timeZone: readString(input, "timeZone"),
    workflow,
  });

  return {
    ok: true,
    action: "counter_move_brief.create",
    brief,
    memoryContext: await loadMemoryContextForAgent(env, userId, { watchlistId: watchlist.id }),
  };
}

async function upsertMemoryFromAgent(
  env: AppEnv,
  workspaceUserId: string,
  context: CustomerAgentActionContext,
  input: Record<string, unknown>,
) {
  const { upsertAgentMemory } = await import("~/lib/data.server");
  const watchlistId = readString(input, "watchlistId");
  const clientRoomId = readString(input, "clientRoomId");
  await assertMemoryScopeOwned(env, workspaceUserId, { watchlistId, clientRoomId });
  const memory = await upsertAgentMemory(env, workspaceUserId, {
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

async function loadMemoryContextForAgent(
  env: AppEnv,
  userId: string,
  options: { watchlistId?: string | null; clientRoomId?: string | null } = {},
) {
  const { listAgentMemory } = await import("~/lib/data.server");
  const [workspaceMemories, scopedMemories] = await Promise.all([
    listAgentMemory(env, userId, {
      watchlistId: null,
      clientRoomId: null,
      limit: 5,
    }),
    options.watchlistId || options.clientRoomId
      ? listAgentMemory(env, userId, {
          ...(options.watchlistId ? { watchlistId: options.watchlistId } : {}),
          ...(options.clientRoomId ? { clientRoomId: options.clientRoomId } : {}),
          limit: 5,
        })
      : Promise.resolve([]),
  ]);

  return Array.from(
    new Map([...workspaceMemories, ...scopedMemories].map((memory) => [memory.id, safeMemoryRecord(memory)])).values(),
  );
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
    rooms: rooms.map(safeClientRoomRecord),
  };
}

async function listDeliveryTargetsFromAgent(
  env: AppEnv,
  userId: string,
  input: Record<string, unknown>,
) {
  const { getWatchlist, listDeliveryTargets } = await import("~/lib/data.server");
  const watchlistId = readString(input, "watchlistId");
  if (watchlistId) {
    const watchlist = await getWatchlist(env, watchlistId, userId);
    if (!watchlist) {
      throw new CustomerAgentActionError("watchlist_not_found", "Watchlist not found.", { status: 404 });
    }
  }

  const channel = readDeliveryChannel(input);
  const limit = clampListLimit(readInteger(input, "limit", 50));
  const targets = channel
    ? await listDeliveryTargets(env, userId, {
        ...(watchlistId ? { watchlistId } : {}),
        channel,
        limit,
      })
    : sortDeliveryTargetsByUpdatedAtDesc((await Promise.all(
        customerFacingDeliveryChannels().map((visibleChannel) =>
          listDeliveryTargets(env, userId, {
            ...(watchlistId ? { watchlistId } : {}),
            channel: visibleChannel,
            limit,
          }),
        ),
      )).flat()).slice(0, limit);
  const visibleTargets = targets.filter((target) => isCustomerFacingDeliveryChannel(target.channel));

  return {
    ok: true,
    action: "delivery_targets.list",
    watchlistId,
    targets: visibleTargets.map(safeDeliveryTargetRecord),
  };
}

async function updateDeliverySettingsFromAgent(
  env: AppEnv,
  userId: string,
  input: Record<string, unknown>,
) {
  requireExplicitApproval(input);
  rejectDormantDeliveryActionInput(input);
  const {
    getWatchlist,
    getWatchlistDeliveryConfig,
    getWorkspaceDeliveryConfig,
    upsertWatchlistDeliveryConfig,
  } = await import("~/lib/data.server");
  const watchlistId = requireString(input, "watchlistId");
  const watchlist = await getWatchlist(env, watchlistId, userId);
  if (!watchlist) {
    throw new CustomerAgentActionError("watchlist_not_found", "Watchlist not found.", { status: 404 });
  }

  const workspaceConfig = await getWorkspaceDeliveryConfig(env, userId);
  const existingConfig = await getWatchlistDeliveryConfig(env, watchlist.id);
  const base = existingConfig ?? {
    sensitivityMode: workspaceConfig?.sensitivityMode ?? "balanced",
    instantEnabled: workspaceConfig?.instantEnabled ?? false,
    digestEnabled: workspaceConfig?.digestEnabled ?? true,
    emailEnabled: workspaceConfig?.emailEnabled ?? true,
    whatsappEnabled: workspaceConfig?.whatsappEnabled ?? false,
    slackEnabled: workspaceConfig?.slackEnabled ?? false,
    teamsEnabled: workspaceConfig?.teamsEnabled ?? false,
    quietHours: workspaceConfig?.quietHours ?? null,
    timezone: workspaceConfig?.timezone ?? null,
  };
  const timezoneInputProvided = Object.prototype.hasOwnProperty.call(input, "timezone");
  const requestedTimezone = readNullableString(input, "timezone", base.timezone);
  const normalizedTimezone = normalizeTimeZone(requestedTimezone);
  if (timezoneInputProvided && requestedTimezone !== null && !normalizedTimezone) {
    throw new CustomerAgentActionError(
      "invalid_timezone",
      "timezone must be a valid IANA timezone such as Asia/Kolkata or UTC.",
    );
  }

  const config = await upsertWatchlistDeliveryConfig(env, {
    watchlistId: watchlist.id,
    userId,
    sensitivityMode: readSensitivityMode(input) ?? base.sensitivityMode,
    instantEnabled: readOptionalBoolean(input, "instantEnabled") ?? base.instantEnabled,
    digestEnabled: readOptionalBoolean(input, "digestEnabled") ?? base.digestEnabled,
    emailEnabled: readOptionalBoolean(input, "emailEnabled") ?? base.emailEnabled,
    whatsappEnabled: isWhatsAppDeliveryCustomerFacing()
      ? readOptionalBoolean(input, "whatsappEnabled") ?? base.whatsappEnabled
      : base.whatsappEnabled,
    slackEnabled: isSlackWebhookDeliveryCustomerFacing()
      ? readOptionalBoolean(input, "slackEnabled") ?? base.slackEnabled
      : base.slackEnabled,
    teamsEnabled: isTeamsWebhookDeliveryCustomerFacing()
      ? readOptionalBoolean(input, "teamsEnabled") ?? base.teamsEnabled
      : base.teamsEnabled,
    quietHours: readQuietHours(input, "quietHours", base.quietHours),
    timezone: requestedTimezone === null ? null : normalizedTimezone ?? safeTimeZone(base.timezone),
  });

  if (!config) {
    throw new CustomerAgentActionError(
      "delivery_settings_update_failed",
      "Could not update delivery settings.",
      { status: 500 },
    );
  }

  const reversalInput: Record<string, unknown> = {
    watchlistId: watchlist.id,
    explicitApproval: true,
    sensitivityMode: base.sensitivityMode,
    instantEnabled: base.instantEnabled,
    digestEnabled: base.digestEnabled,
    emailEnabled: base.emailEnabled,
    quietHours: base.quietHours,
    timezone: base.timezone,
  };
  if (isWhatsAppDeliveryCustomerFacing()) {
    reversalInput.whatsappEnabled = base.whatsappEnabled;
  }
  if (isSlackWebhookDeliveryCustomerFacing()) {
    reversalInput.slackEnabled = base.slackEnabled;
  }
  if (isTeamsWebhookDeliveryCustomerFacing()) {
    reversalInput.teamsEnabled = base.teamsEnabled;
  }

  return {
    ok: true,
    action: "delivery_settings.update",
    config: safeWatchlistDeliveryConfigRecord(config),
    reversal: actionReversal(
      "delivery_settings.update",
      reversalInput,
      "Restore the previous delivery policy with explicit approval and a fresh idempotency key.",
      { requiresExplicitApproval: true },
    ),
    message: "Delivery settings updated.",
  };
}

async function updateDeliveryTargetFromAgent(
  env: AppEnv,
  userId: string,
  input: Record<string, unknown>,
) {
  requireExplicitApproval(input);
  const { getDeliveryTargetById, upsertDeliveryTarget } = await import("~/lib/data.server");
  const targetId = requireString(input, "targetId");
  const existing = await getDeliveryTargetById(env, {
    userId,
    targetId,
  });
  if (!existing) {
    throw new CustomerAgentActionError("delivery_target_not_found", "Delivery target not found.", { status: 404 });
  }
  if (!isSlackWebhookDeliveryCustomerFacing() && existing.channel === "slack") {
    throw new CustomerAgentActionError("slack_delivery_unavailable", slackDeliveryUnavailableMessage(), {
      status: 403,
    });
  }
  if (!isTeamsWebhookDeliveryCustomerFacing() && existing.channel === "teams") {
    throw new CustomerAgentActionError(
      "teams_delivery_unavailable",
      "Teams delivery isn’t available. Nothing was saved — use email delivery instead.",
      {
        status: 403,
      },
    );
  }
  if (!isWhatsAppDeliveryCustomerFacing() && existing.channel === "whatsapp") {
    throw new CustomerAgentActionError("whatsapp_delivery_unavailable", whatsappDeliveryUnavailableMessage(), {
      status: 403,
    });
  }

  const isPaused = readOptionalBoolean(input, "isPaused");
  if (typeof isPaused === "undefined") {
    throw new CustomerAgentActionError("missing_field", "isPaused is required.");
  }

  if (existing.isPaused === isPaused) {
    return {
      ok: true,
      action: "delivery_target.update",
      target: safeDeliveryTargetRecord(existing),
      message: isPaused
        ? "Delivery target was already paused. No change was made."
        : "Delivery target was already active. No change was made.",
    };
  }

  await upsertDeliveryTarget(env, {
    userId,
    watchlistId: existing.watchlistId,
    channel: existing.channel,
    targetValue: existing.targetValue,
    validationStatus: existing.validationStatus,
    isValidated: existing.isValidated,
    isOptedIn: existing.isOptedIn,
    optInSource: existing.optInSource,
    optedInAt: existing.optedInAt,
    isPaused,
    pausedAt: isPaused ? new Date().toISOString() : null,
    optedOutAt: existing.optedOutAt,
    templateEligible: existing.templateEligible,
    lastSuccessfulDeliveryAt: existing.lastSuccessfulDeliveryAt,
    lastSuccessfulAttemptId: existing.lastSuccessfulAttemptId,
    providerIdentifier: existing.providerIdentifier,
    metadata: existing.metadata,
  });
  const updated = await getDeliveryTargetById(env, {
    userId,
    targetId,
  });

  return {
    ok: true,
    action: "delivery_target.update",
    target: safeDeliveryTargetRecord(updated ?? existing),
    reversal: actionReversal(
      "delivery_target.update",
      {
        targetId,
        isPaused: existing.isPaused,
        explicitApproval: true,
      },
      existing.isPaused
        ? "Return this delivery target to paused with explicit approval and a fresh idempotency key."
        : "Return this delivery target to active with explicit approval and a fresh idempotency key.",
      { requiresExplicitApproval: true },
    ),
    message: isPaused ? "Delivery target paused." : "Delivery target resumed.",
  };
}

function rejectDormantDeliveryActionInput(input: Record<string, unknown>) {
  if (!isSlackWebhookDeliveryCustomerFacing() &&
    (readOptionalBoolean(input, "slackEnabled") === true || readString(input, "channel") === "slack")) {
    throw new CustomerAgentActionError("slack_delivery_unavailable", slackDeliveryUnavailableMessage(), {
      status: 403,
    });
  }
  if (!isTeamsWebhookDeliveryCustomerFacing() &&
    (readOptionalBoolean(input, "teamsEnabled") === true || readString(input, "channel") === "teams")) {
    throw new CustomerAgentActionError(
      "teams_delivery_unavailable",
      "Teams delivery isn’t available. Nothing was saved — use email delivery instead.",
      {
        status: 403,
      },
    );
  }
  if (!isWhatsAppDeliveryCustomerFacing() &&
    (readOptionalBoolean(input, "whatsappEnabled") === true || readString(input, "channel") === "whatsapp")) {
    throw new CustomerAgentActionError("whatsapp_delivery_unavailable", whatsappDeliveryUnavailableMessage(), {
      status: 403,
    });
  }
}

async function refreshWatchlistFromAgent(
  env: AppEnv,
  workspaceUserId: string,
  context: CustomerAgentActionContext,
  input: Record<string, unknown>,
) {
  const { CommercialDiscoveryError } = await import("~/lib/ad-source.server");
  const { getWatchlist } = await import("~/lib/data.server");
  const { runWatchlistManual } = await import("~/lib/monitoring.server");
  const { getUserPlan } = await import("~/lib/plan.server");
  const watchlistId = requireString(input, "watchlistId");
  const watchlist = await getWatchlist(env, watchlistId, workspaceUserId);

  if (!watchlist || !watchlist.isActive) {
    throw new CustomerAgentActionError("watchlist_not_found", "Watchlist not found.", { status: 404 });
  }

  const plan = await getUserPlan(env, workspaceUserId);
  if (plan === "free") {
    throw new CustomerAgentActionError(
      "plan_limit_exceeded",
      "Fresh checks are included in paid plans - upgrade to refresh this watchlist.",
      { status: 402 },
    );
  }

  try {
    await context.authorizeExternalEffect?.();
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
  workspaceUserId: string,
  actorUserId: string,
  input: Record<string, unknown>,
  isActive: boolean,
) {
  const { checkPlanLimit } = await import("~/lib/plan.server");
  const { getWatchlist, setWatchlistActive } = await import("~/lib/data.server");
  const watchlistId = requireString(input, "watchlistId");
  const watchlist = await getWatchlist(env, watchlistId, workspaceUserId);

  if (!watchlist) {
    throw new CustomerAgentActionError("watchlist_not_found", "Watchlist not found.", { status: 404 });
  }

  if (isActive && !watchlist.isActive) {
    const limit = await checkPlanLimit(env, workspaceUserId, "watchlists");
    if (!limit.allowed) {
      throw new CustomerAgentActionError(
        "plan_limit_exceeded",
        "You've reached your competitor tracking limit - pause another watchlist first.",
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

  const changedState = watchlist.isActive !== isActive;
  if (changedState) {
    const changed = await setWatchlistActive(env, workspaceUserId, watchlist.id, isActive);
    if (!changed) {
      throw new CustomerAgentActionError("watchlist_update_failed", "Could not update this watchlist.", {
        status: 500,
      });
    }
  }

  return {
    ok: true,
    action: isActive ? "watchlist.resume" : "watchlist.pause",
    watchlist: {
      ...watchlist,
      isActive,
    },
    ...(changedState
      ? {
          reversal: actionReversal(
            watchlist.isActive ? "watchlist.resume" : "watchlist.pause",
            { watchlistId: watchlist.id },
            watchlist.isActive
              ? "Resume this watchlist to restore the active state it had before this action."
              : "Pause this watchlist again to restore the inactive state it had before this action.",
          ),
        }
      : {}),
    message: changedState
      ? isActive
        ? "Watchlist resumed. It rejoins the next scheduled scan."
        : "Watchlist paused. Scans and alerts stop, the history stays, and the plan slot is free."
      : isActive
        ? "Watchlist was already active. No change was made."
        : "Watchlist was already paused. No change was made.",
  };
}

function readSensitivityMode(input: Record<string, unknown>): SensitivityMode | null {
  const value = readString(input, "sensitivityMode");
  if (!value) {
    return null;
  }
  if (value === "quiet" || value === "balanced" || value === "aggressive" || value === "auto") {
    return value;
  }
  throw new CustomerAgentActionError(
    "invalid_sensitivity_mode",
    "sensitivityMode must be quiet, balanced, aggressive, or auto.",
  );
}

function readDeliveryChannel(input: Record<string, unknown>): DeliveryChannel | null {
  const value = readString(input, "channel");
  if (!value) {
    return null;
  }
  if (value === "email") {
    return value;
  }
  if (value === "whatsapp") {
    if (!isWhatsAppDeliveryCustomerFacing()) {
      throw new CustomerAgentActionError("whatsapp_delivery_unavailable", whatsappDeliveryUnavailableMessage(), {
        status: 403,
      });
    }
    return value;
  }
  if (value === "slack") {
    if (!isSlackWebhookDeliveryCustomerFacing()) {
      throw new CustomerAgentActionError("slack_delivery_unavailable", slackDeliveryUnavailableMessage(), {
        status: 403,
      });
    }
    return value;
  }
  if (value === "teams") {
    if (!isTeamsWebhookDeliveryCustomerFacing()) {
      throw new CustomerAgentActionError(
        "teams_delivery_unavailable",
        "Teams delivery isn’t available. Nothing was saved — use email delivery instead.",
        {
          status: 403,
        },
      );
    }
    return value;
  }
  throw new CustomerAgentActionError("invalid_delivery_channel", "channel must be email.");
}

function isCustomerFacingDeliveryChannel(channel: DeliveryChannel) {
  return (
    channel === "email" ||
    (channel === "whatsapp" && isWhatsAppDeliveryCustomerFacing()) ||
    (channel === "slack" && isSlackWebhookDeliveryCustomerFacing()) ||
    (channel === "teams" && isTeamsWebhookDeliveryCustomerFacing())
  );
}

function customerFacingDeliveryChannels(): DeliveryChannel[] {
  const channels: DeliveryChannel[] = ["email"];
  if (isWhatsAppDeliveryCustomerFacing()) {
    channels.push("whatsapp");
  }
  if (isSlackWebhookDeliveryCustomerFacing()) {
    channels.push("slack");
  }
  if (isTeamsWebhookDeliveryCustomerFacing()) {
    channels.push("teams");
  }
  return channels;
}

function sortDeliveryTargetsByUpdatedAtDesc(targets: DeliveryTargetRecord[]) {
  return [...targets].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function readNullableString(input: Record<string, unknown>, field: string, fallback: string | null) {
  if (!Object.prototype.hasOwnProperty.call(input, field)) {
    return fallback;
  }
  const value = input[field];
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value.trim() || null;
  }
  throw new CustomerAgentActionError("invalid_field", `${field} must be a string or null.`);
}

function readQuietHours(
  input: Record<string, unknown>,
  field: string,
  fallback: DeliveryQuietHours | null,
): DeliveryQuietHours | null {
  if (!Object.prototype.hasOwnProperty.call(input, field)) {
    return fallback;
  }
  const value = input[field];
  if (value === null) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CustomerAgentActionError("invalid_quiet_hours", "quietHours must be an object or null.");
  }
  const candidate = value as Record<string, unknown>;
  return {
    startHour: normalizeHour(readHour(candidate.startHour, "quietHours.startHour")),
    endHour: normalizeHour(readHour(candidate.endHour, "quietHours.endHour")),
  };
}

function readHour(value: unknown, field: string) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Math.floor(Number(value));
  }
  throw new CustomerAgentActionError("invalid_quiet_hours", `${field} must be a number from 0 to 23.`);
}

function normalizeHour(value: number) {
  if (value < 0) {
    return 0;
  }
  if (value > 23) {
    return 23;
  }
  return value;
}

function requireExplicitApproval(input: Record<string, unknown>) {
  if (readOptionalBoolean(input, "explicitApproval") === true || readOptionalBoolean(input, "approved") === true) {
    return;
  }
  throw new CustomerAgentActionError(
    "missing_explicit_approval",
    "Set explicitApproval to true before changing delivery settings or targets.",
  );
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

function readCounterMoveWorkflow(input: Record<string, unknown>) {
  return {
    ownerLabel: readCounterMoveOwnerLabel(input),
    channel: readCounterMoveFollowUpChannel(input),
    expiryDays: readCounterMoveExpiryDays(input),
  };
}

function readCounterMoveOwnerLabel(input: Record<string, unknown>) {
  const value = readString(input, "ownerLabel") ?? readString(input, "followUpOwner");
  if (!value) {
    return null;
  }
  if (isSecretishMemoryString(value) || looksLikeDeliveryTargetValue(value)) {
    throw new CustomerAgentActionError(
      "secret_workflow_owner_rejected",
      "Counter-move follow-up owner cannot contain secrets, credentials, or delivery targets.",
    );
  }
  return value.replace(/\s+/g, " ").slice(0, 80);
}

function looksLikeDeliveryTargetValue(value: string) {
  const normalized = value.trim();
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(normalized)) {
    return true;
  }
  if (/\b(?:https?:\/\/|www\.)\S+/i.test(normalized)) {
    return true;
  }
  const digits = normalized.replace(/\D/g, "");
  return digits.length >= 7 && /^[+\d\s().-]+$/.test(normalized);
}

function readCounterMoveFollowUpChannel(input: Record<string, unknown>): CounterMoveFollowUpChannel | null {
  const value = readString(input, "followUpChannel") ?? readString(input, "channel");
  if (!value) {
    return null;
  }
  if (value === "slack" && !isSlackWebhookDeliveryCustomerFacing()) {
    throw new CustomerAgentActionError("slack_delivery_unavailable", slackDeliveryUnavailableMessage(), {
      status: 403,
    });
  }
  if (value === "app" || value === "email" || value === "slack" || value === "client_room") {
    return value;
  }
  throw new CustomerAgentActionError(
    "invalid_follow_up_channel",
    "followUpChannel must be app, email, or client_room.",
  );
}

function readCounterMoveExpiryDays(input: Record<string, unknown>) {
  const value = input.expiryDays ?? input.expiresInDays ?? input.followUpDays;
  if (value === null || typeof value === "undefined" || value === "") {
    return null;
  }
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new CustomerAgentActionError(
      "invalid_follow_up_expiry",
      "expiryDays must be a number from 1 to 30.",
    );
  }
  return Math.max(1, Math.min(30, Math.floor(parsed)));
}

function mapAgentMemoryInputError<T>(callback: () => T): T {
  try {
    return callback();
  } catch (error) {
    if (error instanceof AgentMemoryInputError) {
      throw new CustomerAgentActionError(error.code, error.message, { status: error.status });
    }
    throw error;
  }
}

function readAgentMemoryScope(input: Record<string, unknown>): AgentMemoryScope {
  return mapAgentMemoryInputError(() => readSafeAgentMemoryScope(input.scope));
}

function readOptionalAgentMemoryScope(input: Record<string, unknown>): AgentMemoryScope | null {
  return mapAgentMemoryInputError(() => readOptionalSafeAgentMemoryScope(input.scope));
}

function readMemoryKey(input: Record<string, unknown>) {
  return mapAgentMemoryInputError(() => readSafeAgentMemoryKey(input.key));
}

function readMemorySource(input: Record<string, unknown>) {
  return mapAgentMemoryInputError(() => readSafeAgentMemorySource(input.source));
}

function readMemoryValue(input: Record<string, unknown>) {
  return mapAgentMemoryInputError(() => readSafeAgentMemoryValue(input.value));
}

function safeMemoryRecord(memory: AgentMemoryRecord): AgentMemoryRecord {
  return safeAgentMemoryRecord(memory);
}

function readClientRoomNotes(input: Record<string, unknown>) {
  const value = input.notes;
  if (value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new CustomerAgentActionError("invalid_room_notes", "notes must be an object.", { status: 400 });
  }
  if (Object.prototype.hasOwnProperty.call(value, "reportApprovals")) {
    throw new CustomerAgentActionError(
      "reserved_room_notes",
      "reportApprovals is owner-managed; use the browser approval action to approve current report evidence.",
      { status: 400 },
    );
  }
  mapAgentMemoryInputError(() => rejectSecretishMemoryValue(value, "Client room notes cannot contain secrets or credentials."));
  return sanitizeAgentActionMetadata(value);
}

function safeClientRoomRecord(room: ClientRoomRecord): ClientRoomRecord {
  return {
    ...room,
    name: safeClientRoomDisplayText(room.name, "Client room"),
    clientLabel: room.clientLabel ? safeClientRoomDisplayText(room.clientLabel, "Client") : null,
    resourceRefs: room.resourceRefs.map((ref) => ({
      ...ref,
      ...(ref.label ? { label: safeClientRoomDisplayText(ref.label, "Linked resource") } : {}),
    })),
    notes: sanitizeClientRoomNotesForResponse(room.notes),
  };
}

function safeWatchlistDeliveryConfigRecord(config: WatchlistDeliveryConfigRecord) {
  return {
    id: config.id,
    watchlistId: config.watchlistId,
    userId: config.userId,
    sensitivityMode: config.sensitivityMode,
    instantEnabled: config.instantEnabled,
    digestEnabled: config.digestEnabled,
    emailEnabled: config.emailEnabled,
    ...(isWhatsAppDeliveryCustomerFacing() ? { whatsappEnabled: config.whatsappEnabled } : {}),
    ...(isSlackWebhookDeliveryCustomerFacing() ? { slackEnabled: config.slackEnabled } : {}),
    ...(isTeamsWebhookDeliveryCustomerFacing() ? { teamsEnabled: config.teamsEnabled } : {}),
    quietHours: config.quietHours,
    timezone: config.timezone,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

function safeDeliveryTargetRecord(target: DeliveryTargetRecord) {
  const redactedValue = redactDeliveryTargetValue(target);
  const displayName = safeDeliveryTargetDisplayName(target, redactedValue);
  const hasSafeDisplayName = displayName !== redactedValue;
  return {
    id: target.id,
    watchlistId: target.watchlistId,
    channel: target.channel,
    targetValue: redactedValue,
    displayName,
    validationStatus: target.validationStatus,
    isValidated: target.isValidated,
    isOptedIn: target.isOptedIn,
    isPaused: target.isPaused,
    optedInAt: target.optedInAt,
    pausedAt: target.pausedAt,
    optedOutAt: target.optedOutAt,
    templateEligible: target.templateEligible,
    lastSuccessfulDeliveryAt: target.lastSuccessfulDeliveryAt,
    metadata: hasSafeDisplayName ? { displayName } : {},
    createdAt: target.createdAt,
    updatedAt: target.updatedAt,
  };
}

function redactDeliveryTargetValue(target: Pick<DeliveryTargetRecord, "channel" | "targetValue">) {
  if (target.channel === "email") {
    return maskEmail(target.targetValue);
  }
  if (target.channel === "whatsapp") {
    return maskPhone(target.targetValue);
  }
  return "slack:[redacted]";
}

function readMetadataDisplayName(metadata: Record<string, unknown>) {
  const value = metadata.displayName;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeDeliveryTargetDisplayName(target: DeliveryTargetRecord, fallback: string) {
  const displayName = readMetadataDisplayName(target.metadata);
  if (!displayName || isSecretishMemoryString(displayName) || displayName.includes(target.targetValue)) {
    return fallback;
  }
  if (target.channel === "email" && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(displayName)) {
    return fallback;
  }
  if (target.channel === "whatsapp") {
    const displayDigits = displayName.replace(/\D/g, "");
    const targetDigits = target.targetValue.replace(/\D/g, "");
    if (displayDigits.length >= 6 || (displayDigits.length >= 4 && targetDigits.includes(displayDigits))) {
      return fallback;
    }
  }
  return displayName;
}

function maskEmail(value: string) {
  const [local, domain] = value.split("@");
  if (!local || !domain) {
    return "[redacted-email]";
  }
  return `${local.slice(0, 1)}***@${domain}`;
}

function maskPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits ? `***${digits.slice(-4)}` : "[redacted-phone]";
}

function sanitizeClientRoomNotesForResponse(notes: Record<string, unknown>) {
  const sanitized = sanitizeAgentFacingValue(notes);
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? sanitized as Record<string, unknown>
    : {};
}

function withoutClientRoomReportApprovals(notes: Record<string, unknown>) {
  const next = { ...notes };
  delete next.reportApprovals;
  return next;
}

function readClientRoomDisplayName(input: Record<string, unknown>, field: string, label: string) {
  const value = requireString(input, field);
  rejectSecretishClientRoomDisplayText(value, `${label} cannot contain secrets or credentials.`);
  return value;
}

function readOptionalClientRoomDisplayName(input: Record<string, unknown>, field: string, label: string) {
  const value = readString(input, field);
  if (!value) {
    return null;
  }
  rejectSecretishClientRoomDisplayText(value, `${label} cannot contain secrets or credentials.`);
  return value;
}

function rejectSecretishClientRoomDisplayText(value: string, message: string) {
  if (isSecretishMemoryString(value)) {
    throw new CustomerAgentActionError("secret_client_room_text_rejected", message);
  }
}

function safeClientRoomDisplayText(value: string, fallback: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || isSecretishMemoryString(normalized)) {
    return fallback;
  }
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
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

function isProofBackedWatchEvent(event: WatchEventRecord) {
  return isClientReportEligibleWatchEvent(event);
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
    const label = readOptionalClientRoomDisplayName(ref, "label", "Resource label");
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

async function assertClientRoomReportRefsReady(
  env: AppEnv,
  userId: string,
  refs: ClientRoomResourceRef[],
) {
  for (const ref of refs) {
    if (ref.resourceType !== "report") continue;
    const { report } = await loadReportDocumentForAgent(env, userId, { reportId: ref.resourceId });
    const readiness = evaluateReportReadiness(report);
    if (!readiness.ok) {
      throw new CustomerAgentActionError("evidence_not_ready", readiness.reason, { status: 409 });
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

function shareUrl(context: CustomerAgentActionContext, token: string) {
  return context.origin ? new URL(`/share/${token}`, context.origin).toString() : `/share/${token}`;
}

async function customerErrorFromResponse(response: Response) {
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  const code = typeof payload?.error === "string" ? payload.error : null;
  const knownCode = code === "invalid_api_key" || code === "rate_limited" || code === "rate_limit_unavailable";
  const message = knownCode && typeof payload?.message === "string"
    ? payload.message
    : "Agent action could not be completed.";
  const retryAfterSeconds = Number(response.headers.get("retry-after"));
  return new CustomerAgentActionError(knownCode ? code : "invalid_action_input", message, {
    status: response.status >= 400 ? response.status : 400,
    details: Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? { retryAfterSeconds }
      : {},
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
