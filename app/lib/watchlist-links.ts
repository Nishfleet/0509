import { isHttpCompetitorWebsite } from "~/lib/competitor-website";

export interface WatchlistLinkTarget {
  targetType: string;
  targetId: string;
  targetLabel: string;
  targetCountry: string | null;
}

/**
 * Cross-link (workflow-friction pass): prefilled live search for the
 * competitor a watchlist tracks. Website-backed watchlists reuse the website
 * field (so search-v2 domain relevance applies); saved-query/label-only
 * watchlists fall back to an advertiser-mode query.
 */
export function watchlistLiveSearchHref(watchlist: WatchlistLinkTarget) {
  const params = new URLSearchParams();
  if (watchlist.targetType === "advertiser" && isHttpCompetitorWebsite(watchlist.targetId)) {
    params.set("website", watchlist.targetId);
  } else {
    params.set("mode", "advertiser");
    params.set("query", watchlist.targetLabel);
  }
  if (watchlist.targetCountry) {
    params.set("country", watchlist.targetCountry);
  }
  return `/search?${params.toString()}`;
}

/** Cross-link: saved ads for this competitor on the boards route. */
export function watchlistSavedAdsHref(watchlist: Pick<WatchlistLinkTarget, "targetLabel">) {
  return `/app/collections?advertiser=${encodeURIComponent(watchlist.targetLabel)}`;
}

/** Case-insensitive advertiser filter used by the collections route. */
export function matchesAdvertiserFilter(
  advertiser: string | null | undefined,
  filter: string | null | undefined,
) {
  const needle = (filter ?? "").trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return (advertiser ?? "").toLowerCase().includes(needle);
}

export interface WatchedCompetitorCandidate {
  id: string;
  name: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  trackingRole?: string;
}

/**
 * Cheap "already watched?" check for the search results page: matches the
 * searched website host against website-backed watchlists, else the query
 * against the tracked label. Self-brand watchlists never count as a watched
 * competitor.
 */
export function findWatchedCompetitor(
  watchlists: readonly WatchedCompetitorCandidate[],
  input: { host: string | null; query: string | null },
): { id: string; name: string } | null {
  const host = input.host?.toLowerCase().replace(/^www\./, "") ?? null;
  const query = input.query?.trim().toLowerCase() ?? null;

  for (const watchlist of watchlists) {
    if (watchlist.trackingRole === "self") {
      continue;
    }

    if (host && watchlist.targetType === "advertiser" && isHttpCompetitorWebsite(watchlist.targetId)) {
      try {
        const watchedHost = new URL(watchlist.targetId).hostname.toLowerCase().replace(/^www\./, "");
        if (watchedHost === host) {
          return { id: watchlist.id, name: watchlist.name };
        }
      } catch {
        // Malformed stored URL — fall through to the label match.
      }
    }

    if (query && watchlist.targetLabel.trim().toLowerCase() === query) {
      return { id: watchlist.id, name: watchlist.name };
    }
  }

  return null;
}
