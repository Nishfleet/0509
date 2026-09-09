/**
 * Frozen archive snapshot codec (issue #2173) — the payload shape a
 * `share-watchlist-archive` action freezes into the existing share-link
 * machinery, and the whitelist sanitizer the `/share/:token` route reads it
 * back through.
 *
 * This module is client-safe by construction: the share route's component
 * imports the guards at render time, so nothing here may value-import a
 * `.server` module (the engine in `archive.ts` pulls the criticality scorer
 * and stays server-graph-only; type-only imports from it are erased).
 */

import type { ChangeCriticality } from "~/lib/change-criticality.server";
import type {
  ArchiveAdTenure,
  ArchiveEntry,
  ArchiveGap,
  ArchiveMonthSummary,
  ArchiveOfferSeries,
  ArchiveOfferSeriesPoint,
  DomainArchive,
} from "~/lib/archive";
import { formatOfferDate } from "~/lib/offer-timeline";

export const ARCHIVE_SNAPSHOT_KIND = "watchlist_archive_snapshot";

// A `type` (not `interface`) so the payload keeps an implicit index
// signature and stays assignable to the share machinery's `JsonRecord`.
export type ArchiveSnapshotPayload = {
  kind: typeof ARCHIVE_SNAPSHOT_KIND;
  watchlistName: string;
  targetLabel: string;
  frozenAt: string;
  archive: DomainArchive;
};

export function buildArchiveSnapshotPayload(
  archive: DomainArchive,
  meta: { watchlistName: string; targetLabel: string },
): ArchiveSnapshotPayload {
  return {
    kind: ARCHIVE_SNAPSHOT_KIND,
    watchlistName: meta.watchlistName,
    targetLabel: meta.targetLabel,
    frozenAt: archive.generatedAt,
    archive,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function sanitizeCriticality(value: unknown): ChangeCriticality | null {
  if (!isPlainRecord(value)) return null;
  const score = typeof value.score === "number" ? value.score : null;
  const band = readString(value.band);
  if (
    score === null ||
    (band !== "cosmetic" && band !== "routine" && band !== "material" && band !== "critical")
  ) {
    return null;
  }
  const reasons = Array.isArray(value.reasons)
    ? value.reasons.filter((reason): reason is string => typeof reason === "string")
    : [];
  return { score, band, reasons };
}

function sanitizeChangeMark(value: unknown): ArchiveEntry["changeMark"] {
  if (!isPlainRecord(value)) return null;
  const from = readString(value.from);
  const to = readString(value.to);
  if (!from || !to || from === to) return null;
  return { from, to };
}

function sanitizeArchiveEntry(value: unknown): ArchiveEntry | null {
  if (!isPlainRecord(value)) return null;
  const id = readString(value.id);
  const capturedAt = readString(value.capturedAt);
  const fieldLabel = readString(value.fieldLabel);
  const kind = readString(value.kind);
  const source = readString(value.source);
  if (!id || !capturedAt || !fieldLabel) return null;
  if (kind !== "first_capture" && kind !== "change" && kind !== "suppressed") return null;
  if (source !== "offer_ledger" && source !== "watch_event") return null;
  return {
    id,
    kind,
    source,
    capturedAt,
    dateLabel: readString(value.dateLabel) ?? formatOfferDate(capturedAt),
    fieldLabel,
    changeMark: sanitizeChangeMark(value.changeMark),
    beforeValue: readNullableString(value.beforeValue),
    afterValue: readNullableString(value.afterValue),
    criticality: sanitizeCriticality(value.criticality),
    beforeScreenshotHref: readNullableString(value.beforeScreenshotHref),
    afterScreenshotHref: readNullableString(value.afterScreenshotHref),
    pageTextHref: readNullableString(value.pageTextHref),
    captureMethod: readNullableString(value.captureMethod),
    evidenceNote: readNullableString(value.evidenceNote),
    sourceUrl: readNullableString(value.sourceUrl),
    eventStatus: readNullableString(value.eventStatus),
  };
}

function sanitizeGap(value: unknown): ArchiveGap | null {
  if (!isPlainRecord(value)) return null;
  const from = readString(value.from);
  const to = readString(value.to);
  const days = typeof value.days === "number" ? value.days : null;
  if (!from || !to || days === null) return null;
  return { from, to, days };
}

function sanitizeTenure(value: unknown): ArchiveAdTenure | null {
  if (!isPlainRecord(value)) return null;
  const id = readString(value.id);
  const label = readString(value.label);
  if (!id || !label) return null;
  return {
    id,
    label,
    firstSeenAt: readNullableString(value.firstSeenAt),
    lastSeenAt: readNullableString(value.lastSeenAt),
    firstSeenLabel: readNullableString(value.firstSeenLabel),
    lastSeenLabel: readNullableString(value.lastSeenLabel),
    isActive: value.isActive === true,
    runningDays: typeof value.runningDays === "number" ? value.runningDays : null,
  };
}

function sanitizeOfferSeries(value: unknown): ArchiveOfferSeries | null {
  if (!isPlainRecord(value)) return null;
  const canonicalUrl = readString(value.canonicalUrl);
  if (!canonicalUrl || !Array.isArray(value.points)) return null;
  const points = value.points.flatMap((point): ArchiveOfferSeriesPoint[] => {
    if (!isPlainRecord(point)) return [];
    const capturedAt = readString(point.capturedAt);
    const headline = readString(point.headline);
    if (!capturedAt || !headline) return [];
    return [
      {
        capturedAt,
        dateLabel: readString(point.dateLabel) ?? formatOfferDate(capturedAt),
        headline,
        ctaText: readNullableString(point.ctaText),
        priceText: readNullableString(point.priceText),
      },
    ];
  });
  return { canonicalUrl, points };
}

function sanitizeMonthSummary(value: unknown): ArchiveMonthSummary | null {
  if (!isPlainRecord(value)) return null;
  const monthKey = readString(value.monthKey);
  const monthLabel = readString(value.monthLabel);
  if (!monthKey || !monthLabel || typeof value.changeCount !== "number") return null;
  const band = isPlainRecord(value.byBand) ? value.byBand : {};
  const bandCount = (key: keyof ArchiveMonthSummary["byBand"]) =>
    typeof band[key] === "number" ? (band[key] as number) : 0;
  return {
    monthKey,
    monthLabel,
    changeCount: value.changeCount,
    byField: Array.isArray(value.byField)
      ? value.byField.flatMap((row): Array<{ fieldLabel: string; count: number }> => {
          if (!isPlainRecord(row)) return [];
          const fieldLabel = readString(row.fieldLabel);
          if (!fieldLabel || typeof row.count !== "number") return [];
          return [{ fieldLabel, count: row.count }];
        })
      : [],
    byBand: {
      cosmetic: bandCount("cosmetic"),
      routine: bandCount("routine"),
      material: bandCount("material"),
      critical: bandCount("critical"),
    },
    firstCapturedAt: readNullableString(value.firstCapturedAt),
    lastCapturedAt: readNullableString(value.lastCapturedAt),
  };
}

export function isArchiveSnapshotPayload(
  value: unknown,
): value is ArchiveSnapshotPayload {
  return isPlainRecord(value) && value.kind === ARCHIVE_SNAPSHOT_KIND;
}

/**
 * Whitelist re-read of a stored frozen archive. Share payloads are bearer
 * data written at share time; the sanitizer rebuilds the shape field by
 * field so a malformed or partial payload degrades to null ("snapshot
 * unavailable") instead of rendering garbage.
 */
export function sanitizeArchiveSnapshotPayload(
  value: unknown,
): ArchiveSnapshotPayload | null {
  if (!isArchiveSnapshotPayload(value)) return null;
  const raw = value as Record<string, unknown>;
  const rawArchive = isPlainRecord(raw.archive) ? raw.archive : null;
  const watchlistName = readString(raw.watchlistName);
  const targetLabel = readString(raw.targetLabel);
  const frozenAt = readString(raw.frozenAt);
  if (!rawArchive || !watchlistName || !targetLabel || !frozenAt) return null;

  const entries = Array.isArray(rawArchive.entries)
    ? rawArchive.entries.flatMap((row): ArchiveEntry[] => {
        const entry = sanitizeArchiveEntry(row);
        return entry ? [entry] : [];
      })
    : [];
  const archive: DomainArchive = {
    subject: readString(rawArchive.subject) ?? targetLabel,
    generatedAt: readString(rawArchive.generatedAt) ?? frozenAt,
    entries: [...entries].sort((left, right) => {
      const byTime = right.capturedAt.localeCompare(left.capturedAt);
      return byTime !== 0 ? byTime : right.id.localeCompare(left.id);
    }),
    gaps: Array.isArray(rawArchive.gaps)
      ? rawArchive.gaps.flatMap((row): ArchiveGap[] => {
          const gap = sanitizeGap(row);
          return gap ? [gap] : [];
        })
      : [],
    adTenure: Array.isArray(rawArchive.adTenure)
      ? rawArchive.adTenure.flatMap((row): ArchiveAdTenure[] => {
          const tenure = sanitizeTenure(row);
          return tenure ? [tenure] : [];
        })
      : [],
    offerHistory: Array.isArray(rawArchive.offerHistory)
      ? rawArchive.offerHistory.flatMap((row): ArchiveOfferSeries[] => {
          const series = sanitizeOfferSeries(row);
          return series ? [series] : [];
        })
      : [],
    monthSummary: sanitizeMonthSummary(rawArchive.monthSummary),
  };
  return {
    kind: ARCHIVE_SNAPSHOT_KIND,
    watchlistName,
    targetLabel,
    frozenAt,
    archive,
  };
}
