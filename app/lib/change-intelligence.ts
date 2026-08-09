import { safeTimeZone } from "~/lib/safe-timezone";
import type { AdRecord, AnalysisFieldInput, WatchEventRecord, WatchEventType } from "~/lib/types";

export type DigestCadence = "daily" | "weekly";

export interface ChangeIntelligenceSummary {
  priorityScore: number | null;
  priorityBand: string;
  recommendedAction: string;
  proofTrail: string;
}

type DigestAdEnrichment = Pick<AdRecord, "creativeImageUrl" | "analysisFields">;

export function digestCadenceLabel(cadence: DigestCadence | undefined) {
  return cadence === "daily" ? "daily brief" : "weekly digest";
}

/*
 * Period truth for a monitoring brief (E2 increment, 2026-08-08): every
 * customer-facing brief/digest must carry a materiality reason, exactly one
 * accountable reviewer (or the explicit workspace owner), and one next
 * action — or an explicit visible failure state. These helpers are the shared
 * vocabulary: the digest email renderer and the authenticated briefs route
 * read the same copy so app and email never diverge. The reviewer identity is
 * never invented from event text: callers pass the already-available
 * workspace owner/recipient identity, and the truthful fallback "Workspace
 * owner" only applies where the product contract supports it (digests are
 * filed under the workspace owner's account).
 */

/** Truthful explicit fallback where the product contract supports it. */
export const DIGEST_REVIEWER_FALLBACK = "Workspace owner";

/** Explicit failure state: no owner identity and no contract fallback applies. */
export const DIGEST_REVIEWER_UNAVAILABLE =
  "Reviewer not recorded — no workspace owner identity is on file.";

/** Explicit failure state: the period's materiality cannot be judged. */
export const DIGEST_MATERIALITY_UNAVAILABLE =
  "No materiality record for this period — treat this brief as unverified until a fresh check files a record.";

/** Explicit failure state: no truthful next action can be stated. */
export const DIGEST_NEXT_ACTION_UNAVAILABLE =
  "Contact support — this brief is missing its period record and cannot be reviewed as filed.";

export interface DigestPeriodTruthItem {
  eventType?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface DigestPeriodTruthInput {
  items?: ReadonlyArray<DigestPeriodTruthItem> | null;
  heartbeat?: {
    runs?: number;
    watchlistsChecked?: number;
    adsSeen?: number;
  } | null;
  triage?: {
    status?: string | null;
    explanation?: string | null;
    nextAction?: string | null;
  } | null;
}

/**
 * Exactly one accountable reviewer per brief: the workspace owner/recipient
 * name when one is known, else the truthful "Workspace owner" fallback.
 * Callers that hold no identity at all render {@link DIGEST_REVIEWER_UNAVAILABLE}
 * as the explicit failure state instead.
 */
export function digestReviewerLabel(name?: string | null): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed ? trimmed : DIGEST_REVIEWER_FALLBACK;
}

/**
 * Non-empty, human-readable materiality reason for a digest period. The
 * shared triage explanation wins for quiet/failed/routine periods; changed
 * periods are derived from the filed events (never invented); legacy quiet
 * heartbeats state the completed-check facts; and a period with no record at
 * all renders the explicit failure state so a generic digest is never sent
 * silently.
 */
export function digestMaterialityReason(input: DigestPeriodTruthInput): string {
  const triage = input.triage ?? null;
  const triageExplanation = triage?.explanation?.trim();
  // The shared triage vocabulary is the most specific truthful statement for
  // every non-changed period (all-quiet, routine-only, evidence-failed,
  // evidence-pending, not-run). Changed periods carry items, whose derivation
  // below is more specific than the generic "changes confirmed" line.
  if (
    triageExplanation &&
    triage?.status &&
    triage.status !== "changed"
  ) {
    return triageExplanation;
  }

  const items = input.items ?? [];
  if (items.length > 0) {
    return materialityFromItems(items);
  }

  const heartbeat = input.heartbeat ?? null;
  if (heartbeat && (heartbeat.runs ?? 0) > 0) {
    const watchlists = heartbeat.watchlistsChecked ?? 0;
    const runs = heartbeat.runs ?? 0;
    const adsSeen = heartbeat.adsSeen ?? 0;
    return `No action-worthy movement across ${watchlists} competitor${watchlists === 1 ? "" : "s"} — ${runs} check${runs === 1 ? "" : "s"} completed and ${adsSeen} ad${adsSeen === 1 ? "" : "s"} reviewed.`;
  }

  return DIGEST_MATERIALITY_UNAVAILABLE;
}

/** One next action per brief: shared triage copy first, then derived copy. */
export function digestNextAction(input: DigestPeriodTruthInput): string {
  const triageNextAction = input.triage?.nextAction?.trim();
  if (triageNextAction) {
    return triageNextAction;
  }

  const items = input.items ?? [];
  if (items.length > 0) {
    return "Review the changes in this brief before your next campaign decision.";
  }

  const heartbeat = input.heartbeat ?? null;
  if (heartbeat && (heartbeat.runs ?? 0) > 0) {
    return "We check again at the next scheduled scan.";
  }

  return DIGEST_NEXT_ACTION_UNAVAILABLE;
}

type DigestPeriodEventClass =
  | "price"
  | "cta"
  | "campaign"
  | "destination"
  | "cosmetic"
  | "unclassified";

const PRICE_EVENT_TYPES = new Set(["landing_page_offer_changed"]);
const CTA_EVENT_TYPES = new Set(["landing_page_cta_changed"]);
const CAMPAIGN_EVENT_TYPES = new Set(["ad_new", "ad_inactive"]);
const DESTINATION_EVENT_TYPES = new Set(["landing_page_url_changed"]);
const COSMETIC_EVENT_TYPES = new Set([
  "landing_page_headline_changed",
  "landing_page_form_changed",
]);

function classifyDigestPeriodEvent(item: DigestPeriodTruthItem): DigestPeriodEventClass {
  const kind = (item.metadata as Record<string, unknown> | undefined)?.kind;
  if (kind === "baseline" || kind === "creative_copy") {
    // Baselines are starting snapshots; creative copy rewrites are cosmetic
    // until they touch an offer, CTA, or campaign state.
    return "cosmetic";
  }
  if (kind === "ad_new_aggregate") {
    return "campaign";
  }
  if (PRICE_EVENT_TYPES.has(item.eventType ?? "")) return "price";
  if (CTA_EVENT_TYPES.has(item.eventType ?? "")) return "cta";
  if (CAMPAIGN_EVENT_TYPES.has(item.eventType ?? "")) return "campaign";
  if (DESTINATION_EVENT_TYPES.has(item.eventType ?? "")) return "destination";
  if (COSMETIC_EVENT_TYPES.has(item.eventType ?? "")) return "cosmetic";
  return "unclassified";
}

function materialityFromItems(items: ReadonlyArray<DigestPeriodTruthItem>): string {
  const counts = new Map<DigestPeriodEventClass, number>();
  for (const item of items) {
    const eventClass = classifyDigestPeriodEvent(item);
    counts.set(eventClass, (counts.get(eventClass) ?? 0) + 1);
  }

  const materialClauses: string[] = [];
  const priceCount = counts.get("price") ?? 0;
  if (priceCount > 0) {
    materialClauses.push(`pricing or offers moved (${priceCount} change${priceCount === 1 ? "" : "s"})`);
  }
  const ctaCount = counts.get("cta") ?? 0;
  if (ctaCount > 0) {
    materialClauses.push(`landing page CTA${ctaCount === 1 ? "" : "s"} changed (${ctaCount})`);
  }
  const campaignCount = counts.get("campaign") ?? 0;
  if (campaignCount > 0) {
    materialClauses.push(`ads started or stopped (${campaignCount})`);
  }
  const destinationCount = counts.get("destination") ?? 0;
  if (destinationCount > 0) {
    materialClauses.push(`destinations changed (${destinationCount})`);
  }

  if (materialClauses.length > 0) {
    return `This period matters because ${materialClauses.join(" and ")} — compare before your next campaign decision.`;
  }

  const cosmeticCount = counts.get("cosmetic") ?? 0;
  const unclassifiedCount = counts.get("unclassified") ?? 0;
  if (cosmeticCount > 0 && unclassifiedCount === 0) {
    return `Cosmetic-only changes this period (${cosmeticCount} headline, form, or creative update${cosmeticCount === 1 ? "" : "s"}) — no pricing or CTA movement, so there is nothing new to weigh for positioning.`;
  }
  if (cosmeticCount > 0) {
    return `${cosmeticCount + unclassifiedCount} change${cosmeticCount + unclassifiedCount === 1 ? "" : "s"} filed this period — headlines, forms, or creatives moved without pricing or CTA movement.`;
  }
  return `${items.length} change${items.length === 1 ? "" : "s"} filed this period — review the evidence before your next decision.`;
}

// Proof-trail timestamps default to UTC (global-first product); pass the
// workspace's delivery timezone when one is available at the call site.
export function buildChangeIntelligenceSummary(
  event: Pick<
    WatchEventRecord,
    "eventType" | "importanceScore" | "metadata" | "proofCaptureId" | "confirmedAt" | "createdAt"
  >,
  timeZone?: string | null,
): ChangeIntelligenceSummary {
  const priorityScore = Number.isFinite(event.importanceScore)
    ? event.importanceScore
    : null;

  // Baseline-capture events (first scan) ride the ad_new type because the
  // watch_event CHECK constraint pins the type list; metadata.kind marks them.
  const kind = (event.metadata as Record<string, unknown> | undefined)?.kind;
  const isBaseline = kind === "baseline";
  const isCreativeCopy = kind === "creative_copy";
  const isNewAdAggregate = kind === "ad_new_aggregate";

  return {
    priorityScore,
    priorityBand: isBaseline ? "Baseline" : formatPriorityBand(priorityScore),
    recommendedAction: isBaseline
      ? "No action needed — this is your starting snapshot. Future alerts only cover real changes."
      : isCreativeCopy
        ? recommendCreativeCopyAction(priorityScore)
        : isNewAdAggregate
          ? recommendAction("ad_new", priorityScore)
          : recommendAction(event.eventType, priorityScore),
    proofTrail: buildProofTrail(event, timeZone),
  };
}

function recommendCreativeCopyAction(priorityScore: number | null) {
  const urgency =
    priorityScore !== null && priorityScore >= 85
      ? "Today: "
      : priorityScore !== null && priorityScore >= 65
        ? "Next review: "
        : "";
  return `${urgency}compare the rewritten hook and offer to your live creatives before matching their angle.`;
}

export function digestMetadataForEvent(
  event: WatchEventRecord,
  timeZone?: string | null,
  ad?: DigestAdEnrichment | null,
) {
  return {
    ...buildChangeIntelligenceSummary(event, timeZone),
    ...digestSourceMetadata(event.metadata),
    ...digestDiffMetadata(event.metadata),
    ...digestCreativeMetadata(event.metadata, ad),
    ...digestMetricMetadata(event.metadata, ad),
    proofCaptureId: event.proofCaptureId,
    confirmedAt: event.confirmedAt,
    createdAt: event.createdAt,
    eventStatus: event.status,
    sourceStatus: event.proofCaptureId ? "proof_backed" : "scan_backed",
    ...(event.adId ? { adId: event.adId } : {}),
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
    proofTrail: stringOr(candidate.proofTrail, "Source trail pending"),
  };
}

function fallbackDigestIntelligence(): ChangeIntelligenceSummary {
  return {
    priorityScore: null,
    priorityBand: "Priority pending",
    recommendedAction: "Review the source evidence before acting.",
    proofTrail: "Source trail pending",
  };
}

function digestSourceMetadata(metadata: Record<string, unknown> | undefined) {
  const sourceKeys = [
    "sourceUrl",
    "proofUrl",
    "landingPageUrl",
    "websiteUrl",
    "websiteProofUrl",
    "canonicalUrl",
    "capturedAt",
    "beforeCapturedAt",
  ];
  const result: Record<string, string> = {};
  const source = metadata ?? {};
  for (const key of sourceKeys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      result[key] = value.trim();
    }
  }
  return result;
}

function digestDiffMetadata(metadata: Record<string, unknown> | undefined) {
  const result: Record<string, string> = {};
  const from = stringOr(metadata?.from, null);
  const to = stringOr(metadata?.to, null);
  if (from) result.from = from;
  if (to) result.to = to;
  return result;
}

function digestCreativeMetadata(
  metadata: Record<string, unknown> | undefined,
  ad?: DigestAdEnrichment | null,
) {
  const result: Record<string, string> = {};
  const creativeImageUrl =
    safeHttpsImageUrl(ad?.creativeImageUrl) ??
    safeHttpsImageUrl(metadata?.creativeImageUrl);
  const beforeCreativeImageUrl =
    safeHttpsImageUrl(metadata?.beforeCreativeImageUrl) ??
    safeHttpsImageUrl(metadata?.fromCreativeImageUrl);
  const afterCreativeImageUrl =
    safeHttpsImageUrl(metadata?.afterCreativeImageUrl) ??
    safeHttpsImageUrl(metadata?.toCreativeImageUrl) ??
    (beforeCreativeImageUrl ? creativeImageUrl : null);

  if (creativeImageUrl) result.creativeImageUrl = creativeImageUrl;
  if (beforeCreativeImageUrl) result.beforeCreativeImageUrl = beforeCreativeImageUrl;
  if (afterCreativeImageUrl) result.afterCreativeImageUrl = afterCreativeImageUrl;
  return result;
}

function digestMetricMetadata(
  metadata: Record<string, unknown> | undefined,
  ad?: DigestAdEnrichment | null,
) {
  const fromAd = readObservedMetricsFromAd(ad);
  const result: Record<string, string> = {};
  const spend =
    stringOr(metadata?.observedSpend, null) ??
    stringOr(metadata?.spend, null) ??
    fromAd.spend;
  const impressions =
    stringOr(metadata?.observedImpressions, null) ??
    stringOr(metadata?.impressions, null) ??
    fromAd.impressions;
  const reach =
    stringOr(metadata?.observedReach, null) ??
    stringOr(metadata?.reach, null) ??
    fromAd.reach;

  if (spend) result.observedSpend = spend;
  if (impressions) result.observedImpressions = impressions;
  if (reach) result.observedReach = reach;
  return result;
}

function readObservedMetricsFromAd(ad?: DigestAdEnrichment | null) {
  const metrics = { spend: null as string | null, impressions: null as string | null, reach: null as string | null };
  for (const field of normalizeAnalysisFields(ad?.analysisFields)) {
    if (!field.fieldValue.trim()) continue;
    if (field.fieldKey === "observed_spend") metrics.spend = field.fieldValue.trim();
    if (field.fieldKey === "observed_impressions") metrics.impressions = field.fieldValue.trim();
    if (field.fieldKey === "observed_reach") metrics.reach = field.fieldValue.trim();
  }
  return metrics;
}

function normalizeAnalysisFields(value: unknown): AnalysisFieldInput[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is AnalysisFieldInput =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as AnalysisFieldInput).fieldKey === "string" &&
          typeof (item as AnalysisFieldInput).fieldValue === "string",
      )
    : [];
}

export function safeHttpsImageUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !/^https:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
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
  timeZone?: string | null,
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
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: safeTimeZone(timeZone),
        timeZoneName: "short",
      }).format(new Date(timestampMs))
    : "time unknown";

  return `${source} · ${when}${diff}`;
}

function stringOr(value: unknown, fallback: string): string;
function stringOr(value: unknown, fallback: null): string | null;
function stringOr(value: unknown, fallback: string | null) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
