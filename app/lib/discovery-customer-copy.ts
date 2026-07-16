import type {
  CommercialDiscoveryStatus,
  CustomerMetaConnectionRecord,
  MetaIntegrationStatus,
} from "~/lib/types";

type DiscoveryStatusInput = Pick<
  MetaIntegrationStatus,
  "status" | "summary" | "lastCheckedAt"
> &
  Partial<Pick<MetaIntegrationStatus, "lastErrorCode">>;

export interface CustomerDiscoveryStatus {
  status: CommercialDiscoveryStatus;
  summary: string;
  lastCheckedAt: string | null;
  recovery: string | null;
}

export interface CustomerMetaConnection {
  status: CustomerMetaConnectionRecord["status"];
  tokenLastFour: string;
  summary: string;
  lastCheckedAt: string | null;
  updatedAt: string;
}

const SAFE_RETRY_CLAUSE_PATTERN = /Retrying after about ([^.]+)\./i;

function safeRetryClause(summary: string) {
  const match = summary.match(SAFE_RETRY_CLAUSE_PATTERN);
  const delay = match?.[1]?.trim();
  return delay &&
    /^\d+\s*(?:s|m|h|d|seconds?|minutes?|hours?|days?)$/i.test(delay)
    ? `We'll retry in about ${delay}.`
    : "We'll retry automatically.";
}

function safeDiscoverySummary(
  status: CommercialDiscoveryStatus,
  rawSummary: string,
  errorCode: string | null,
) {
  const hasNoCachedResults = /no cached results/i.test(rawSummary);
  const cached =
    !hasNoCachedResults &&
    /cached (?:live )?results (?:are available|available)|serving cached results/i.test(
      rawSummary,
    );
  const retry = safeRetryClause(rawSummary);

  if (status === "healthy") {
    return "Live ad checks are ready.";
  }
  if (status === "demo") {
    return "Live ad checks aren't configured yet, so searches show labeled sample data.";
  }
  if (/warming this query/i.test(rawSummary)) {
    return "We're checking this competitor now. Results should appear shortly.";
  }
  if (/fallback is available|backup .* filling in/i.test(rawSummary)) {
    return "Live ad checks are temporarily delayed; a backup check is filling in.";
  }
  if (/fallback failed|diagnostic fetch failed/i.test(rawSummary)) {
    return "Live ad checks are temporarily delayed. We'll retry automatically — results refresh as soon as checks recover.";
  }
  if (
    errorCode === "browser_launch_failed" ||
    errorCode === "browser_unavailable"
  ) {
    return "The visual ad check is temporarily delayed. We'll retry automatically — results refresh as soon as checks recover.";
  }
  if (errorCode === "rate_limited") {
    return `The ad source is briefly limiting checks. ${retry} Results refresh as soon as checks recover.`;
  }
  if (errorCode === "timeout") {
    return "The ad check took longer than expected. We'll retry automatically — results refresh as soon as checks recover.";
  }
  if (status === "cache_only" || cached || /rate limited/i.test(rawSummary)) {
    return cached
      ? `Live ad checks are temporarily delayed, so we're showing your most recent results. ${retry}`
      : `The ad source is briefly limiting checks. ${retry} Results refresh as soon as checks recover.`;
  }
  if (status === "disabled") {
    return "Live ad checks are unavailable right now. Review source access before relying on fresh results.";
  }
  if (errorCode === "login_wall" || errorCode === "auth_required") {
    return "Live ad checks need refreshed source access. Review source access, then retry.";
  }
  return "Live ad checks are temporarily delayed. We'll retry automatically — results refresh as soon as checks recover.";
}

export function toCustomerDiscoveryStatus(
  status: DiscoveryStatusInput,
): CustomerDiscoveryStatus {
  const normalizedStatus = status.status;
  const summary = safeDiscoverySummary(
    normalizedStatus,
    status.summary ?? "",
    status.lastErrorCode ?? null,
  );

  return {
    status: normalizedStatus,
    summary,
    lastCheckedAt: status.lastCheckedAt ?? null,
    recovery:
      normalizedStatus === "healthy" || normalizedStatus === "demo"
        ? null
        : "Review tracking access and retry when ready.",
  };
}

export function toCustomerMetaConnection(
  connection: CustomerMetaConnectionRecord,
): CustomerMetaConnection {
  return {
    status: connection.status,
    tokenLastFour: connection.tokenLastFour,
    summary:
      connection.status === "healthy"
        ? "Backup source access is connected."
        : connection.status === "degraded"
          ? "Backup source access needs attention."
          : "Backup source access has not been tested yet.",
    lastCheckedAt: connection.lastCheckedAt,
    updatedAt: connection.updatedAt,
  };
}

/**
 * Rewrites legacy/raw summaries used by older customer components. Unknown
 * text is deliberately discarded instead of being echoed into customer HTML.
 */
export function customerDiscoverySummary(
  summary: string | null | undefined,
): string | null {
  const raw = summary?.trim();
  if (!raw) return null;
  const safeSummaryPattern =
    /^(?:Live ad checks are ready\.|Live ad checks aren't configured yet, so searches show labeled sample data\.|Live ad checks are unavailable right now\. Review source access before relying on fresh results\.|Live ad checks need refreshed source access\. Review source access, then retry\.|Live ad checks are temporarily delayed; a backup check is filling in\.|Live ad checks are temporarily delayed(?:, so we're showing your most recent results\.)? We'll retry (?:automatically|in about \d+\s*(?:s|m|h|d|seconds?|minutes?|hours?|days?))\.(?: — results refresh as soon as checks recover\.)?|The visual ad check is temporarily delayed\. We'll retry automatically — results refresh as soon as checks recover\.|The ad check took longer than expected\. We'll retry automatically — results refresh as soon as checks recover\.|The ad source is briefly limiting checks\. We'll retry (?:automatically|in about \d+\s*(?:s|m|h|d|seconds?|minutes?|hours?|days?))\. Results refresh as soon as checks recover\.|We're checking this competitor now\. Results should appear shortly\.)$/i;
  if (safeSummaryPattern.test(raw)) {
    return raw;
  }
  return safeDiscoverySummary("degraded", raw, null);
}
