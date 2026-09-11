import type { CustomerAgentActionName } from "~/lib/agent-action-catalog";
import {
  applyWebsiteSearchFallback,
  competitorTrackingLabel,
  hasInvalidCompetitorWebsite,
  isHttpCompetitorWebsite,
  normalizeCompetitorWebsiteInput,
  watchlistFingerprint,
} from "~/lib/competitor-website";
import type { AppEnv } from "~/lib/env.server";
import { queueFirstWatchlistScan } from "~/lib/first-watchlist-scan.server";
import { normalizeSavedQuery } from "~/lib/normalize";
import type { DiscoveryFailureClass } from "~/lib/types";
import { normalizeWatchlistTrackingRole } from "~/lib/watchlist-role";
import {
  CustomerAgentActionError,
  readBoolean,
  readString,
  requireString,
  type CustomerAgentActionContext,
} from "~/lib/customer-agent-actions/request.server";

export function actionReversal(
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

export async function createWatchlistFromAgent(
  env: AppEnv,
  context: CustomerAgentActionContext,
  input: Record<string, unknown>,
) {
  const { checkPlanLimit } = await import("~/lib/plan.server");
  const {
    createWatchlistWithinLimit,
    deleteUnscannedWatchlistCreatedByFailedAgentAction,
  } = await import("~/lib/data.server");
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

export async function updateWatchlistFromAgent(
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

export async function refreshWatchlistFromAgent(
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

export async function setWatchlistActiveFromAgent(
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
