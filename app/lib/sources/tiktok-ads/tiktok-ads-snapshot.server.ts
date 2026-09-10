import type { AppEnv } from "~/lib/env.server";
import { ensureDb } from "~/lib/data/d1.server";
import { nowIso, type JsonRecord } from "~/lib/data/helpers.server";
import { getLatestSourceSnapshot } from "~/lib/sources/run.server";
import type {
  SourceChange,
  SourceFetchContext,
  SourceFetchResult,
  SourceSnapshotInput,
  SourceSnapshotRecord,
} from "~/lib/sources/types";
import {
  fetchAds,
  resolveAdvertiser,
  type TiktokAd,
} from "~/lib/sources/tiktok-ads/tiktok-ad-library.server";

/**
 * TikTok Ads snapshot + diff (#2194). The adapter's fetch/diff bodies live here
 * so the adapter module (`tiktok-ads.server.ts`) stays a thin wiring shell.
 *
 * Weekly cadence is enforced inside `fetchTiktokSnapshot` via a 7-day gate
 * against the latest stored `source_snapshot` row (consumed from run.server's
 * `getLatestSourceSnapshot`). The seam does not add a separate schedule.
 */

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

interface TiktokPayload {
  ads: TiktokAd[];
  totalAds: number;
  legalName: string;
  candidates?: string[];
  resolvedAt?: string;
}

function isTiktokPayload(payload: JsonRecord): payload is JsonRecord & TiktokPayload {
  return (
    Array.isArray(payload.ads) &&
    typeof payload.totalAds === "number" &&
    typeof payload.legalName === "string"
  );
}

function toPayload(record: SourceSnapshotRecord | null): TiktokPayload | null {
  if (!record) return null;
  if (isTiktokPayload(record.payload)) {
    return record.payload;
  }
  return null;
}

/**
 * The adapter's fetch body. Steps:
 *  1. No `DECODO_SCRAPER_AUTH` → not_configured.
 *  2. 7-day gate via the latest stored `source_snapshot` row.
 *  3. Read `tiktok_advertiser` from D1.
 *  4. No stored name → resolve + fetch; persist via competitorUpdate.
 *  5. Stored name → fetch; re-resolve on real-zero.
 */
export async function fetchTiktokSnapshot(
  env: unknown,
  competitor: SourceFetchContext,
): Promise<SourceFetchResult> {
  const appEnv = env as AppEnv;

  if (!appEnv.DECODO_SCRAPER_AUTH) {
    return { unavailable: true, reason: "not_configured" };
  }

  // 7-day gate: skip when the latest snapshot is less than 7 days old.
  const latest = await getLatestSourceSnapshot(
    appEnv,
    competitor.competitorId,
    "tiktok",
  );
  if (latest) {
    const fetchedAtMs = Date.parse(latest.fetchedAt);
    if (Number.isFinite(fetchedAtMs)) {
      const age = Date.now() - fetchedAtMs;
      if (age < SEVEN_DAYS_MS) {
        return { unavailable: true, reason: "cadence" };
      }
    }
  }

  // Read the stored legal advertiser name from D1.
  const row = await ensureDb(appEnv)
    .prepare("SELECT tiktok_advertiser FROM watchlist WHERE id = ?")
    .bind(competitor.competitorId)
    .first<{ tiktok_advertiser: string | null }>();
  const storedName = row?.tiktok_advertiser ?? null;

  // No stored name → resolve then fetch.
  if (!storedName) {
    const resolved = await resolveAdvertiser(appEnv, competitor.competitorLabel);
    if ("unavailable" in resolved) {
      if (resolved.reason === "no_match") {
        return { unavailable: true, reason: "no_advertiser" };
      }
      return resolved;
    }
    const fetched = await fetchAds(appEnv, resolved.legalName);
    if ("unavailable" in fetched) {
      return fetched;
    }
    const payload: JsonRecord = {
      ads: fetched.ads,
      totalAds: fetched.totalAds,
      legalName: resolved.legalName,
      candidates: resolved.candidates,
      resolvedAt: nowIso(),
    };
    return {
      payload,
      competitorUpdate: { tiktok_advertiser: resolved.legalName },
    };
  }

  // Stored name → fetch directly.
  const fetched = await fetchAds(appEnv, storedName);
  if ("unavailable" in fetched) {
    return fetched;
  }

  // Real zero → re-resolve in case the advertiser renamed/merged.
  if (fetched.totalAds === 0 && fetched.ads.length === 0) {
    const resolved = await resolveAdvertiser(appEnv, competitor.competitorLabel);
    if (!("unavailable" in resolved) && resolved.legalName !== storedName) {
      const refetched = await fetchAds(appEnv, resolved.legalName);
      if ("unavailable" in refetched) {
        // Fall back to the empty result with the stored name rather than
        // surfacing an unavailable from the re-resolve attempt.
        return {
          payload: {
            ads: [],
            totalAds: 0,
            legalName: storedName,
          },
        };
      }
      return {
        payload: {
          ads: refetched.ads,
          totalAds: refetched.totalAds,
          legalName: resolved.legalName,
          candidates: resolved.candidates,
          resolvedAt: nowIso(),
        },
        competitorUpdate: { tiktok_advertiser: resolved.legalName },
      };
    }
    // No new name found (no_match or same name) → return the empty result.
    return {
      payload: {
        ads: [],
        totalAds: 0,
        legalName: storedName,
      },
    };
  }

  return {
    payload: {
      ads: fetched.ads,
      totalAds: fetched.totalAds,
      legalName: storedName,
    },
  };
}

/**
 * The adapter's diff body. Compares the previous and next snapshot payloads.
 *  - New ad ids (in next, not in prev) → ad_new.
 *  - Paused: an ad present in both whose lastShown is identical in both AND
 *    now - lastShown >= 14 days → ad_inactive.
 *  - Total-ads change → one ad_new/ad_inactive entry.
 * First snapshot (prev null) emits only the new-ad entries.
 */
export function diffTiktokAds(
  prev: SourceSnapshotRecord | null,
  next: SourceSnapshotInput,
): SourceChange[] {
  const changes: SourceChange[] = [];
  const nextPayload = isTiktokPayload(next.payload) ? next.payload : null;
  if (!nextPayload) return changes;

  const prevPayload = toPayload(prev);
  const now = new Date();

  const nextById = new Map<string, TiktokAd>();
  for (const ad of nextPayload.ads) {
    nextById.set(ad.adId, ad);
  }

  const prevById = new Map<string, TiktokAd>();
  if (prevPayload) {
    for (const ad of prevPayload.ads) {
      prevById.set(ad.adId, ad);
    }
  }

  // New ad ids.
  for (const ad of nextPayload.ads) {
    if (!prevById.has(ad.adId)) {
      changes.push({
        eventType: "ad_new",
        title: `New TikTok ad from ${nextPayload.legalName}`,
        summary: `Ad ${ad.adId} first shown ${ad.firstShown}, last shown ${ad.lastShown}.`,
        metadata: {
          sourceId: "tiktok",
          adId: ad.adId,
          advertiser: ad.advertiser,
        },
      });
    }
  }

  if (!prevPayload) {
    // First snapshot: only new-ad entries, no paused, no total change.
    return changes;
  }

  // Paused: present in both, identical lastShown, 14+ days old.
  for (const ad of nextPayload.ads) {
    const prevAd = prevById.get(ad.adId);
    if (!prevAd) continue;
    if (prevAd.lastShown !== ad.lastShown) continue;
    const lastShownDate = parseMmDdYyyy(ad.lastShown);
    if (!lastShownDate) continue;
    const ageMs = now.getTime() - lastShownDate.getTime();
    if (ageMs >= FOURTEEN_DAYS_MS) {
      changes.push({
        eventType: "ad_inactive",
        title: "TikTok ad paused",
        summary: `Ad ${ad.adId} (${ad.advertiser}) last shown ${ad.lastShown} — inactive 14+ days.`,
        metadata: {
          sourceId: "tiktok",
          adId: ad.adId,
          advertiser: ad.advertiser,
          lastShown: ad.lastShown,
        },
      });
    }
  }

  // Total-ads change.
  const prevTotal = prevPayload.totalAds;
  const nextTotal = nextPayload.totalAds;
  if (prevTotal !== nextTotal) {
    changes.push({
      eventType: nextTotal > prevTotal ? "ad_new" : "ad_inactive",
      title: "TikTok total ads changed",
      summary: `Total EU-shown ads: ${prevTotal} → ${nextTotal}.`,
      metadata: {
        sourceId: "tiktok",
        totalAdsBefore: prevTotal,
        totalAdsAfter: nextTotal,
      },
    });
  }

  return changes;
}

function parseMmDdYyyy(value: string): Date | null {
  const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (!month || !day || !year) return null;
  // MM/DD/YYYY → local-date midnight; good enough for day-granularity diffs.
  return new Date(year, month - 1, day);
}
