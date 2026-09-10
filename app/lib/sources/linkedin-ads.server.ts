import type { SourceAdapter, SourceChange, SourceFetchContext, SourceFetchResult, SourceSnapshotInput, SourceSnapshotRecord } from "~/lib/sources/types";
import { LinkedinAdsSection } from "~/components/sources/linkedin-ads";

/**
 * LinkedIn Ads (Ad Library) source adapter — STUB (seam #2218). #2193
 * replaces this file with the real adapter.
 */
export const linkedinAdsAdapter: SourceAdapter = {
  id: "linkedin",
  label: "LinkedIn Ads (Ad Library)",
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
  Section: LinkedinAdsSection,
};
