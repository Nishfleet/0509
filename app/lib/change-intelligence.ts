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

/* ============================================================================
   Digest accountability vocabulary (2026-08-08, named-owner materiality E2).

   Every customer-facing digest/brief surface — the app route and the email
   renderer — reads the same truthful values from here so app and email never
   diverge: a non-empty materiality reason, exactly one accountable reviewer
   (or an explicit visible failure state when no trusted identity is
   available), and one next action. Identity is NEVER taken from event text:
   only the workspace owner label, the recipient name, or the explicit
   "Workspace owner" role fallback may name the reviewer. Missing identity
   stays visible as a failure, never as a silent generic digest.
   ========================================================================== */

/** Role fallback the product contract supports wherever an owner exists. */
export const DIGEST_WORKSPACE_OWNER_ROLE_LABEL = "Workspace owner";

/** Shown as the reviewer value when no trusted identity is available. */
export const DIGEST_REVIEWER_MISSING_LABEL = "Reviewer not recorded";

/** Explicit failure-state copy rendered beside the missing label. */
export const DIGEST_REVIEWER_MISSING_COPY =
  "No accountable owner could be confirmed for this workspace. Contact support before relying on this brief.";

export interface DigestAccountabilityItem {
  eventType?: string | null;
  watchlistName?: string | null;
}

export interface DigestAccountabilityTriageInput {
  status: string;
  explanation: string;
  nextAction: string;
}

export interface DigestAccountabilityReasonInput {
  items: readonly DigestAccountabilityItem[];
  triage?: DigestAccountabilityTriageInput | null;
}

export interface DigestAccountabilityReason {
  /** Non-empty, human-readable reason the period matters (or does not). */
  materialityReason: string;
  /** Non-empty, human-readable single next action. */
  nextAction: string;
}

export interface DigestReviewerResolution {
  label: string;
  /** True only when no trusted identity and no role fallback were available. */
  missing: boolean;
}

const DIGEST_EVENT_BUCKETS: Record<string, string> = {
  landing_page_offer_changed: "pricing",
  landing_page_cta_changed: "cta",
  landing_page_headline_changed: "headline",
  landing_page_url_changed: "destination",
  landing_page_form_changed: "form",
  ad_new: "ad_new",
  ad_inactive: "ad_inactive",
};

const DIGEST_BUCKET_LABELS: Record<string, string> = {
  pricing: "pricing or offer change",
  cta: "CTA change",
  headline: "headline change",
  destination: "destination change",
  form: "form change",
  ad_new: "new ad",
  ad_inactive: "paused ad",
  other: "other change",
};

// Why a bucket matters, grounded in what actually changed this period. Same
// claim family as the per-event recommended actions — never invented numbers.
const DIGEST_BUCKET_WHY: Record<string, string> = {
  pricing: "Pricing and offer moves change the buying decision directly.",
  cta: "CTA rewrites show where the competitor is pushing next.",
  headline: "Headline changes signal a positioning shift.",
  destination: "Destination changes redirect where the competitor sends traffic.",
  form: "Form changes alter how the competitor captures leads.",
  ad_new: "New ads show where the competitor is spending attention.",
  ad_inactive: "Paused ads signal a campaign or budget shift.",
};

// Deterministic tie-break order for equal-count buckets: the most material
// kind leads the composed reason (pricing before CTA before cosmetic).
const DIGEST_BUCKET_RANK: Record<string, number> = {
  pricing: 0,
  cta: 1,
  headline: 2,
  destination: 3,
  form: 4,
  ad_new: 5,
  ad_inactive: 6,
  other: 7,
};

/**
 * The period's materiality reason and single next action. Triage periods
 * (all-quiet, evidence-failed, evidence-pending, routine-only, not-run) use
 * the persisted triage vocabulary verbatim so every surface tells the same
 * story; changed periods compose a factual bucket summary from the actual
 * items. Always returns non-empty strings.
 */
export function buildDigestAccountabilityReason(
  input: DigestAccountabilityReasonInput,
): DigestAccountabilityReason {
  if (input.items.length === 0) {
    if (input.triage) {
      return {
        materialityReason: reasonString(
          input.triage.explanation,
          "No summary is available for this period.",
        ),
        nextAction: reasonString(
          input.triage.nextAction,
          "Review the changes in your brief.",
        ),
      };
    }
    return {
      materialityReason: "No changes were filed in this period.",
      nextAction: "We check again at the next scheduled scan.",
    };
  }

  const counts = new Map<string, number>();
  for (const item of input.items) {
    const bucket = digestEventBucket(item.eventType);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort(
    (a, b) =>
      b[1] - a[1] ||
      (DIGEST_BUCKET_RANK[a[0]] ?? 7) - (DIGEST_BUCKET_RANK[b[0]] ?? 7),
  );
  const kinds = ranked
    .map(
      ([bucket, count]) =>
        `${count} ${pluralize(DIGEST_BUCKET_LABELS[bucket], count)}`,
    )
    .join(", ");
  const competitorCount = new Set(
    input.items
      .map((item) => item.watchlistName?.trim())
      .filter((name): name is string => Boolean(name)),
  ).size;
  const across =
    competitorCount > 0
      ? ` across ${competitorCount} competitor${competitorCount === 1 ? "" : "s"}`
      : "";
  const leadBucket = ranked[0]?.[0];
  const why = leadBucket ? DIGEST_BUCKET_WHY[leadBucket] : null;
  return {
    materialityReason: [
      `${input.items.length} change${input.items.length === 1 ? "" : "s"}${across}: ${kinds}.`,
      why,
    ]
      .filter(Boolean)
      .join(" "),
    nextAction: "Review the changes in your brief.",
  };
}

/**
 * Resolve the accountable reviewer from trusted identity only: an explicit
 * owner label wins, then the recipient name, then the caller's role fallback
 * ("Workspace owner" on app surfaces). With none of the three, the result is
 * the explicit missing/failure state.
 */
export function resolveDigestReviewer(input: {
  ownerLabel?: string | null;
  recipientName?: string | null;
  roleFallback?: string | null;
}): DigestReviewerResolution {
  const named = input.ownerLabel?.trim() || input.recipientName?.trim() || "";
  if (named) {
    return { label: named, missing: false };
  }
  const role = input.roleFallback?.trim();
  if (role) {
    return { label: role, missing: false };
  }
  return { label: DIGEST_REVIEWER_MISSING_LABEL, missing: true };
}

function digestEventBucket(eventType: string | null | undefined) {
  return (eventType && DIGEST_EVENT_BUCKETS[eventType]) || "other";
}

function pluralize(label: string, count: number) {
  return count === 1 ? label : `${label}s`;
}

function reasonString(value: string | null | undefined, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
