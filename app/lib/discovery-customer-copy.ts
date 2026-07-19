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
        : "Check source access, then retry once it's ready.",
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

  const retryMatch = raw.match(SAFE_RETRY_CLAUSE_PATTERN);
  const retryClause = retryMatch?.[1]
    ? `We'll retry in about ${retryMatch[1].trim()}`
    : "We'll retry automatically";
  const cachedResultsAvailable =
    /serving cached results/i.test(raw) ||
    (/cached (?:live )?results are available/i.test(raw) &&
      !/no cached results are available/i.test(raw));

  if (/rate limited/i.test(raw)) {
    return cachedResultsAvailable
      ? `The ad source is briefly limiting checks, so we're showing your most recent results. ${retryClause}.`
      : `The ad source is briefly limiting checks and no recent results are saved for this search yet. ${retryClause} — results refresh as soon as checks recover.`;
  }
  if (/degraded/i.test(raw)) {
    return cachedResultsAvailable
      ? `Live ad checks are temporarily delayed, so we're showing your most recent results. ${retryClause}.`
      : `Live ad checks are temporarily delayed. ${retryClause} — results refresh as soon as checks recover.`;
  }
  if (/already warming this query/i.test(raw)) {
    return "We're checking this competitor now. Results should appear shortly.";
  }
  if (/running through Browser Run\.$/i.test(raw)) {
    return "Live ad checks are running normally.";
  }
  if (/configured through Browser Run, but provider health has not been confirmed/i.test(raw)) {
    return "Live ad checks are set up. The next check confirms everything is healthy.";
  }
  if (/API fallback is available while browser capture is unavailable/i.test(raw)) {
    return "Visual ad checks are temporarily delayed; a backup Meta check is filling in.";
  }
  if (
    /API fallback failed while browser capture is unavailable/i.test(raw) ||
    /diagnostic fetch failed/i.test(raw)
  ) {
    return "Live ad checks are temporarily delayed. We'll retry automatically — results refresh as soon as checks recover.";
  }
  if (/No live commercial discovery provider is configured/i.test(raw)) {
    return "Live ad checks aren't configured yet, so searches show labeled sample data.";
  }
  return safeDiscoverySummary("degraded", raw, null);
}
