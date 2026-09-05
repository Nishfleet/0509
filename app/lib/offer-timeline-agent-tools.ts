/**
 * Offer-history MCP tools — pure payload shaping.
 *
 * The four dated-history tools (get_change_history, get_offer_state_at,
 * diff_offer, list_suppressed) are read-only MCP surface built on the
 * existing offer-timeline data layer. This module holds no D1 access:
 * api.mcp.ts loads OfferLedgerEntry[] and suppressed rows, then hands them
 * here so the payload contract is unit-testable without a database.
 *
 * Empty states are documented payloads, never errors and never fabricated
 * data: when the domain has no stored captures the tools report
 * "no history recorded yet — start a watchlist".
 */

import {
  offerStateAsOf,
  type OfferLedgerEntry,
} from "~/lib/offer-timeline";

export const OFFER_NO_HISTORY_MESSAGE = "no history recorded yet — start a watchlist";

export interface OfferHistoryEvidence {
  /** Absolute timeline URL anchored to the capture date. */
  timelineUrl: string;
  screenshotHref: string | null;
  pageTextHref: string | null;
}

export type OfferHistoryField = "headline" | "ctaText" | "priceText" | "formPresent";

export interface OfferFieldChangePayload {
  field: OfferHistoryField;
  before: unknown;
  after: unknown;
}

/**
 * One dated offer state as an agent payload: the state, its capture time,
 * the evidence link, the source provider, and the change against the
 * previous capture (null when this is the first dated state).
 */
export interface OfferHistoryEntryPayload {
  capturedAt: string;
  dateLabel: string;
  canonicalUrl: string;
  sourceProvider: string | null;
  headline: string;
  ctaText: string | null;
  priceText: string | null;
  formPresent: boolean | null;
  changes: OfferFieldChangePayload[] | null;
  evidence: OfferHistoryEvidence;
}

export interface OfferChangeHistoryPayload {
  tool: "get_change_history";
  domain: string;
  since: string | null;
  status: "ok" | "no_history";
  message?: string;
  entries: OfferHistoryEntryPayload[];
}

export interface OfferStateAtPayload {
  tool: "get_offer_state_at";
  domain: string;
  date: string;
  status: "ok" | "no_history" | "no_state_on_date";
  message?: string;
  state: OfferHistoryEntryPayload | null;
}

export interface OfferDiffPayload {
  tool: "diff_offer";
  domain: string;
  dateA: string;
  dateB: string;
  status: "ok" | "no_history" | "no_state_on_date";
  message?: string;
  /** State on the earlier of the two dates. */
  before: OfferHistoryEntryPayload | null;
  /** State on the later of the two dates. */
  after: OfferHistoryEntryPayload | null;
  changes: OfferFieldChangePayload[] | null;
}

export interface SuppressedOfferRow {
  id: string;
  canonicalUrl: string;
  capturedAt: string;
  reason: string;
}

export interface OfferListSuppressedPayload {
  tool: "list_suppressed";
  domain: string;
  status: "ok" | "no_history";
  message?: string;
  suppressed: SuppressedOfferRow[];
}

export function buildChangeHistoryPayload(
  domain: string,
  entries: readonly OfferLedgerEntry[],
  since: string | null,
  origin: string,
): OfferChangeHistoryPayload {
  const filtered = since
    ? entries.filter((entry) => entry.capturedAt.slice(0, 10) >= since)
    : [...entries];
  const base = {
    tool: "get_change_history" as const,
    domain,
    since,
  };
  if (filtered.length === 0) {
    return {
      ...base,
      status: "no_history",
      message: OFFER_NO_HISTORY_MESSAGE,
      entries: [],
    };
  }
  return {
    ...base,
    status: "ok",
    entries: filtered.map((entry) => entryToPayload(entry, domain, origin)),
  };
}

export function buildOfferStateAtPayload(
  domain: string,
  entries: readonly OfferLedgerEntry[],
  date: string,
  origin: string,
): OfferStateAtPayload {
  const base = {
    tool: "get_offer_state_at" as const,
    domain,
    date,
  };
  if (entries.length === 0) {
    return {
      ...base,
      status: "no_history",
      message: OFFER_NO_HISTORY_MESSAGE,
      state: null,
    };
  }
  const state = offerStateAsOf(entries, date);
  if (!state) {
    return {
      ...base,
      status: "no_state_on_date",
      message: `no stored capture on or before ${date} — the earliest recorded capture for this domain is ${entries[0]?.dateLabel ?? "unavailable"}`,
      state: null,
    };
  }
  return {
    ...base,
    status: "ok",
    state: entryToPayload(state, domain, origin),
  };
}

export function buildDiffOfferPayload(
  domain: string,
  entries: readonly OfferLedgerEntry[],
  dateA: string,
  dateB: string,
  origin: string,
): OfferDiffPayload {
  const base = {
    tool: "diff_offer" as const,
    domain,
    dateA,
    dateB,
  };
  if (entries.length === 0) {
    return {
      ...base,
      status: "no_history",
      message: OFFER_NO_HISTORY_MESSAGE,
      before: null,
      after: null,
      changes: null,
    };
  }
  const earlierDate = dateA <= dateB ? dateA : dateB;
  const laterDate = dateA <= dateB ? dateB : dateA;
  const before = offerStateAsOf(entries, earlierDate);
  const after = offerStateAsOf(entries, laterDate);
  if (!before || !after) {
    return {
      ...base,
      status: "no_state_on_date",
      message: `no stored capture covers ${earlierDate} or ${laterDate} — the stored range for this domain starts on ${entries[0]?.dateLabel ?? "unavailable"}`,
      before: null,
      after: null,
      changes: null,
    };
  }
  return {
    ...base,
    status: "ok",
    before: entryToPayload(before, domain, origin),
    after: entryToPayload(after, domain, origin),
    changes: diffFields(before, after),
  };
}

export function buildListSuppressedPayload(
  domain: string,
  rows: readonly SuppressedOfferRow[],
): OfferListSuppressedPayload {
  if (rows.length === 0) {
    return {
      tool: "list_suppressed",
      domain,
      status: "no_history",
      message: `no suppressed snapshot rows stored for ${domain}`,
      suppressed: [],
    };
  }
  return {
    tool: "list_suppressed",
    domain,
    status: "ok",
    suppressed: [...rows],
  };
}

function entryToPayload(
  entry: OfferLedgerEntry,
  domain: string,
  origin: string,
): OfferHistoryEntryPayload {
  return {
    capturedAt: entry.capturedAt,
    dateLabel: entry.dateLabel,
    canonicalUrl: entry.canonicalUrl,
    sourceProvider: entry.captureMethod ?? null,
    headline: entry.headline,
    ctaText: entry.ctaText,
    priceText: entry.priceText,
    formPresent: entry.formPresent,
    changes: transitionToChanges(entry.transition),
    evidence: {
      timelineUrl: `${origin}/timeline/${encodeURIComponent(domain)}?asOf=${entry.capturedAt.slice(0, 10)}`,
      screenshotHref: entry.screenshotHref,
      pageTextHref: entry.pageTextHref,
    },
  };
}

function transitionToChanges(
  transition: OfferLedgerEntry["transition"],
): OfferFieldChangePayload[] | null {
  if (!transition) {
    return null;
  }
  const changes: OfferFieldChangePayload[] = [];
  if (transition.headline) {
    changes.push({ field: "headline", before: transition.headline.before, after: transition.headline.after });
  }
  if (transition.ctaText) {
    changes.push({ field: "ctaText", before: transition.ctaText.before, after: transition.ctaText.after });
  }
  if (transition.priceText) {
    changes.push({ field: "priceText", before: transition.priceText.before, after: transition.priceText.after });
  }
  if (transition.formPresent) {
    changes.push({ field: "formPresent", before: transition.formPresent.before, after: transition.formPresent.after });
  }
  return changes;
}

function diffFields(
  before: OfferLedgerEntry,
  after: OfferLedgerEntry,
): OfferFieldChangePayload[] {
  const fields: Array<[OfferHistoryField, unknown, unknown]> = [
    ["headline", before.headline, after.headline],
    ["ctaText", before.ctaText, after.ctaText],
    ["priceText", before.priceText, after.priceText],
    ["formPresent", before.formPresent, after.formPresent],
  ];
  return fields
    .filter(([, beforeValue, afterValue]) => !Object.is(beforeValue, afterValue))
    .map(([field, beforeValue, afterValue]) => ({
      field,
      before: beforeValue,
      after: afterValue,
    }));
}