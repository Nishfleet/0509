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
import { isGoogleAdsSourceKilled } from "~/lib/env.server";
import { fetchCreativesByDomain } from "~/lib/sources/google-ads/google-ads-transparency.server";
import {
  buildSnapshotPayload,
  diffGoogleAdsSnapshots,
  type GoogleAdsSnapshotPayload,
} from "~/lib/sources/google-ads/google-ads-snapshot.server";
import { recordGoogleAdsCaptureAttempt } from "~/lib/sources/google-ads/google-ads-usage.server";
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
 * Coverage resolves to "configured" (no credentials, `implemented` true)
 * while the #3197 kill flag is at its production posture (unset or "0");
 * GOOGLE_ADS_SOURCE_DISABLED=1 pauses the source end to end — the registry's
 * env filter drops it from scheduled runs, the public /ads section and
 * /timeline section omit it, and the coverage policy reports it
 * "coming_soon".
 *
 * Capture-validity gate (#2873): an unavailable capture returns here BEFORE
 * any diff, so the seam neither persists a snapshot nor emits an alert for a
 * failed capture — the previous good snapshot stays the diff base, and the
 * next good capture diffs against it. No phantom changes, by construction.
 *
 * Every attempt (success or failure) is recorded through the best-effort KV
 * counters in google-ads-usage.server.ts — the /status capture-failure rate's
 * denominator. The counter never blocks or fails the capture.
 */
export const googleAdsAdapter: SourceAdapter = {
  id: "google_ads",
  label: "Google Ads (Transparency Center)",
  kind: "ads",
  implemented: true,
  cadence: "daily",
  // Kill flag (issue #3197): GOOGLE_ADS_SOURCE_DISABLED=1 pauses the source
  // (no runs, no /ads section, coverage "coming_soon"); unset or "0" = on.
  requiresEnv: (env: unknown): boolean => !isGoogleAdsSourceKilled(env as AppEnv),
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
    // One counted attempt per fetch — success or failure (issue #3197).
    // Best-effort: the counter's own KV errors are swallowed inside it.
    await recordGoogleAdsCaptureAttempt(appEnv, { failed: "unavailable" in result });
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
