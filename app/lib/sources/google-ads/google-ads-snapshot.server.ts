/**
 * Google Ads Transparency Center — snapshot building + diff (#2189 do:3).
 *
 * The seam's generic `runSources` path stores the adapter payload verbatim
 * and calls `adapter.diff(prev, next)`; the seam emits each returned
 * SourceChange through the existing Meta alert path (`createWatchEvent`)
 * tagged with `sourceId` in metadata. This module owns the payload shape and
 * the diff logic; it does not emit alerts itself (judge batch-2 edit:
 * "diff() returns SourceChange[]; the seam emits").
 *
 * Diff cases (issue #2189 do:3):
 * - new creative ids (ad_new)
 * - creatives whose lastShownAt stopped advancing for 7+ days (ad_inactive,
 *   treated as paused)
 * - new advertiser ids on the domain (ad_new)
 * - format mix change (website_page_changed)
 *
 * Unavailable never blocks the Meta check — the adapter returns unavailable
 * from `fetch` and the seam stores nothing, so `diff` is never called with a
 * failed snapshot.
 */

import type { JsonRecord } from "~/lib/data/helpers.server";
import type { SourceChange } from "~/lib/sources/types";
import type { GoogleAdsCreative } from "~/lib/sources/google-ads/google-ads-transparency.server";

const PAUSED_STALE_DAYS = 7;
const PAUSED_STALE_MS = PAUSED_STALE_DAYS * 24 * 60 * 60 * 1000;

export interface GoogleAdsSnapshotPayload extends JsonRecord {
  domain: string;
  fetchedAt: string;
  truncated: boolean;
  creatives: GoogleAdsCreative[];
  advertiserCount: number;
  formatMix: { text: number; image: number; video: number; unknown: number };
}

export interface GoogleAdsSnapshotInput {
  unavailable?: false;
  payload: GoogleAdsSnapshotPayload;
}

/**
 * Build the stored snapshot payload from a successful fetch. Computes the
 * advertiser count and format mix so the diff and the Section can read them
 * without re-scanning.
 */
export function buildSnapshotPayload(
  domain: string,
  creatives: GoogleAdsCreative[],
  truncated: boolean,
  fetchedAt: string,
): GoogleAdsSnapshotPayload {
  const advertiserIds = new Set<string>();
  const formatMix = { text: 0, image: 0, video: 0, unknown: 0 };
  for (const c of creatives) {
    if (c.advertiserId) advertiserIds.add(c.advertiserId);
    formatMix[c.format] += 1;
  }
  return {
    domain,
    fetchedAt,
    truncated,
    creatives,
    advertiserCount: advertiserIds.size,
    formatMix,
  };
}

function creativeMap(creatives: GoogleAdsCreative[]): Map<string, GoogleAdsCreative> {
  const map = new Map<string, GoogleAdsCreative>();
  for (const c of creatives) map.set(c.creativeId, c);
  return map;
}

function formatMixEqual(
  a: { text: number; image: number; video: number; unknown: number },
  b: { text: number; image: number; video: number; unknown: number },
): boolean {
  return a.text === b.text && a.image === b.image && a.video === b.video && a.unknown === b.unknown;
}

/**
 * Diff the previous and next Google Ads snapshot payloads. Returns one
 * SourceChange per detected change category (new creatives, paused
 * creatives, new advertisers, format mix change), or [] when nothing
 * changed. `prev` is null on the first snapshot (no diff baseline) → [].
 */
export function diffGoogleAdsSnapshots(
  prev: GoogleAdsSnapshotPayload | null,
  next: GoogleAdsSnapshotPayload,
): SourceChange[] {
  if (!prev) return [];

  const changes: SourceChange[] = [];
  const prevCreatives = creativeMap(prev.creatives);
  const nextCreatives = creativeMap(next.creatives);

  // New creative ids.
  const newCreativeIds: string[] = [];
  for (const [id, c] of nextCreatives) {
    if (!prevCreatives.has(id)) newCreativeIds.push(id);
  }
  if (newCreativeIds.length > 0) {
    changes.push({
      eventType: "ad_new",
      title: `${newCreativeIds.length} new Google Ads creative${newCreativeIds.length === 1 ? "" : "s"}`,
      summary: `New creative${newCreativeIds.length === 1 ? "" : "s"} on ${next.domain}: ${newCreativeIds.length} added since last check.`,
      metadata: { category: "new_creatives", creativeIds: newCreativeIds },
    });
  }

  // Paused creatives: present in both, lastShownAt did not advance, and the
  // last-shown timestamp is 7+ days before this snapshot's fetchedAt. Only
  // brand-new pauses are emitted — a creative that was ALREADY stale-paused
  // in the previous snapshot is left silent, so the alert path does not
  // re-fire the same id on every later check (digest spam).
  const pausedCreativeIds: string[] = [];
  const nextFetchedAt = Date.parse(next.fetchedAt);
  const prevFetchedAt = Date.parse(prev.fetchedAt);
  for (const [id, nextC] of nextCreatives) {
    const prevC = prevCreatives.get(id);
    if (!prevC) continue;
    if (nextC.lastShownAt && prevC.lastShownAt && nextC.lastShownAt === prevC.lastShownAt) {
      const lastShownMs = Date.parse(nextC.lastShownAt);
      if (!Number.isFinite(nextFetchedAt) || !Number.isFinite(lastShownMs)) continue;
      if (nextFetchedAt - lastShownMs < PAUSED_STALE_MS) continue;
      // Already stale-paused relative to the previous snapshot? Skip.
      const prevLastShownMs = Date.parse(prevC.lastShownAt);
      const alreadyPaused =
        Number.isFinite(prevFetchedAt) &&
        Number.isFinite(prevLastShownMs) &&
        prevFetchedAt - prevLastShownMs >= PAUSED_STALE_MS;
      if (alreadyPaused) continue;
      pausedCreativeIds.push(id);
    }
  }
  if (pausedCreativeIds.length > 0) {
    changes.push({
      eventType: "ad_inactive",
      title: `${pausedCreativeIds.length} Google Ads creative${pausedCreativeIds.length === 1 ? "" : "s"} paused`,
      summary: `${pausedCreativeIds.length} creative${pausedCreativeIds.length === 1 ? "" : "s"} on ${next.domain} not shown for ${PAUSED_STALE_DAYS}+ days.`,
      metadata: { category: "paused_creatives", creativeIds: pausedCreativeIds },
    });
  }

  // New advertiser ids on the domain.
  const prevAdvertisers = new Set<string>();
  for (const c of prev.creatives) if (c.advertiserId) prevAdvertisers.add(c.advertiserId);
  const newAdvertiserIds: string[] = [];
  const newAdvertiserNames: string[] = [];
  const seenNewAdvertisers = new Set<string>();
  for (const c of next.creatives) {
    if (c.advertiserId && !prevAdvertisers.has(c.advertiserId) && !seenNewAdvertisers.has(c.advertiserId)) {
      seenNewAdvertisers.add(c.advertiserId);
      newAdvertiserIds.push(c.advertiserId);
      if (c.advertiserName) newAdvertiserNames.push(c.advertiserName);
    }
  }
  if (newAdvertiserIds.length > 0) {
    changes.push({
      eventType: "ad_new",
      title: `${newAdvertiserIds.length} new advertiser${newAdvertiserIds.length === 1 ? "" : "s"} on ${next.domain}`,
      summary: `New advertiser${newAdvertiserIds.length === 1 ? "" : "s"} running Google Ads on ${next.domain}: ${newAdvertiserNames.join(", ") || newAdvertiserIds.length}.`,
      metadata: { category: "new_advertisers", advertiserIds: newAdvertiserIds, advertiserNames: newAdvertiserNames },
    });
  }

  // Format mix change.
  if (!formatMixEqual(prev.formatMix, next.formatMix)) {
    changes.push({
      eventType: "website_page_changed",
      title: `Google Ads format mix changed on ${next.domain}`,
      summary: `Creative format mix shifted from text:${prev.formatMix.text}/image:${prev.formatMix.image}/video:${prev.formatMix.video}/unknown:${prev.formatMix.unknown} to text:${next.formatMix.text}/image:${next.formatMix.image}/video:${next.formatMix.video}/unknown:${next.formatMix.unknown}.`,
      metadata: { category: "format_mix_change", prev: prev.formatMix, next: next.formatMix },
    });
  }

  return changes;
}
