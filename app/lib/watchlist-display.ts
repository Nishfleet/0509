import type { PublicDeliveryAttemptSummary } from "~/lib/delivery-attempt-public";
import {
  customerDiscoverySummary,
  type CustomerDiscoveryStatus,
} from "~/lib/discovery-customer-copy";
import { formatWatchEventTypeLabel } from "~/lib/landing-page-display";
import type {
  DeliveryChannel,
  DiscoveryFailureClass,
  MetaIntegrationStatus,
  ProofCaptureRecord,
  WatchlistProofSummary,
  WatchlistRunRecord,
  WatchlistRunSummaryCounts,
} from "~/lib/types";

export function isDeliveryTestRequestToken(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function emptyProofSummary(): WatchlistProofSummary {
  return {
    totalAttempts: 0,
    successfulAttempts: 0,
    failedAttempts: 0,
    skippedAttempts: 0,
    lastAttemptAt: null,
    lastSuccessfulProofAt: null,
  };
}

export function formatWatchlistRefreshFailure(
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

export function formatRetryAfterLabel(retryAfterSeconds: number) {
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

export function buildProofSummary(captures: ProofCaptureRecord[]): WatchlistProofSummary {
  const successful = captures.filter((capture) => capture.status === "succeeded");
  const failed = captures.filter((capture) => capture.status === "failed");
  const skipped = captures.filter((capture) => capture.status.startsWith("skipped_"));

  return {
    totalAttempts: captures.length,
    successfulAttempts: successful.length,
    failedAttempts: failed.length,
    skippedAttempts: skipped.length,
    lastAttemptAt: captures[0]?.attemptedAt ?? null,
    lastSuccessfulProofAt: successful[0]?.succeededAt ?? null,
  };
}

export function isVisibleDeliveryChannel(
  channel: string,
  visibility: { showSlackDelivery: boolean; showTeamsDelivery: boolean; whatsappAvailable: boolean },
) {
  return (
    channel === "email" ||
    (channel === "whatsapp" && visibility.whatsappAvailable) ||
    (channel === "slack" && visibility.showSlackDelivery) ||
    (channel === "teams" && visibility.showTeamsDelivery)
  );
}

export function visibleDeliveryChannels(
  visibility: { showSlackDelivery: boolean; showTeamsDelivery: boolean; whatsappAvailable: boolean },
): DeliveryChannel[] {
  const channels: DeliveryChannel[] = ["email"];
  if (visibility.whatsappAvailable) {
    channels.push("whatsapp");
  }
  if (visibility.showSlackDelivery) {
    channels.push("slack");
  }
  if (visibility.showTeamsDelivery) {
    channels.push("teams");
  }
  return channels;
}

export function sortByUpdatedAtDesc<T extends { updatedAt: string }>(records: T[]) {
  return [...records].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function sortByCreatedAtDesc<T extends { createdAt: string }>(records: T[]) {
  return [...records].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function maskDormantDeliveryConfig<
  T extends { whatsappEnabled: boolean; slackEnabled: boolean; teamsEnabled: boolean },
>(config: T, visibility: { showSlackDelivery: boolean; showTeamsDelivery: boolean; whatsappAvailable: boolean }): T {
  return {
    ...config,
    whatsappEnabled: visibility.whatsappAvailable && config.whatsappEnabled,
    slackEnabled: visibility.showSlackDelivery && config.slackEnabled,
    teamsEnabled: visibility.showTeamsDelivery && config.teamsEnabled,
  };
}

export function normalizeSensitivityMode(value: string) {
  if (value === "quiet" || value === "balanced" || value === "aggressive" || value === "auto") {
    return value;
  }

  return "balanced";
}

export function buildLastAttemptByEventId(attempts: PublicDeliveryAttemptSummary[]) {
  return attempts.reduce((map, attempt) => {
    for (const eventId of attempt.eventIds) {
      if (!map.has(eventId)) {
        map.set(eventId, attempt);
      }
    }
    return map;
  }, new Map<string, PublicDeliveryAttemptSummary>());
}

export function formatRunSummary(summary: Record<string, unknown>) {
  const message = typeof summary.message === "string" ? summary.message.trim() : "";
  const parts = [
    message || null,
    formatNumericSummaryPart(summary, "adsSeen", "ads seen"),
    formatNumericSummaryPart(summary, "candidatesDetected", "candidates detected"),
    formatNumericSummaryPart(summary, "proofsAttempted", "proof captures attempted"),
    formatNumericSummaryPart(summary, "eventsConfirmed", "events confirmed"),
    formatNumericSummaryPart(summary, "sendsTriggered", "sends triggered"),
    formatNumericSummaryPart(summary, "events", "events total"),
  ].filter((part): part is string => Boolean(part));

  return parts.join(" · ");
}

export function formatRunEventTypes(summary: Record<string, unknown>) {
  const value = summary.eventTypes;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }

  const parts = Object.entries(value)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0)
    .map(([eventType, count]) => `${formatWatchEventTypeLabel(eventType)} ×${count}`);

  return parts.join(" · ");
}

export function formatDiscoveryHeadline(status: Pick<MetaIntegrationStatus, "status">) {
  if (status.status === "healthy") {
    return "Live competitor tracking is ready";
  }
  if (status.status === "cache_only") {
    return "Using recent competitor results";
  }
  if (status.status === "disabled") {
    return "Competitor tracking is unavailable";
  }
  return "Live ad checks are temporarily delayed";
}

export function formatDiscoveryStatusLabel(status: MetaIntegrationStatus["status"]) {
  if (status === "cache_only") {
    return "Using recent results";
  }
  if (status === "healthy") {
    return "Ready";
  }
  if (status === "degraded") {
    return "Needs attention";
  }
  if (status === "disabled") {
    return "Unavailable";
  }
  return "Needs attention";
}

export function resolveWatchlistTrackingPresentation(
  status: CustomerDiscoveryStatus,
  runs: WatchlistRunRecord[],
  proofSummary: WatchlistProofSummary,
) {
  const latestSuccessfulRunAt = runs.reduce<string | null>((latest, run) => {
    if (run.status !== "succeeded" || !run.finishedAt) return latest;
    return !latest || Date.parse(run.finishedAt) > Date.parse(latest) ? run.finishedAt : latest;
  }, null);
  const hasStoredEvidence = proofSummary.successfulAttempts > 0 || Boolean(latestSuccessfulRunAt);
  const lastCheckedAt = status.lastCheckedAt ?? latestSuccessfulRunAt ?? proofSummary.lastSuccessfulProofAt;

  return {
    headline: formatDiscoveryHeadline(status),
    summary:
      customerDiscoverySummary(status.summary) ??
      "Tracking status will appear after the first check.",
    statusLabel: formatDiscoveryStatusLabel(status.status),
    lastCheckedAt,
  };
}

export function resolveWatchlistListScanPresentation(input: {
  isActive: boolean;
  lastScannedAt: string | null;
  latestRun: WatchlistRunRecord | null;
  plan: string;
}) {
  if (!input.isActive) {
    return input.lastScannedAt
      ? { label: "Paused · last successful check", timestamp: input.lastScannedAt }
      : { label: "Paused before its first check", timestamp: null };
  }

  const run = input.latestRun;
  if (!run) {
    return input.lastScannedAt
      ? { label: "Last successful check", timestamp: input.lastScannedAt }
      : { label: "No completed check yet — open for status", timestamp: null };
  }
  if (run.status === "running") {
    return {
      label: input.lastScannedAt ? "Checking for changes now" : input.plan === "free" ? "Activation scan running" : "First scan running",
      timestamp: null,
    };
  }
  if (run.status === "pending") {
    const delayed = [
      "dispatch_rate_limited",
      "first_scan_dispatch_failed",
      "first_scan_setup_failed",
      "workflow_binding_missing",
    ].includes(run.errorCode ?? "");
    return {
      label: delayed
        ? "Check delayed — we're retrying"
        : input.lastScannedAt
          ? "Next check starts shortly"
          : input.plan === "free"
            ? "Activation scan starts shortly"
            : "First scan starts shortly",
      timestamp: null,
    };
  }
  if (run.status === "failed") {
    return { label: "Latest check failed — open for next steps", timestamp: null };
  }
  if (run.status === "skipped") {
    if (run.errorCode?.endsWith("provider_network_denied")) {
      return { label: "New checks paused — source access needed", timestamp: null };
    }
    if (run.errorCode === "capacity_budget") {
      return { label: "Latest check delayed — runs in the next window", timestamp: null };
    }
    return { label: "Latest check didn't run — open for details", timestamp: null };
  }

  return {
    label: "Last successful check",
    timestamp: run.finishedAt ?? input.lastScannedAt,
  };
}

export function resolveEmptyWatchlistEventCopy(input: {
  lastScannedAt: string | null;
  latestRun: WatchlistRunRecord | null;
  nextScanLabel: string | null;
  plan: string;
}) {
  const activationOnly = input.plan === "free";
  const scanName = activationOnly ? "activation scan" : "first scan";
  if ((!input.latestRun && input.lastScannedAt) || input.latestRun?.status === "succeeded") {
    if (activationOnly) {
      return input.nextScanLabel
        ? `No confirmed changes yet — your activation scan is complete. Your next weekly check runs ${input.nextScanLabel}; paid plans check every 3–6 hours.`
        : "No confirmed changes yet — your activation scan is complete. Your watchlist is checked weekly; paid plans check every 3–6 hours.";
    }
    return input.nextScanLabel
      ? `No confirmed changes yet — we'll flag the next one. Next scheduled scan: ${input.nextScanLabel}.`
      : "No confirmed changes in the last completed check. New checks resume after source access is ready.";
  }

  if (!input.latestRun) {
    return activationOnly
      ? "Your activation scan hasn't started yet. Check Source access; if it stays stuck, email support and we'll dig in."
      : "Your first scan hasn't started yet. Check Source access, then retry once the source is ready.";
  }
  if (input.latestRun.status === "running") {
    return activationOnly
      ? "Your activation scan is running now. Results appear here when the scan completes. After this, free checks weekly; paid plans check every 3–6 hours."
      : "Your first scan is running now. Results appear here when the scan completes.";
  }
  if (input.latestRun.status === "pending") {
    const delayed = [
      "dispatch_rate_limited",
      "first_scan_dispatch_failed",
      "first_scan_setup_failed",
      "workflow_binding_missing",
    ].includes(input.latestRun.errorCode ?? "");
    return delayed
      ? `Your ${scanName} hit a delay, so we're retrying it automatically. If it doesn't start soon, check Source access.`
      : `Your ${scanName} is in line and starts automatically.`;
  }
  if (input.latestRun.status === "failed") {
    return activationOnly
      ? "Your activation scan couldn't finish. Check Source access, and email support if the next attempt fails too."
      : "Your first scan couldn't finish. Check Source access, then retry — or email support and we'll dig in.";
  }
  if (input.latestRun.errorCode?.endsWith("provider_network_denied")) {
    return activationOnly
      ? "Your activation scan paused safely before an external check. Check Source access; email support if it doesn't resume."
      : "Your first scan paused safely before an external check. Check Source access before retrying.";
  }
  return `Your ${scanName} stopped before it could save results. Recent checks shows what happened and what runs next.`;
}

export function resolveWatchlistRunTiming(run: WatchlistRunRecord) {
  if (run.finishedAt) return { label: "Finished", timestamp: run.finishedAt };
  if (run.status === "running") return { label: "Still running", timestamp: null };
  if (run.status === "pending") {
    const retrying = [
      "dispatch_failed",
      "reconcile_dispatch_failed",
      "dispatch_rate_limited",
      "first_scan_dispatch_failed",
      "first_scan_setup_failed",
      "workflow_binding_missing",
    ].includes(run.errorCode ?? "");
    return {
      label: retrying ? "Retrying automatically" : "In line — starts automatically",
      timestamp: null,
    };
  }
  if (run.status === "failed") return { label: "Stopped after a failed check", timestamp: null };
  if (run.status === "skipped") return { label: "Stopped before results were saved", timestamp: null };
  return { label: "Completed", timestamp: null };
}

export function resolveWatchlistRunCustomerError(run: WatchlistRunRecord, plan: string) {
  if (!run.errorMessage) return null;
  return plan === "free"
    ? "This activation scan failed. Check Source access, and email support if the next attempt fails too."
    : "This scan failed. Check Source access, then retry — or email support and we'll dig in.";
}

export function firstScanPollingKey(input: {
  watchlistId: string;
  run: WatchlistRunRecord | null;
}) {
  return `${input.watchlistId}:${input.run?.id ?? "none"}:${input.run?.status ?? "missing"}`;
}

export function formatNumericSummaryPart(
  summary: Record<string, unknown>,
  key: keyof WatchlistRunSummaryCounts | "adsSeen" | "events",
  label: string,
) {
  const value = summary[key];
  return typeof value === "number" ? `${value} ${label}` : null;
}

export function formatRunStatusLabel(status: string, errorCode?: string | null) {
  if (status === "succeeded") return "Succeeded";
  if (status === "failed") return "Failed";
  if (status === "skipped") {
    if (errorCode === "capacity_budget") return "Delayed — monitoring window filled";
    if (errorCode === "workflow_binding_missing" || errorCode === "dispatch_createbatch_missing") {
      return "Delayed — monitoring service unavailable";
    }
    return "Cancelled";
  }
  if (status === "pending") {
    if (
      errorCode === "workflow_binding_missing" ||
      errorCode === "dispatch_createbatch_missing" ||
      errorCode === "dispatch_rate_limited"
    ) {
      return "Delayed — monitoring service unavailable";
    }
    if (errorCode === "dispatch_failed" || errorCode === "reconcile_dispatch_failed") {
      return "Retrying";
    }
    return "In line";
  }
  if (status === "running") return "Running";
  return status;
}

export function formatRunTriggerLabel(triggerType: string) {
  if (triggerType === "manual") return "Manual refresh";
  if (triggerType === "scheduled") return "Scheduled scan";
  if (triggerType === "workflow") return "Background scan";
  return triggerType;
}

/* ==========================================================================
   Watch board (BL-006; brief §6.1, §6.3, §7)
   Pure presentation for the competitor band, the workspace status strip and
   the board ticker. Every value below traces to a stored record — a band
   never claims a state the loader did not prove.
   ========================================================================== */

export type WatchBandState = "caught" | "quiet" | "watching" | "paused" | "attention";

/** Consecutive failed checks before a band stops claiming to be quiet. */
export const WATCH_BAND_FAILURE_THRESHOLD = 3;

export interface WatchBandStamp {
  state: WatchBandState;
  /** Pill `stamp` modifier — the ED state stamp families (brief §6.1). */
  pillState: "caught" | "quiet" | "watching" | "pending";
  label: string;
}

const BAND_STAMPS: Record<WatchBandState, WatchBandStamp> = {
  caught: { state: "caught", pillState: "caught", label: "Caught" },
  quiet: { state: "quiet", pillState: "quiet", label: "Quiet" },
  watching: { state: "watching", pillState: "watching", label: "Watching" },
  paused: { state: "paused", pillState: "pending", label: "Paused" },
  attention: { state: "attention", pillState: "pending", label: "Needs attention" },
};

/**
 * A band's state is read off stored evidence only:
 * paused → the watchlist is off; attention → three or more checks in a row
 * have failed since the last success, so the board never stamps "Quiet" over
 * scanning that is broken; caught → a confirmed change sits in the window;
 * watching → tracking is on but no check has completed yet; quiet → we
 * checked and nothing changed, which is a finding, not a gap (R2).
 */
export function resolveWatchBandState(input: {
  isActive: boolean;
  lastScannedAt: string | null;
  capturedChanges: number;
  failedChecks?: number;
}): WatchBandStamp {
  if (!input.isActive) return BAND_STAMPS.paused;
  if ((input.failedChecks ?? 0) >= WATCH_BAND_FAILURE_THRESHOLD) return BAND_STAMPS.attention;
  if (input.capturedChanges > 0) return BAND_STAMPS.caught;
  if (!input.lastScannedAt) return BAND_STAMPS.watching;
  return BAND_STAMPS.quiet;
}

/** Meta line 2 — cadence, in the same words the plan actually delivers. */
export function formatWatchBandCadence(input: { isActive: boolean; plan: string }): string {
  if (!input.isActive) return "Paused — no checks run";
  return input.plan === "free" ? "Checked weekly" : "Checked every 3–6 hours";
}
