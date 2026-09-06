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

const HEADLINE_TYPE_SET = new Set<string>(LANDING_PAGE_HEADLINE_EVENT_TYPES);
const AD_CHURN_SET = new Set<string>(AD_CHURN_EVENT_TYPES);

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

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (isAdChurnEventType(item.eventType)) {
      if (item.eventType === "ad_new") {
        newCount += 1;
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
    adChurnSummary: { newCount, retiredCount, total: newCount + retiredCount },
    otherItems: other.map((entry) => entry.item),
  };
}

/**
 * The single counted line creative churn collapses into, e.g.
 * "3 new creatives, 2 retired — open the wall to see them." Returns null when
 * there is no churn, so callers can render nothing rather than an empty line.
 */
export function adChurnFootnoteLine(summary: AdChurnSummary): string | null {
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
  return `${parts.join(", ")} — open the wall to see them.`;
}
