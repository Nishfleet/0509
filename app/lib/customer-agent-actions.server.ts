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
} from "~/lib/agent-actions.server";
import { normalizeSavedQuery } from "~/lib/normalize";
import { normalizeWatchlistTrackingRole } from "~/lib/watchlist-role";
import type { DiscoveryFailureClass } from "~/lib/types";

export const CUSTOMER_AGENT_ACTION_NAMES = [
  "watchlist.create",
  "watchlist.refresh",
  "watchlist.pause",
  "watchlist.resume",
] as const;

export type CustomerAgentActionName = (typeof CUSTOMER_AGENT_ACTION_NAMES)[number];

export interface CustomerAgentActionContext {
  userId: string;
  apiKeyId: string | null;
  idempotencyKey?: string | null;
  source: "mcp" | "api_v1";
  executionContext?: ExecutionContext | null;
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

export async function runCustomerAgentAction(
  env: AppEnv,
  context: CustomerAgentActionContext,
  actionName: CustomerAgentActionName,
  input: Record<string, unknown>,
) {
  return runAuditedAgentAction<Record<string, unknown>>(env, {
    userId: context.userId,
    apiKeyId: context.apiKeyId,
    actionName,
    idempotencyKey: context.idempotencyKey,
    metadata: {
      source: context.source,
    },
  }, async () => {
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

    throw new CustomerAgentActionError("unsupported_action", "Unsupported agent action.", { status: 404 });
  });
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

  if (readBoolean(input, "queueFirstScan", true)) {
    queueFirstWatchlistScan(env, context.executionContext ?? undefined, watchlist);
  }

  return {
    ok: true,
    action: "watchlist.create",
    watchlist,
    firstScanQueued: readBoolean(input, "queueFirstScan", true),
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
