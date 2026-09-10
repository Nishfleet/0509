import type { AppEnv } from "~/lib/env.server";
import { getWatchlist } from "~/lib/data/watchlists-core.server";
import { domainFromWatchlistTargetId } from "~/lib/weekly-public-moves.server";
import { displayNameFromDomain } from "~/lib/ads-internal-links";
import type {
  SourceAdapter,
  SourceChange,
  SourceFetchContext,
  SourceFetchResult,
  SourceSnapshotInput,
  SourceSnapshotRecord,
} from "~/lib/sources/types";
import { fetchGoogleSerp } from "~/lib/sources/google-search/google-serp.server";
import type { SerpResult, SerpUnavailable } from "~/lib/sources/google-search/serp-provider";
import {
  buildSnapshotPayload,
  diffGoogleSerpSnapshots,
  type GoogleSerpSnapshotPayload,
} from "~/lib/sources/google-search/google-serp-snapshot.server";
import { GoogleSearchSection } from "~/components/sources/google-search";

/**
 * Google Search source adapter (#2181, seam #2218).
 *
 * Snapshots one branded Google SERP per competitor through the configured
 * SERP provider (`fetchGoogleSerp` picks it from `SERP_PROVIDER`; `decodo` is
 * the shipped one). The seam's generic `runSources` stores the payload,
 * diffs previous vs current, and emits each SourceChange through the existing
 * Meta alert path tagged with `sourceId: "google"`. Unavailable never blocks
 * the Meta check.
 *
 * Daily gate: the monitor cron REGULAR_MONITORING_CRON (workers/schedule.ts,
 * every 3 hours) checks each competitor 8x/day. Without a gate that is
 * 8 x 30 = 240 Decodo calls per competitor per month, so the 1,500/month
 * free budget would cap the fleet at ~6 competitors. Holding the source to
 * one fetch per UTC calendar day costs <= 30 calls per competitor per month,
 * which fits ~50 competitors inside the same budget. A stored snapshot whose
 * `fetchedAt` is already on today's UTC date short-circuits the fetch —
 * before the provider (and its budget reservation) is ever reached.
 *
 * Coverage is "configured" only when the selected provider is `decodo` AND
 * `DECODO_SCRAPER_AUTH` is present: `implemented` is true and `requiresEnv`
 * mirrors the selector's provider resolution, so the seam's coverage rule
 * resolves without editing presence-types.ts or the coverage file. A
 * `gateway`/unknown `SERP_PROVIDER` reports not-configured rather than
 * claiming coverage a fetch cannot honour.
 */
export const googleSearchAdapter: SourceAdapter = {
  id: "google",
  label: "Google Search",
  kind: "search",
  implemented: true,
  cadence: "daily",
  requiresEnv: (env: unknown): boolean => {
    const appEnv = env as AppEnv;
    // Same resolution as fetchGoogleSerp: trimmed, lowercased, "decodo" when
    // unset or blank. String() keeps a non-string config value from throwing
    // inside a predicate that must never throw (coverage calls it blindly).
    const configured = String(appEnv.SERP_PROVIDER ?? "decodo").trim().toLowerCase();
    const provider = configured === "" ? "decodo" : configured;
    if (provider !== "decodo") return false;
    const auth = appEnv.DECODO_SCRAPER_AUTH;
    return typeof auth === "string" && auth.trim() !== "";
  },
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
    // Brand query (issue #2181): the competitor's display name when one is
    // set, else the registrable domain's name stem ("nike.com" -> "Nike").
    const query = competitor.competitorLabel?.trim() || displayNameFromDomain(domain);
    if (!query) {
      return { unavailable: true, reason: "no_query" };
    }

    // `run.server` imports the registry, which imports this adapter — a
    // static import would make the cycle's resolution order-dependent, so
    // the seam reader is resolved lazily at call time (same shape as
    // monitoring.server.ts). Read ONCE: the daily gate below and the
    // `prevPosition` wiring both need it.
    const { getLatestSourceSnapshot } = await import("~/lib/sources/run.server");
    const prev = await getLatestSourceSnapshot(appEnv, competitor.competitorId, "google");
    if (prev && isSameUtcDay(prev.fetchedAt, new Date())) {
      return { unavailable: true, reason: "daily_gate" };
    }

    let result: SerpResult | SerpUnavailable;
    try {
      result = await fetchGoogleSerp(appEnv, query);
    } catch (err) {
      // The seam swallows a fetch throw silently, so a misconfigured
      // SERP_PROVIDER ("gateway", an unknown name) must surface here as a leg
      // outcome. The message names the provider, never a credential.
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`google-search source: SERP provider error: ${message}`);
      return { unavailable: true, reason: "serp_provider_config" };
    }
    if ("unavailable" in result) {
      return result;
    }

    return {
      payload: buildSnapshotPayload({
        domain,
        query,
        provider: result.provider,
        fetchedAt: new Date().toISOString(),
        ads: result.ads,
        organic: result.organic,
        prev: (prev?.payload ?? null) as GoogleSerpSnapshotPayload | null,
      }),
    };
  },
  diff(prev: SourceSnapshotRecord | null, next: SourceSnapshotInput): SourceChange[] {
    return diffGoogleSerpSnapshots(
      (prev?.payload ?? null) as GoogleSerpSnapshotPayload | null,
      next.payload as GoogleSerpSnapshotPayload,
    );
  },
  Section: GoogleSearchSection,
};

/**
 * Whether an ISO timestamp falls on the same UTC calendar day as `now`. An
 * unparseable stored `fetchedAt` is treated as a different day — a malformed
 * timestamp must not suppress today's fetch.
 */
function isSameUtcDay(fetchedAt: string, now: Date): boolean {
  const parsed = Date.parse(fetchedAt);
  if (!Number.isFinite(parsed)) return false;
  return new Date(parsed).toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
}
