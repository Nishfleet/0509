/**
 * The proof archive — one engine behind `/timeline/:domain` (public), the
 * signed-in competitor detail's Archive tab, the archive export, and the
 * frozen share snapshot (issue #2173).
 *
 * Pure module: every function turns already-loaded rows (offer ledger
 * entries, watch events, ad tenure rows, capture timestamps) into the same
 * chronological record. D1/R2 reads live in `archive.server.ts`; rendering
 * lives in `components/archive-ledger.tsx`. Nothing here fabricates: a row
 * always carries when it was captured and how, missing artifacts are labelled
 * (`evidenceNote`), and capture gaps are computed, never smoothed.
 */

import {
  scoreChangeCriticality,
  type ChangeCriticality,
} from "~/lib/change-criticality.server";
import {
  landingPageChangedFieldLabel,
  readChangeMark,
  readLandingPageEvidence,
} from "~/lib/change-mark";
import { formatOfferDate, type OfferLedgerEntry } from "~/lib/offer-timeline";
import type { ChangeMark } from "~/lib/change-mark";
import type { WatchEventRecord } from "~/lib/types";
import {
  formatWatchEventTypeLabel,
  websitePageChangedFieldLabel,
} from "~/lib/watch-event-display";

/** Long before/after values are bounded like the website-page evaluator's. */
const MAX_ARCHIVE_VALUE_LENGTH = 500;
/** A before/after pair only renders as a token mark when both sides are short. */
const MAX_MARK_LENGTH = 48;
/**
 * Monitoring runs on a daily cadence; a span three times that with zero
 * stored captures is shown as a gap, never smoothed over.
 */
export const ARCHIVE_GAP_MIN_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ArchiveEntryKind = "first_capture" | "change" | "suppressed";
export type ArchiveEntrySource = "offer_ledger" | "watch_event";

export interface ArchiveEntry {
  id: string;
  kind: ArchiveEntryKind;
  /** Where the row came from. `watch_event` rows are workspace-private. */
  source: ArchiveEntrySource;
  /** When the capture happened (stored timestamp), ISO 8601. */
  capturedAt: string;
  dateLabel: string;
  /** The field that changed in customer words ("Headline", "CTA", …). */
  fieldLabel: string;
  /** Token-length before/after, when both sides are stored and short. */
  changeMark: ChangeMark | null;
  /** Full stored before/after (bounded), for the diff block under the mark. */
  beforeValue: string | null;
  afterValue: string | null;
  /** #1387 deterministic band; null when there is no diff to score. */
  criticality: ChangeCriticality | null;
  beforeScreenshotHref: string | null;
  afterScreenshotHref: string | null;
  pageTextHref: string | null;
  /** How the row was captured (stored capture method), null when not stored. */
  captureMethod: string | null;
  /** Honest label when a row carries no artifact receipts. */
  evidenceNote: string | null;
  sourceUrl: string | null;
  /** Stored watch_event status — workspace-private, stripped by toPublicArchive. */
  eventStatus: string | null;
}

/** A capture-free span between two stored captures. */
export interface ArchiveGap {
  from: string;
  to: string;
  days: number;
}

export interface ArchiveAdTenureInput {
  id: string;
  label: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  isActive: boolean;
}

export interface ArchiveAdTenure {
  id: string;
  label: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  firstSeenLabel: string | null;
  lastSeenLabel: string | null;
  isActive: boolean;
  /** Days between first seen and (still running ? now : last seen). */
  runningDays: number | null;
}

export interface ArchiveOfferSeriesPoint {
  capturedAt: string;
  dateLabel: string;
  headline: string;
  ctaText: string | null;
  priceText: string | null;
}

/** The price/CTA/headline series for one landing page. */
export interface ArchiveOfferSeries {
  canonicalUrl: string;
  points: ArchiveOfferSeriesPoint[];
}

export interface ArchiveMonthSummary {
  /** UTC month key, e.g. "2026-09". */
  monthKey: string;
  monthLabel: string;
  changeCount: number;
  byField: Array<{ fieldLabel: string; count: number }>;
  byBand: { cosmetic: number; routine: number; material: number; critical: number };
  firstCapturedAt: string | null;
  lastCapturedAt: string | null;
}

export interface DomainArchive {
  /** Domain on the public surface, watchlist label on the signed-in one. */
  subject: string;
  generatedAt: string;
  /** Newest first. */
  entries: ArchiveEntry[];
  gaps: ArchiveGap[];
  adTenure: ArchiveAdTenure[];
  offerHistory: ArchiveOfferSeries[];
  monthSummary: ArchiveMonthSummary | null;
}

function boundValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_ARCHIVE_VALUE_LENGTH
    ? `${trimmed.slice(0, MAX_ARCHIVE_VALUE_LENGTH)}…`
    : trimmed;
}

function tokenMark(from: string | null, to: string | null): ChangeMark | null {
  if (!from || !to || from === to) return null;
  if (from.length > MAX_MARK_LENGTH || to.length > MAX_MARK_LENGTH) return null;
  return { from, to };
}

function formValueLabel(value: boolean | null): string {
  if (value === true) return "Form present";
  if (value === false) return "No form";
  return "Form unknown";
}

/**
 * Offer ledger → archive rows. One row per changed field per dated state, so
 * the record reads as "what changed, when, with which proof". The before
 * screenshot of a change is the previous non-suppressed state's screenshot —
 * the same baseline the ledger's transition diffs against.
 */
export function archiveEntriesFromOfferLedger(
  ledger: readonly OfferLedgerEntry[],
): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  // The ledger is emitted oldest-first; the diff baseline for each state is
  // the last NON-suppressed state (issue #1996) — track it the same way so a
  // before-screenshot never comes from a suppressed placeholder.
  let baseline: OfferLedgerEntry | null = null;

  for (const state of ledger) {
    const shared = {
      capturedAt: state.capturedAt,
      dateLabel: state.dateLabel,
      sourceUrl: state.canonicalUrl,
      captureMethod: state.captureMethod ?? null,
      afterScreenshotHref: state.screenshotHref,
      pageTextHref: state.pageTextHref,
      eventStatus: null,
    } as const;
    const evidenceNote =
      state.evidenceNote ??
      (!state.screenshotHref && !state.pageTextHref
        ? "No screenshot or page text stored for this capture"
        : null);

    if (state.suppressedReason) {
      entries.push({
        ...shared,
        id: `${state.id}:suppressed`,
        kind: "suppressed",
        source: "offer_ledger",
        fieldLabel: "Capture suppressed",
        changeMark: null,
        beforeValue: null,
        afterValue: null,
        criticality: null,
        beforeScreenshotHref: null,
        evidenceNote: `Capture suppressed: ${state.suppressedReason}`,
      });
      continue;
    }

    if (!state.transition || !baseline) {
      entries.push({
        ...shared,
        id: `${state.id}:first`,
        kind: "first_capture",
        source: "offer_ledger",
        fieldLabel: "First capture",
        changeMark: null,
        beforeValue: null,
        afterValue: null,
        criticality: null,
        beforeScreenshotHref: null,
        evidenceNote,
      });
      baseline = state;
      continue;
    }

    const transition = state.transition;
    const fieldRows: Array<{
      key: "headline" | "ctaText" | "priceText" | "formPresent";
      fieldLabel: string;
      before: string | null;
      after: string | null;
      criticalityField?: "cta" | "offerPrice";
    }> = [
      {
        key: "headline",
        fieldLabel: "Headline",
        before: transition.headline?.before ?? null,
        after: transition.headline?.after ?? null,
      },
      {
        key: "ctaText",
        fieldLabel: "CTA",
        before: transition.ctaText?.before ?? null,
        after: transition.ctaText?.after ?? null,
        criticalityField: "cta",
      },
      {
        key: "priceText",
        fieldLabel: "Price",
        before: transition.priceText?.before ?? null,
        after: transition.priceText?.after ?? null,
        criticalityField: "offerPrice",
      },
      {
        key: "formPresent",
        fieldLabel: "Form",
        before: transition.formPresent
          ? formValueLabel(transition.formPresent.before)
          : null,
        after: transition.formPresent
          ? formValueLabel(transition.formPresent.after)
          : null,
      },
    ];

    for (const row of fieldRows) {
      if (transition[row.key] === null) continue;
      entries.push({
        ...shared,
        id: `${state.id}:${row.key}`,
        kind: "change",
        source: "offer_ledger",
        fieldLabel: row.fieldLabel,
        changeMark: tokenMark(row.before, row.after),
        beforeValue: boundValue(row.before),
        afterValue: boundValue(row.after),
        criticality: scoreChangeCriticality({
          field: row.criticalityField,
          before: row.before,
          after: row.after,
        }),
        beforeScreenshotHref: baseline.screenshotHref,
        evidenceNote,
      });
    }
    baseline = state;
  }

  return entries;
}

function readMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const ARCHIVE_SOURCE_URL_KEYS = [
  "sourceUrl",
  "proofUrl",
  "landingPageUrl",
  "websiteUrl",
  "websiteProofUrl",
  "canonicalUrl",
];

function eventSourceUrl(event: WatchEventRecord): string | null {
  for (const key of ARCHIVE_SOURCE_URL_KEYS) {
    const value = readMetadataString(event.metadata, key);
    if (value) return value;
  }
  return null;
}

function eventFieldLabel(event: WatchEventRecord): string {
  if (event.eventType === "website_page_changed") {
    return websitePageChangedFieldLabel(
      readMetadataString(event.metadata, "field"),
    );
  }
  if (event.eventType.startsWith("landing_page_")) {
    return landingPageChangedFieldLabel(event.eventType);
  }
  return formatWatchEventTypeLabel(event.eventType);
}

/**
 * #1387 deterministic criticality for a stored watch event. Events without a
 * stored before/after diff (a new ad appearing, an ad going quiet) carry no
 * band rather than a fabricated one.
 */
export function scoreWatchEventCriticality(
  event: WatchEventRecord,
): ChangeCriticality | null {
  const before = readMetadataString(event.metadata, "from");
  const after = readMetadataString(event.metadata, "to");
  if (event.eventType === "website_page_added") {
    return scoreChangeCriticality({ kind: "page-added", before, after });
  }
  if (event.eventType === "website_page_removed") {
    return scoreChangeCriticality({ kind: "page-removed", before, after });
  }
  if (event.eventType === "website_page_changed") {
    return scoreChangeCriticality({
      kind: "field-changed",
      field: readMetadataString(event.metadata, "field"),
      before,
      after,
    });
  }
  if (!before && !after) return null;
  if (event.eventType === "landing_page_cta_changed") {
    return scoreChangeCriticality({ field: "cta", before, after });
  }
  if (event.eventType === "landing_page_offer_changed") {
    return scoreChangeCriticality({ field: "offerPrice", before, after });
  }
  return scoreChangeCriticality({ before, after });
}

/**
 * Watch events → archive rows (the signed-in side: everything the account
 * captured, including events whose proof is pending or failed — the stored
 * status rides on the row, never hidden).
 */
export function archiveEntriesFromWatchEvents(
  events: readonly WatchEventRecord[],
  extras: { proofScreenshotHref?: (event: WatchEventRecord) => string | null } = {},
): ArchiveEntry[] {
  return events.map((event) => {
    const from = readMetadataString(event.metadata, "from");
    const to = readMetadataString(event.metadata, "to");
    const evidence = readLandingPageEvidence(event);
    const proofHref = extras.proofScreenshotHref?.(event) ?? null;
    const afterScreenshotHref = evidence?.afterImageUrl ?? proofHref;
    const beforeScreenshotHref = evidence?.beforeImageUrl ?? null;
    const capturedAt =
      readMetadataString(event.metadata, "capturedAt") ?? event.createdAt;
    return {
      id: `event:${event.id}`,
      kind: "change" as const,
      source: "watch_event" as const,
      capturedAt,
      dateLabel: formatOfferDate(capturedAt),
      fieldLabel: eventFieldLabel(event),
      changeMark: readChangeMark(event),
      beforeValue: boundValue(from),
      afterValue: boundValue(to),
      criticality: scoreWatchEventCriticality(event),
      beforeScreenshotHref,
      afterScreenshotHref,
      pageTextHref: null,
      captureMethod:
        readMetadataString(event.metadata, "captureMethod") ??
        readMetadataString(event.metadata, "source"),
      evidenceNote: afterScreenshotHref
        ? null
        : "No screenshot stored for this change",
      sourceUrl: eventSourceUrl(event),
      eventStatus: event.status,
    };
  });
}

/** Newest first; ties break on id so the order is stable. */
export function sortArchiveEntriesDesc(
  entries: readonly ArchiveEntry[],
): ArchiveEntry[] {
  return [...entries].sort((left, right) => {
    const byTime = right.capturedAt.localeCompare(left.capturedAt);
    return byTime !== 0 ? byTime : right.id.localeCompare(left.id);
  });
}

/**
 * Capture gaps from raw stored capture timestamps (issue #2173 honesty
 * rule). A gap is emitted wherever two consecutive captures sit more than
 * `minGapDays` apart — the archive shows the hole instead of smoothing it.
 */
export function computeCaptureGaps(
  captureTimes: readonly string[],
  options: { minGapDays?: number } = {},
): ArchiveGap[] {
  const minGapDays = options.minGapDays ?? ARCHIVE_GAP_MIN_DAYS;
  const times = [...new Set(captureTimes)].sort();
  const gaps: ArchiveGap[] = [];
  for (let index = 1; index < times.length; index += 1) {
    const from = times[index - 1]!;
    const to = times[index]!;
    const days = Math.floor((Date.parse(to) - Date.parse(from)) / DAY_MS);
    if (days > minGapDays) {
      gaps.push({ from, to, days });
    }
  }
  return gaps;
}

/** First seen / last seen / running N days per stored ad. */
export function buildAdTenure(
  ads: readonly ArchiveAdTenureInput[],
  now: Date,
): ArchiveAdTenure[] {
  const rows = ads.map((ad) => {
    const firstSeenAt = ad.firstSeenAt;
    const lastSeenAt = ad.lastSeenAt;
    const end = ad.isActive ? now.toISOString() : (lastSeenAt ?? now.toISOString());
    const runningDays =
      firstSeenAt && !Number.isNaN(Date.parse(firstSeenAt))
        ? Math.max(0, Math.floor((Date.parse(end) - Date.parse(firstSeenAt)) / DAY_MS))
        : null;
    return {
      id: ad.id,
      label: ad.label,
      firstSeenAt,
      lastSeenAt,
      firstSeenLabel: firstSeenAt ? formatOfferDate(firstSeenAt) : null,
      lastSeenLabel: lastSeenAt ? formatOfferDate(lastSeenAt) : null,
      isActive: ad.isActive,
      runningDays,
    } satisfies ArchiveAdTenure;
  });
  return rows.sort((left, right) => {
    const byDays = (right.runningDays ?? -1) - (left.runningDays ?? -1);
    return byDays !== 0 ? byDays : left.label.localeCompare(right.label);
  });
}

/** The price/CTA/headline series per landing page, oldest first. */
export function buildOfferHistorySeries(
  ledger: readonly OfferLedgerEntry[],
): ArchiveOfferSeries[] {
  const byUrl = new Map<string, ArchiveOfferSeriesPoint[]>();
  for (const entry of ledger) {
    const points = byUrl.get(entry.canonicalUrl) ?? [];
    points.push({
      capturedAt: entry.capturedAt,
      dateLabel: entry.dateLabel,
      headline: entry.headline,
      ctaText: entry.ctaText,
      priceText: entry.priceText,
    });
    byUrl.set(entry.canonicalUrl, points);
  }
  return [...byUrl.entries()].map(([canonicalUrl, points]) => ({
    canonicalUrl,
    points,
  }));
}

const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function archiveMonthKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * "What changed this month" — a deterministic rollup of the stored rows in
 * the current UTC month. No LLM, no inference: counts by field and by #1387
 * criticality band, plus the month's first and last stored capture.
 */
export function summarizeArchiveMonth(
  entries: readonly ArchiveEntry[],
  now: Date,
): ArchiveMonthSummary | null {
  const monthKey = archiveMonthKey(now);
  const inMonth = entries.filter((entry) => entry.capturedAt.startsWith(monthKey));
  if (inMonth.length === 0) return null;

  const byField = new Map<string, number>();
  const byBand = { cosmetic: 0, routine: 0, material: 0, critical: 0 };
  let changeCount = 0;
  let firstCapturedAt: string | null = null;
  let lastCapturedAt: string | null = null;

  for (const entry of inMonth) {
    if (!firstCapturedAt || entry.capturedAt < firstCapturedAt) {
      firstCapturedAt = entry.capturedAt;
    }
    if (!lastCapturedAt || entry.capturedAt > lastCapturedAt) {
      lastCapturedAt = entry.capturedAt;
    }
    if (entry.kind !== "change") continue;
    changeCount += 1;
    byField.set(entry.fieldLabel, (byField.get(entry.fieldLabel) ?? 0) + 1);
    if (entry.criticality) {
      byBand[entry.criticality.band] += 1;
    }
  }

  return {
    monthKey,
    monthLabel: MONTH_LABEL_FORMATTER.format(now),
    changeCount,
    byField: [...byField.entries()]
      .map(([fieldLabel, count]) => ({ fieldLabel, count }))
      .sort((left, right) => right.count - left.count || left.fieldLabel.localeCompare(right.fieldLabel)),
    byBand,
    firstCapturedAt,
    lastCapturedAt,
  };
}

/**
 * The public/private field split (issue #2173 accept rule): the public
 * archive shows only public-ad facts. Anything sourced from a workspace's
 * watch events is dropped, account-scoped status is stripped, and the month
 * summary is recomputed from the public rows so its counts never describe
 * private data.
 */
export function toPublicArchive(archive: DomainArchive, now: Date): DomainArchive {
  const entries = sortArchiveEntriesDesc(
    archive.entries
      .filter((entry) => entry.source !== "watch_event")
      .map((entry) => ({ ...entry, eventStatus: null })),
  );
  return {
    ...archive,
    entries,
    monthSummary: summarizeArchiveMonth(entries, now),
  };
}

export function emptyDomainArchive(subject: string, now: Date): DomainArchive {
  return {
    subject,
    generatedAt: now.toISOString(),
    entries: [],
    gaps: [],
    adTenure: [],
    offerHistory: [],
    monthSummary: null,
  };
}
