import type {
  AnalysisSource,
  CaptureMethod,
  DeliveryAttemptStatus,
  DeliveryChannel,
  LandingPageSnapshotData,
  WebhookReconciliationStatus,
  WatchEventStatus,
  WatchEventType,
} from "~/lib/types";

// Browser-scraped cards sometimes fail to extract the advertiser name; the
// scraper stores an empty string instead of guessing (a wrong attribution is
// worse than an honest gap). Label that state explicitly wherever it renders.
export function formatAdvertiserLabel(advertiser: string | null | undefined) {
  const trimmed = advertiser?.trim();
  return trimmed ? trimmed : "Advertiser unconfirmed";
}

export function formatCaptureMethodLabel(captureMethod: CaptureMethod | null | undefined) {
  if (captureMethod === "landing_page_fetch") {
    return "Page text checked";
  }

  if (captureMethod === "browser_render") {
    return "Checked in browser";
  }

  return "Not checked yet";
}

// The anonymous /search selected pane presents evidence, not speculation.
// These helpers turn a missing field into an explicit field-specific state:
// what was checked or not checked, and what the visitor can do next. A null
// field stays unavailable — it never becomes a guess, a search term, or a
// watchlist name.
export function formatLandingPageHeadlineUnavailable(
  landingPage: Pick<LandingPageSnapshotData, "captureMethod"> | null | undefined,
) {
  return landingPage?.captureMethod
    ? "Headline not found on the checked page."
    : "Headline not read — the landing page was not checked for this ad.";
}

export function formatLandingPageUnavailableExplanation(
  landingPage: Pick<LandingPageSnapshotData, "captureMethod"> | null | undefined,
) {
  return landingPage?.captureMethod
    ? "The page was checked, but no headline appeared in what was captured. The other signals below come from that same check."
    : "The landing page was not checked for this ad, so no headline, offer, or CTA was read from the destination. Nothing here is guessed.";
}

export function formatLandingPageNextStep(input: {
  landingPageUrl: string | null | undefined;
  adSnapshotUrl: string | null | undefined;
}) {
  if (input.landingPageUrl) {
    return "Open the destination to check the current headline and offer yourself.";
  }

  if (input.adSnapshotUrl) {
    return "Open this ad in the Meta Ad Library to find its destination.";
  }

  return "Re-run this search later — a fresh result may include the destination.";
}

export function formatAdvertiserIdentityExplanation() {
  return "The advertiser name could not be read from this ad's source, so none is shown. The search term is not used as the advertiser.";
}

export function formatAdvertiserNextStep(input: {
  adSnapshotUrl: string | null | undefined;
  landingPageUrl: string | null | undefined;
}) {
  if (input.adSnapshotUrl) {
    return "Open this ad in the Meta Ad Library to see who ran it.";
  }

  if (input.landingPageUrl) {
    return "Open the destination to see who runs it.";
  }

  return "Re-run this search later — a fresh result may confirm the advertiser.";
}

export function formatLandingPageCaptureStatusLabel(input: {
  landingPageUrl: string | null | undefined;
  capturedAt: string | null | undefined;
}) {
  if (input.capturedAt) {
    const capturedAt = new Date(input.capturedAt);
    if (!Number.isNaN(capturedAt.getTime())) {
      return `Landing page checked ${capturedAt.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })}`;
    }
  }

  return input.landingPageUrl
    ? "Landing page link found — page not checked"
    : "No landing-page destination available";
}

export function formatAdCreativeTextValue(value: string | null | undefined) {
  return value?.trim() || "Not detected";
}

export function formatLandingPageSignalValue(value: string | null | undefined) {
  return value?.trim() ? value : "Not detected";
}

export function formatLandingPageFormValue(value: boolean | null | undefined) {
  if (value === true) {
    return "Yes";
  }

  if (value === false) {
    return "No";
  }

  return "Not detected";
}

export function formatAnalysisSourceLabel(source: AnalysisSource | null | undefined) {
  if (source === "ad_snapshot_fetch") {
    return "Ad snapshot";
  }

  if (source === "landing_page_fetch") {
    return "Page text";
  }

  if (source === "browser_render") {
    return "Browser check";
  }

  if (source === "meta_api") {
    return "Alternate Meta ad access";
  }

  if (source === "meta_library_browser") {
    return "Live ad check";
  }

  if (source === "ai_summary") {
    return "Summary";
  }

  if (source === "user") {
    return "Edited by user";
  }

  return "Source unavailable";
}

export function formatImportanceBandLabel(score: number | null | undefined) {
  if (typeof score !== "number") {
    return "Priority pending";
  }

  if (score >= 85) {
    return "High priority";
  }

  if (score >= 65) {
    return "Medium priority";
  }

  return "Low priority";
}

export function formatConfidenceBandLabel(
  confidence: Record<string, number> | null | undefined,
) {
  const values = Object.values(confidence ?? {}).filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return "Confidence pending";
  }

  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (average >= 0.85) {
    return "High confidence";
  }

  if (average >= 0.6) {
    return "Medium confidence";
  }

  return "Low confidence";
}

export function formatProofAgeLabel(
  timestamp: string | null | undefined,
  options: { now?: string } = {},
) {
  if (!timestamp) {
    return "No evidence yet";
  }

  const nowMs = new Date(options.now ?? new Date().toISOString()).getTime();
  const timestampMs = new Date(timestamp).getTime();
  const diffMs = Math.max(0, nowMs - timestampMs);
  const minutes = Math.floor(diffMs / (60 * 1000));

  if (minutes < 60) {
    return `${Math.max(1, minutes)}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Machine tokens (event types, statuses) must never reach the customer as
// raw snake_case. Known tokens get a curated label; unknown ones fall back
// to a sentence-cased phrase instead of "proof_pending"-style output.
export function formatMachineTokenLabel(value: string) {
  const phrase = value.replaceAll("_", " ").trim();
  return phrase ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : value;
}

// Watch event type labels live in ~/lib/watch-event-display — the single
// canonical vocabulary shared by watchlists, digests, reports, and shares.
// Re-exported here so display call sites keep one import surface.
export { formatWatchEventTypeLabel } from "~/lib/watch-event-display";

const WATCH_EVENT_STATUS_LABELS: Record<string, string> = {
  detected: "Detected",
  proof_pending: "Evidence pending",
  confirmed: "Confirmed",
  proof_failed: "Evidence check failed",
  suppressed: "Suppressed",
  invalidated: "Invalidated",
};

export function formatWatchEventStatusLabel(status: string) {
  return WATCH_EVENT_STATUS_LABELS[status] ?? formatMachineTokenLabel(status);
}

const PROOF_CAPTURE_STATUS_LABELS: Record<string, string> = {
  pending: "Evidence check pending",
  succeeded: "Evidence captured",
  failed: "Evidence check failed",
  skipped_due_to_budget: "Skipped — evidence budget reached",
  skipped_due_to_rate_limit: "Skipped — provider rate limited",
  skipped_due_to_dedupe: "Skipped — duplicate change",
};

export function formatProofCaptureStatusLabel(status: string) {
  return PROOF_CAPTURE_STATUS_LABELS[status] ?? formatMachineTokenLabel(status);
}

export function formatWhyAlertedLabel(input: {
  eventType: WatchEventType;
  status: WatchEventStatus;
  metadata: Record<string, unknown> | null | undefined;
}) {
  if (input.status === "detected" || input.status === "proof_pending") {
    return "Possible change detected. The evidence check is still running.";
  }

  const from = typeof input.metadata?.from === "string" ? input.metadata.from : null;
  const to = typeof input.metadata?.to === "string" ? input.metadata.to : null;
  const kind = typeof input.metadata?.kind === "string" ? input.metadata.kind : null;

  // WP-28: creative_copy rides headline/offer event types with structured before/after.
  if (kind === "creative_copy" && from && to) {
    return `Ad creative copy moved from ${from} to ${to}.`;
  }
  if (kind === "ad_new_aggregate") {
    const count =
      typeof input.metadata?.count === "number" && Number.isFinite(input.metadata.count)
        ? input.metadata.count
        : null;
    return count && count > 1
      ? `${count} new ads entered this watchlist in one scan.`
      : "Several new ads entered this watchlist in one scan.";
  }

  if (from && to) {
    switch (input.eventType) {
      case "landing_page_offer_changed":
        return `Offer moved from ${from} to ${to}.`;
      case "landing_page_cta_changed":
        return `CTA moved from ${from} to ${to}.`;
      case "landing_page_headline_changed":
        return `Headline moved from ${from} to ${to}.`;
      case "landing_page_url_changed":
        return `Destination moved from ${from} to ${to}.`;
      case "landing_page_form_changed":
        return `Form state moved from ${from} to ${to}.`;
      default:
        break;
    }
  }

  switch (input.eventType) {
    case "ad_new":
      return "A new ad entered this watchlist.";
    case "ad_inactive":
      return "The ad disappeared across consecutive scans.";
    case "landing_page_url_changed":
      return "The destination changed and forced an evidence refresh.";
    default:
      return "Source-backed change cleared the alert threshold.";
  }
}

export function formatDeliveryAttemptStatusLabel(
  status: DeliveryAttemptStatus,
  channel: DeliveryChannel,
  webhookStatus: WebhookReconciliationStatus | null = null,
) {
  if (status === "sent") {
    return webhookStatus === "delivered" ? "Delivered" : "Delivery unconfirmed";
  }

  if (status === "failed") {
    if (channel === "email") return "Email failed";
    if (channel === "slack") return "Slack failed";
    return "WhatsApp failed";
  }

  if (status === "skipped_due_to_quiet_hours") {
    return "Deferred by quiet hours";
  }

  if (status === "skipped_due_to_dedupe") {
    return "Already batched";
  }

  return "Send pending";
}
