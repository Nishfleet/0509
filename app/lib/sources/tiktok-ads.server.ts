import type { SourceAdapter, SourceChange, SourceFetchContext, SourceFetchResult, SourceSnapshotInput, SourceSnapshotRecord } from "~/lib/sources/types";
import { TiktokAdsSection } from "~/components/sources/tiktok-ads";

/**
 * TikTok Ads (Commercial Content Library, EU-shown) source adapter — STUB
 * (seam #2218). #2194 replaces this file with the real adapter.
 */
export const tiktokAdsAdapter: SourceAdapter = {
  id: "tiktok",
  label: "TikTok Ads (Commercial Content Library, EU-shown)",
  kind: "ads",
  implemented: false,
  cadence: "daily",
  requiresEnv: () => false,
  async fetch(_env: unknown, _competitor: SourceFetchContext): Promise<SourceFetchResult> {
    return { unavailable: true, reason: "not_implemented" };
  },
  diff(_prev: SourceSnapshotRecord | null, _next: SourceSnapshotInput): SourceChange[] {
    return [];
  },
  Section: TiktokAdsSection,
};
