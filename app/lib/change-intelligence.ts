import type { WatchEventRecord, WatchEventType } from "~/lib/types";

export type DigestCadence = "daily" | "weekly";

export interface ChangeIntelligenceSummary {
  priorityScore: number | null;
  priorityBand: string;
  recommendedAction: string;
  proofTrail: string;
}

export function digestCadenceLabel(cadence: DigestCadence | undefined) {
  return cadence === "daily" ? "daily brief" : "weekly digest";
}

export function buildChangeIntelligenceSummary(
  event: Pick<
    WatchEventRecord,
    "eventType" | "importanceScore" | "metadata" | "proofCaptureId" | "confirmedAt" | "createdAt"
  >,
): ChangeIntelligenceSummary {
  const priorityScore = Number.isFinite(event.importanceScore)
    ? event.importanceScore
    : null;

  // Baseline-capture events (first scan) ride the ad_new type because the
  // watch_event CHECK constraint pins the type list; metadata.kind marks them.
  const isBaseline =
    (event.metadata as Record<string, unknown> | undefined)?.kind === "baseline";

  return {
    priorityScore,
    priorityBand: isBaseline ? "Baseline" : formatPriorityBand(priorityScore),
    recommendedAction: isBaseline
      ? "No action needed — this is your starting snapshot. Future alerts only cover real changes."
      : recommendAction(event.eventType, priorityScore),
    proofTrail: buildProofTrail(event),
  };
}

export function digestMetadataForEvent(event: WatchEventRecord) {
  return {
    ...buildChangeIntelligenceSummary(event),
    proofCaptureId: event.proofCaptureId,
    confirmedAt: event.confirmedAt,
    sourceStatus: event.proofCaptureId ? "proof_backed" : "scan_backed",
  };
}

export function readDigestIntelligence(metadata: unknown): ChangeIntelligenceSummary {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return fallbackDigestIntelligence();
  }

  const candidate = metadata as Record<string, unknown>;
  return {
    priorityScore: typeof candidate.priorityScore === "number" ? candidate.priorityScore : null,
    priorityBand: stringOr(candidate.priorityBand, "Priority pending"),
    recommendedAction: stringOr(candidate.recommendedAction, "Review the source evidence before acting."),
    proofTrail: stringOr(candidate.proofTrail, "Proof trail pending"),
  };
}

function fallbackDigestIntelligence(): ChangeIntelligenceSummary {
  return {
    priorityScore: null,
    priorityBand: "Priority pending",
    recommendedAction: "Review the source evidence before acting.",
    proofTrail: "Proof trail pending",
  };
}

function formatPriorityBand(score: number | null) {
  if (score === null) {
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

function recommendAction(eventType: WatchEventType, priorityScore: number | null) {
  const urgency = priorityScore !== null && priorityScore >= 85
    ? "Today: "
    : priorityScore !== null && priorityScore >= 65
      ? "Next review: "
      : "";

  switch (eventType) {
    case "ad_new":
      return `${urgency}review the new creative, hook, offer, and destination before the next campaign decision.`;
    case "ad_inactive":
      return `${urgency}check whether the competitor ended a campaign, rotated budget, or replaced the offer.`;
    case "landing_page_url_changed":
      return `${urgency}open the new destination and compare the funnel, product angle, and tracking path.`;
    case "landing_page_headline_changed":
      return `${urgency}compare the new positioning against your current landing-page promise.`;
    case "landing_page_offer_changed":
      return `${urgency}review pricing, discount, COD, and bundle pressure before changing your own offer.`;
    case "landing_page_cta_changed":
      return `${urgency}check whether the competitor is pushing purchase, lead capture, WhatsApp, or app install harder.`;
    case "landing_page_form_changed":
      return `${urgency}review whether the competitor added or removed a lead-capture step.`;
    default:
      return `${urgency}review the source evidence before acting.`;
  }
}

function buildProofTrail(
  event: Pick<WatchEventRecord, "metadata" | "proofCaptureId" | "confirmedAt" | "createdAt">,
) {
  const timestamp = event.confirmedAt ?? event.createdAt;
  // Customer language, not pipeline language: "proof capture · source-backed
  // · 12/6/2026, 4:00:00 am" read like an engine log inside a client email.
  const source = event.proofCaptureId
    ? "Verified from a page snapshot"
    : "Spotted in the scheduled scan";
  const from = stringOr((event.metadata as Record<string, unknown> | undefined)?.from, null);
  const to = stringOr((event.metadata as Record<string, unknown> | undefined)?.to, null);
  const diff = from && to ? ` · "${from}" → "${to}"` : "";
  const timestampMs = Date.parse(timestamp ?? "");
  const when = Number.isFinite(timestampMs)
    ? `${new Intl.DateTimeFormat("en-IN", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: "Asia/Kolkata",
      }).format(new Date(timestampMs))} IST`
    : "time unknown";

  return `${source} · ${when}${diff}`;
}

function stringOr(value: unknown, fallback: string): string;
function stringOr(value: unknown, fallback: null): string | null;
function stringOr(value: unknown, fallback: string | null) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
