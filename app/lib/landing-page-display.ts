import type {
  AnalysisSource,
  CaptureMethod,
  DeliveryAttemptStatus,
  DeliveryChannel,
  WatchEventStatus,
  WatchEventType,
} from "~/lib/types";

export function formatCaptureMethodLabel(captureMethod: CaptureMethod | null | undefined) {
  if (captureMethod === "landing_page_fetch") {
    return "Fetch capture";
  }

  if (captureMethod === "browser_render") {
    return "Browser-rendered";
  }

  return "Capture unavailable";
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
    return "Ad snapshot fetch";
  }

  if (source === "landing_page_fetch") {
    return "Fetch capture";
  }

  if (source === "browser_render") {
    return "Browser-rendered";
  }

  if (source === "meta_api") {
    return "Meta API";
  }

  if (source === "ai_summary") {
    return "AI summary";
  }

  if (source === "user") {
    return "Manual";
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
    return "No proof yet";
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

export function formatWhyAlertedLabel(input: {
  eventType: WatchEventType;
  status: WatchEventStatus;
  metadata: Record<string, unknown> | null | undefined;
}) {
  if (input.status === "detected" || input.status === "proof_pending") {
    return "Possible change detected. Proof is still running.";
  }

  const from = typeof input.metadata?.from === "string" ? input.metadata.from : null;
  const to = typeof input.metadata?.to === "string" ? input.metadata.to : null;

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
      return "The destination changed and forced a proof refresh.";
    default:
      return "Proof-backed change cleared the alert threshold.";
  }
}

export function formatDeliveryAttemptStatusLabel(
  status: DeliveryAttemptStatus,
  channel: DeliveryChannel,
) {
  if (status === "sent") {
    return channel === "email" ? "Delivered by email" : "Delivered by WhatsApp";
  }

  if (status === "failed") {
    return channel === "email" ? "Email failed" : "WhatsApp failed";
  }

  if (status === "skipped_due_to_quiet_hours") {
    return "Deferred by quiet hours";
  }

  if (status === "skipped_due_to_dedupe") {
    return "Already batched";
  }

  return "Send pending";
}
