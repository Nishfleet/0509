import type { SourceAdapter, SourceChange, SourceFetchContext, SourceFetchResult, SourceSnapshotInput, SourceSnapshotRecord } from "~/lib/sources/types";
import type { AppEnv } from "~/lib/env.server";
import { TiktokAdsSection } from "~/components/sources/tiktok-ads";
import { fetchTiktokSnapshot, diffTiktokAds } from "~/lib/sources/tiktok-ads/tiktok-ads-snapshot.server";

/**
 * TikTok Ads (Commercial Content Library, EU-shown) source adapter (#2194).
 *
 * Scrapes TikTok's EU DSA Commercial Content Library via Decodo universal
 * render, weekly per competitor. Resolves the exact legal advertiser name
 * (query_type=1), then fetches the newest 12 EU-shown ads (query_type=2).
 * Capped at 800 JS requests/month by the Decodo budget counter. No detail-page
 * fetches, no spend/impressions, no non-EU coverage.
 */
export const tiktokAdsAdapter: SourceAdapter = {
  id: "tiktok",
  label: "TikTok Ads (Commercial Content Library, EU-shown)",
  kind: "ads",
  implemented: true,
  cadence: "weekly",
  requiresEnv: (env: unknown) => Boolean((env as AppEnv)?.DECODO_SCRAPER_AUTH),
  async fetch(env: unknown, competitor: SourceFetchContext): Promise<SourceFetchResult> {
    return fetchTiktokSnapshot(env as AppEnv, competitor);
  },
  diff(prev: SourceSnapshotRecord | null, next: SourceSnapshotInput): SourceChange[] {
    return diffTiktokAds(prev, next);
  },
  Section: TiktokAdsSection,
};
