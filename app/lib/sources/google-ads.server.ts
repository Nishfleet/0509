import type { SourceAdapter, SourceChange, SourceFetchContext, SourceFetchResult, SourceSnapshotInput, SourceSnapshotRecord } from "~/lib/sources/types";
import { GoogleAdsSection } from "~/components/sources/google-ads";

/**
 * Google Ads (Transparency Center) source adapter — STUB (seam #2218). #2189
 * replaces this file with the real adapter.
 */
export const googleAdsAdapter: SourceAdapter = {
  id: "google_ads",
  label: "Google Ads (Transparency Center)",
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
  Section: GoogleAdsSection,
};
