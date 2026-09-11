import type { WatchEventType } from "~/lib/types";

// BET 1 — the brief's headline items are the five landing_page_* commercial-
// field change types. Creative churn (ad_new / ad_inactive) never headlines:
// it collapses into a single counted footnote line. The "why this matters"
// score weights offer/price changes above creative churn so the highest-value
// change is always the brief's lead.
export const LANDING_PAGE_HEADLINE_EVENT_TYPES = [
  "landing_page_offer_changed",
  "landing_page_cta_changed",
  "landing_page_url_changed",
  "landing_page_headline_changed",
  "landing_page_form_changed",
] as const;

export const AD_CHURN_EVENT_TYPES = ["ad_new", "ad_inactive"] as const;

/**
 * Full-Site Watch website page events. These are decision candidates (they
 * rank in the digest's `other` stream and, once importance-gated, can fire an
 * instant alert) but they are NOT landing-page headline types and NOT ad
 * churn — they carry no why-this-matters type weight, so their score is the
 * raw importance component.
 */
export const WEBSITE_PAGE_EVENT_TYPES = [
	"website_page_added",
	"website_page_removed",
	"website_page_changed",
] as const;

/**
 * Customer importance for emitted website_page_* events. The single source of
 * truth for the evaluator path (watch-event-evaluator.server.ts
 * BASE_IMPORTANCE_BY_EVENT) so the base values can never drift. These clear
 * the balanced instant-alert gate (75) so a real page change reaches the
 * customer, while staying below the quiet-mode gate (90) so a quiet workspace
 * is not spammed by page churn.
 */
export const WEBSITE_PAGE_EVENT_IMPORTANCE: Partial<
	Record<WatchEventType, number>
> = {
	website_page_added: 80,
	website_page_removed: 80,
	website_page_changed: 82,
};

const HEADLINE_TYPE_SET = new Set<string>(LANDING_PAGE_HEADLINE_EVENT_TYPES);
const AD_CHURN_SET = new Set<string>(AD_CHURN_EVENT_TYPES);
const WEBSITE_PAGE_SET = new Set<string>(WEBSITE_PAGE_EVENT_TYPES);

// Offer/price > CTA > destination > headline > form. Within a type, the
// existing priorityScore (importance) breaks ties so a proof-backed high-
// importance change still leads a low-importance one of the same kind. The
// weights sit well above any priorityScore (0–100) so type always dominates
// ordering, and a high-importance form change can never leapfrog a low-
// importance offer change.
const WHY_THIS_MATTERS_TYPE_WEIGHT: Record<string, number> = {
  landing_page_offer_changed: 1000,
  landing_page_cta_changed: 800,
  landing_page_url_changed: 700,
  landing_page_headline_changed: 600,
  landing_page_form_changed: 500,
};

export interface DigestRerankItem {
  eventType?: string;
  metadata?: Record<string, unknown>;
}

export interface AdChurnSummary {
  newCount: number;
  retiredCount: number;
  total: number;
  /**
   * Issue #2151 (re-scoped): the largest stored variantCount among the new
   * ads, when any new ad is actually testing variants (count > 1). Null when
   * no new ad carries a variant split, so the footnote never fabricates a
   * figure. The impressions-bucket arm was dropped (#2148: Meta does not
   * publish impression-range buckets on logged-out commercial cards).
   */
  maxNewVariantCount: number | null;
}

export interface DigestBriefRerank<T extends DigestRerankItem> {
  /** Landing-page commercial-field changes, sorted by why-this-matters score. */
  headlineItems: T[];
  /** ad_new / ad_inactive counts, surfaced as a single counted footnote. */
  adChurnSummary: AdChurnSummary;
  /** Decision-candidate items outside the headline/churn split, score-ordered. */
  otherItems: T[];
}

function readPriorityScore(item: DigestRerankItem): number {
  const value = item.metadata?.priorityScore;
  return typeof value === "number" && Number.isFinite(value) ? value : -1;
}

export function whyThisMattersScore(item: DigestRerankItem): number {
  const weight = WHY_THIS_MATTERS_TYPE_WEIGHT[item.eventType ?? ""] ?? 0;
  return weight + readPriorityScore(item);
}

/**
 * Why-this-matters score for a live watch event (WatchEventRecord): the same
 * type weight that leads the brief plus the record's 0-100 importance score —
 * the priority component digest items carry as metadata.priorityScore. A
 * missing or non-finite importance contributes -1 so an unscored record never
 * clears a positive gate.
 */
export function whyThisMattersScoreForRecord(input: {
  eventType?: string;
  importanceScore?: number;
}): number {
  const importance = input.importanceScore;
  return whyThisMattersScore({
    eventType: input.eventType,
    metadata:
      typeof importance === "number" && Number.isFinite(importance)
        ? { priorityScore: importance }
        : undefined,
  });
}

/** The type weight of a landing-page headline event (0 for everything else). */
export function landingPageTypeWeight(eventType?: string): number {
  return WHY_THIS_MATTERS_TYPE_WEIGHT[eventType ?? ""] ?? 0;
}

export function isAdChurnEventType(eventType?: string): eventType is WatchEventType {
  return !!eventType && AD_CHURN_SET.has(eventType);
}

export function isLandingPageHeadlineEventType(eventType?: string): eventType is WatchEventType {
  return !!eventType && HEADLINE_TYPE_SET.has(eventType);
}

/** True for the three website_page_* event types. */
export function isWebsitePageEventType(
  eventType?: string,
): eventType is WatchEventType {
  return !!eventType && WEBSITE_PAGE_SET.has(eventType);
}

function stableKey(item: DigestRerankItem, index: number): string {
  const eventId = item.metadata?.eventId;
  if (typeof eventId === "string" && eventId.trim()) {
    return eventId.trim();
  }
  const id = (item as { eventId?: string }).eventId;
  if (typeof id === "string" && id.trim()) {
    return id.trim();
  }
  return `index:${index}`;
}

function compareByScore<T extends DigestRerankItem>(
  a: { item: T; index: number },
  b: { item: T; index: number },
) {
  return (
    whyThisMattersScore(b.item) - whyThisMattersScore(a.item) ||
    stableKey(a.item, a.index).localeCompare(stableKey(b.item, b.index)) ||
    a.index - b.index
  );
}

/**
 * Splits a digest's decision-candidate items into headline commercial-field
 * changes, counted creative churn, and any remaining items. Headline items
 * are ordered by the why-this-matters score (offer/price leads); churn never
 * ranks and is returned only as a count for the footnote.
 */
export function rerankDigestBrief<T extends DigestRerankItem>(
  items: readonly T[],
): DigestBriefRerank<T> {
  const headline: { item: T; index: number }[] = [];
  const other: { item: T; index: number }[] = [];
  let newCount = 0;
  let retiredCount = 0;
  let maxNewVariantCount: number | null = null;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (isAdChurnEventType(item.eventType)) {
      if (item.eventType === "ad_new") {
        newCount += 1;
        const variantCount = readVariantCount(item.metadata);
        if (variantCount !== null && variantCount > 1) {
          maxNewVariantCount =
            maxNewVariantCount === null
              ? variantCount
              : Math.max(maxNewVariantCount, variantCount);
        }
      } else if (item.eventType === "ad_inactive") {
        retiredCount += 1;
      }
      continue;
    }
    if (isLandingPageHeadlineEventType(item.eventType)) {
      headline.push({ item, index: i });
    } else {
      other.push({ item, index: i });
    }
  }

  headline.sort(compareByScore);
  other.sort(compareByScore);

  return {
    headlineItems: headline.map((entry) => entry.item),
    adChurnSummary: {
      newCount,
      retiredCount,
      total: newCount + retiredCount,
      maxNewVariantCount,
    },
    otherItems: other.map((entry) => entry.item),
  };
}

/**
 * Read the stored variantCount from an item's metadata. Accepts a number or
 * a numeric string; returns null when absent or not a positive integer, so
 * the caller never emits a fabricated figure.
 */
function readVariantCount(metadata: Record<string, unknown> | undefined): number | null {
  const raw = metadata?.variantCount;
  const count = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(count) || count <= 1) {
    return null;
  }
  return count;
}

/**
 * The single counted line creative churn collapses into, e.g.
 * "3 new creatives, 2 retired — open the wall to see them." Returns null when
 * there is no churn, so callers can render nothing rather than an empty line.
 */
/**
 * Counted churn phrase without the trailing wall call-to-action, e.g.
 * "3 new creatives, 2 retired". Returns null when there is no churn.
 */
export function adChurnCountsLabel(summary: AdChurnSummary): string | null {
  if (summary.total === 0) {
    return null;
  }
  const parts: string[] = [];
  if (summary.newCount > 0) {
    parts.push(
      `${summary.newCount} new creative${summary.newCount === 1 ? "" : "s"}`,
    );
  }
  if (summary.retiredCount > 0) {
    parts.push(`${summary.retiredCount} retired`);
  }
  return parts.join(", ");
}

/**
 * Full counted churn phrase including the ×N versions arm, e.g.
 * "1 new creative, as 4 versions". Returns null when there is no churn.
 */
export function adChurnLineLabel(summary: AdChurnSummary): string | null {
  const counts = adChurnCountsLabel(summary);
  if (counts === null) {
    return null;
  }
  const parts = [counts];
  // Issue #2151 (re-scoped): name the "×N versions" arm when a new ad is
  // actually testing variants. Only the largest count is named — the line
  // stays a single counted footnote, never a fabricated figure.
  if (summary.maxNewVariantCount !== null) {
    parts.push(`as ${summary.maxNewVariantCount} versions`);
  }
  return parts.join(", ");
}

export function adChurnFootnoteLine(summary: AdChurnSummary): string | null {
  const label = adChurnLineLabel(summary);
  if (label === null) {
    return null;
  }
  return `${label} — open the wall to see them.`;
}
