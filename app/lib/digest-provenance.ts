import type { JsonRecord } from "~/lib/data/helpers.server";

export const DIGEST_ITEM_SET_PROVENANCE = "atomic-v2" as const;
export const DIGEST_ITEM_COHORT_CAP = 150;

export interface DigestCohortItem {
  watchlistId: string;
  watchlistName: string;
  eventType: string;
  title: string;
  summary: string;
  metadata?: JsonRecord;
}

function priorityScore(item: DigestCohortItem) {
  const value = item.metadata?.priorityScore;
  return typeof value === "number" && Number.isFinite(value) ? value : -1;
}

function stableEventKey(item: DigestCohortItem, index: number) {
  const eventId = item.metadata?.eventId;
  return typeof eventId === "string" && eventId.trim() ? eventId.trim() : `index:${index}`;
}

function compareDigestCohortItems(
  left: { item: DigestCohortItem; index: number },
  right: { item: DigestCohortItem; index: number },
) {
  return priorityScore(right.item) - priorityScore(left.item) ||
    stableEventKey(left.item, left.index).localeCompare(stableEventKey(right.item, right.index)) ||
    left.index - right.index;
}

/**
 * Selects a bounded, deterministic digest cohort. The first pass guarantees
 * one highest-priority event per watchlist (Agency supports at most 75), then
 * the remaining capacity is filled by the same stable priority ordering.
 */
export function selectDigestCohort<T extends DigestCohortItem>(
  items: readonly T[],
  cap = DIGEST_ITEM_COHORT_CAP,
) {
  const ranked = items.map((item, index) => ({ item, index })).sort(compareDigestCohortItems);
  const byWatchlist = new Map<string, { item: T; index: number }>();
  for (const entry of ranked) {
    if (!byWatchlist.has(entry.item.watchlistId)) {
      byWatchlist.set(entry.item.watchlistId, entry);
    }
  }
  const covered = [...byWatchlist.values()].sort(compareDigestCohortItems);
  const selected = new Set<number>();
  const result: T[] = [];
  for (const entry of covered) {
    if (result.length >= cap) break;
    selected.add(entry.index);
    result.push(entry.item);
  }
  for (const entry of ranked) {
    if (result.length >= cap) break;
    if (selected.has(entry.index)) continue;
    result.push(entry.item);
  }
  return {
    items: result,
    totalEligibleEvents: items.length,
    includedEvents: result.length,
    omittedEvents: Math.max(items.length - result.length, 0),
  };
}

export function readDigestSourceEventId(metadata: Record<string, unknown> | null | undefined) {
  const value = metadata?.eventId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
