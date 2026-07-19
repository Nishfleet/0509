import type { PresenceEntityBrief } from "~/lib/presence-entity-brief.server";
import type { PresencePollCursorRecord, PresenceSourceCoverageEntry } from "~/lib/presence-types";

export interface PresenceCustomerErrorCopy {
  reasonCode: string;
  message: string;
  action: string;
}

const GENERIC_PRESENCE_ERROR: PresenceCustomerErrorCopy = {
  reasonCode: "degraded",
  message: "The latest source check could not complete.",
  action: "Try again later or review the source settings.",
};

const PRESENCE_ERROR_COPY: Record<string, PresenceCustomerErrorCopy> = {
  api_not_configured: {
    reasonCode: "not_available",
    message: "This source is not available for customer checks yet.",
    action: "Use an available website source or try again after rollout.",
  },
  provider_not_configured: {
    reasonCode: "not_available",
    message: "This source is not available for customer checks yet.",
    action: "Use an available website source or try again after rollout.",
  },
  connector_disabled: {
    reasonCode: "not_available",
    message: "This source is not available for customer checks yet.",
    action: "Use an available website source or try again after rollout.",
  },
  connector_not_operational: {
    reasonCode: "not_available",
    message: "This source is not available for customer checks yet.",
    action: "Use an available website source or try again after rollout.",
  },
  poll_not_implemented: {
    reasonCode: "not_available",
    message: "This source is not available for customer checks yet.",
    action: "Use an available website source or try again after rollout.",
  },
  manual_proof_required: {
    reasonCode: "manual_action_required",
    message: "This source needs a manual check.",
    action: "Review the source manually or add a public website source.",
  },
  competitor_limited: {
    reasonCode: "limited",
    message: "Coverage for this source is limited.",
    action: "Use a public website source for the most reliable checks.",
  },
  social_connect_not_in_plan: {
    reasonCode: "plan_required",
    message: "This source is not included in your current plan.",
    action: "Review your plan to enable this source.",
  },
  website_sources_not_in_plan: {
    reasonCode: "plan_required",
    message: "Website sources are not included in your current plan.",
    action: "Review your plan to enable website sources.",
  },
  mode_not_in_plan: {
    reasonCode: "plan_required",
    message: "This entity type is not included in your current plan.",
    action: "Review your plan to enable this entity type.",
  },
  plan_gated: {
    reasonCode: "plan_required",
    message: "Presence checks are not included in your current plan.",
    action: "Review your plan to enable Presence checks.",
  },
  mode_gated: {
    reasonCode: "plan_required",
    message: "This entity type is not included in your current plan.",
    action: "Review your plan to enable this entity type.",
  },
  feature_gated: {
    reasonCode: "plan_required",
    message: "This source is not included in your current plan.",
    action: "Review your plan to enable this source.",
  },
  entity_limit: {
    reasonCode: "limit_reached",
    message: "You've reached the tracked entity limit.",
    action: "Remove an entity or review your plan for more capacity.",
  },
  mode_limit: {
    reasonCode: "limit_reached",
    message: "You've reached the limit for this entity type.",
    action: "Remove an entity or review your plan for more capacity.",
  },
  source_limit: {
    reasonCode: "limit_reached",
    message: "You've reached the source limit for this entity.",
    action: "Remove a source or review your plan for more capacity.",
  },
  missing_url: {
    reasonCode: "source_details_needed",
    message: "The source address is missing.",
    action: "Add a public source address and try again.",
  },
  missing_target_url: {
    reasonCode: "source_details_needed",
    message: "The source address is missing.",
    action: "Add a public source address and try again.",
  },
  missing_organization: {
    reasonCode: "source_details_needed",
    message: "The source details are incomplete.",
    action: "Add the missing source details and try again.",
  },
  missing_subreddit: {
    reasonCode: "source_details_needed",
    message: "The source details are incomplete.",
    action: "Add the missing source details and try again.",
  },
  missing_handle: {
    reasonCode: "source_details_needed",
    message: "The source details are incomplete.",
    action: "Add the missing source details and try again.",
  },
  oauth_required: {
    reasonCode: "connection_required",
    message: "This source needs a verified connection before it can be checked.",
    action: "Connect the source, then try again.",
  },
  invalid_target: {
    reasonCode: "source_details_needed",
    message: "The source details could not be verified.",
    action: "Check the source details and try again.",
  },
  ssrf_blocked: {
    reasonCode: "source_not_checkable",
    message: "This source address cannot be checked.",
    action: "Use a public HTTPS address and try again.",
  },
  robots_disallowed: {
    reasonCode: "source_blocked",
    message: "robots.txt disallows crawling the requested path.",
    action: "Check that the source allows public access, then try again.",
  },
  robots_fetch_failed: {
    reasonCode: "source_access_unclear",
    message: "We could not verify whether this source allows automated checks.",
    action: "Try again later or review the source settings.",
  },
  robots_unavailable: {
    reasonCode: "source_access_unclear",
    message: "We could not verify whether this source allows automated checks.",
    action: "Try again later or review the source settings.",
  },
  fetch_failed: {
    reasonCode: "source_unavailable",
    message: "Could not fetch the website.",
    action: "Try again later.",
  },
  feed_unavailable: {
    reasonCode: "source_unavailable",
    message: "The source did not respond to the latest check.",
    action: "Try again later or use another public page.",
  },
  page_unavailable: {
    reasonCode: "source_unavailable",
    message: "The source did not respond to the latest check.",
    action: "Try again later or use another public page.",
  },
  feed_parse_failed: {
    reasonCode: "source_unreadable",
    message: "The latest source content could not be read.",
    action: "Try again later or use another public page.",
  },
  poll_failed: {
    reasonCode: "degraded",
    message: "The latest source check could not complete.",
    action: "Try again later or review the source settings.",
  },
  poll_exception: {
    reasonCode: "degraded",
    message: "The latest source check could not complete.",
    action: "Try again later or review the source settings.",
  },
  not_found: {
    reasonCode: "not_found",
    message: "That source is no longer available.",
    action: "Refresh the page and try again.",
  },
  source_inactive: {
    reasonCode: "source_inactive",
    message: "This source is inactive.",
    action: "Refresh the page or add the source again.",
  },
  unknown_source: GENERIC_PRESENCE_ERROR,
};

const PRESENCE_ERROR_ALIASES: Record<string, string> = {
  not_available: "api_not_configured",
  manual_action_required: "manual_proof_required",
  limited: "competitor_limited",
  plan_required: "plan_gated",
  limit_reached: "entity_limit",
  source_details_needed: "invalid_target",
  connection_required: "oauth_required",
  source_not_checkable: "ssrf_blocked",
  source_blocked: "robots_disallowed",
  source_access_unclear: "robots_unavailable",
  source_unavailable: "fetch_failed",
  source_unreadable: "feed_parse_failed",
};

function normalizedReasonCode(reasonCode: unknown): string | null {
  if (typeof reasonCode !== "string") return null;
  const normalized = reasonCode.trim().toLowerCase();
  return normalized || null;
}

export function presenceCustomerErrorCopy(reasonCode: unknown): PresenceCustomerErrorCopy {
  const normalized = normalizedReasonCode(reasonCode);
  const mappedCode = normalized ? (PRESENCE_ERROR_ALIASES[normalized] ?? normalized) : null;
  return (mappedCode && PRESENCE_ERROR_COPY[mappedCode]) || GENERIC_PRESENCE_ERROR;
}

export function sanitizePresenceCoverageEntry(entry: PresenceSourceCoverageEntry): PresenceSourceCoverageEntry {
  if (!entry.reasonCode && !entry.reasonMessage) return entry;
  const copy = presenceCustomerErrorCopy(entry.reasonCode);
  return {
    ...entry,
    reasonCode: copy.reasonCode,
    reasonMessage: copy.message,
    actionNeeded: copy.action,
  };
}

function safeCursorValue(cursor: Record<string, unknown>, key: string): unknown {
  const value = cursor[key];
  if (key === "syncCycleCount" || key === "lastChangeCount") {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  if (key === "lastChangedAt") {
    return typeof value === "string" && value.trim() ? value : undefined;
  }
  if (key === "lastChangedUrlHashes") {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
      : undefined;
  }
  return undefined;
}

export function sanitizePresencePollCursor(cursor: PresencePollCursorRecord | null): PresencePollCursorRecord | null {
  if (!cursor) return null;
  const safeCursor: Record<string, unknown> = {};
  for (const key of ["syncCycleCount", "lastChangedAt", "lastChangeCount", "lastChangedUrlHashes"]) {
    const value = safeCursorValue(cursor.cursor, key);
    if (value !== undefined) safeCursor[key] = value;
  }
  const hasError = Boolean(cursor.lastErrorCode || cursor.lastErrorMessage);
  const copy = hasError ? presenceCustomerErrorCopy(cursor.lastErrorCode) : null;
  return {
    sourceTargetId: cursor.sourceTargetId,
    cursor: safeCursor,
    etag: null,
    lastModified: null,
    lastPolledAt: cursor.lastPolledAt,
    lastSuccessAt: cursor.lastSuccessAt,
    lastErrorCode: copy?.reasonCode ?? null,
    lastErrorMessage: copy?.message ?? null,
    updatedAt: cursor.updatedAt,
  };
}

export function sanitizePresenceEntityBrief(brief: PresenceEntityBrief): PresenceEntityBrief {
  return {
    ...brief,
    sourceCoverage: brief.sourceCoverage.map(sanitizePresenceCoverageEntry),
  };
}
