import type { AppEnv } from "~/lib/env.server";
import { getWatchlist } from "~/lib/data/watchlists-core.server";
import { domainFromWatchlistTargetId } from "~/lib/weekly-public-moves.server";
import type {
  SourceAdapter,
  SourceChange,
  SourceFetchContext,
  SourceFetchResult,
  SourceSnapshotInput,
  SourceSnapshotRecord,
} from "~/lib/sources/types";
import { fetchCreativesByDomain } from "~/lib/sources/google-ads/google-ads-transparency.server";
import {
  buildSnapshotPayload,
  diffGoogleAdsSnapshots,
  type GoogleAdsSnapshotPayload,
} from "~/lib/sources/google-ads/google-ads-snapshot.server";
import { GoogleAdsSection } from "~/components/sources/google-ads";

/**
 * Google Ads (Transparency Center) source adapter (#2189).
 *
 * Snapshots the creatives an advertiser is running on Google's Ads
 * Transparency Center for the competitor's registrable domain, on the
 * existing per-competitor check cadence (no new schedule). The seam's
 * generic `runSources` stores the payload, diffs previous vs current, and
 * emits each SourceChange through the existing Meta alert path tagged with
 * `sourceId: "google_ads"`. Unavailable never blocks the Meta check.
 *
 * Coverage is "configured" always (no credentials): `requiresEnv` returns
 * true and `implemented` is true, so the seam's coverage rule resolves to
 * "configured" without editing presence-types.ts or the coverage file.
 */
export const googleAdsAdapter: SourceAdapter = {
  id: "google_ads",
  label: "Google Ads (Transparency Center)",
  kind: "ads",
  implemented: true,
  cadence: "daily",
  requiresEnv: () => true,
  async fetch(env: unknown, competitor: SourceFetchContext): Promise<SourceFetchResult> {
    const appEnv = env as AppEnv;
    const watchlist = await getWatchlist(appEnv, competitor.competitorId);
    if (!watchlist) {
      return { unavailable: true, reason: "watchlist_not_found" };
    }
    const domain = domainFromWatchlistTargetId(watchlist.targetId);
    if (!domain) {
      return { unavailable: true, reason: "no_domain" };
    }
    const result = await fetchCreativesByDomain(domain, { maxCreatives: 200 });
    if ("unavailable" in result) {
      return result;
    }
    const fetchedAt = new Date().toISOString();
    const payload = buildSnapshotPayload(domain, result.creatives, result.truncated, fetchedAt);
    return { payload };
  },
  diff(prev: SourceSnapshotRecord | null, next: SourceSnapshotInput): SourceChange[] {
    const prevPayload = (prev?.payload ?? null) as GoogleAdsSnapshotPayload | null;
    const nextPayload = next.payload as GoogleAdsSnapshotPayload;
    return diffGoogleAdsSnapshots(prevPayload, nextPayload);
  },
  Section: GoogleAdsSection,
};
