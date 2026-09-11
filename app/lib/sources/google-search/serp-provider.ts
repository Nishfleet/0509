/**
 * SERP provider seam (#2181, seam #2218).
 *
 * Types only: no IO, no dependencies, nothing to mock. The Google Search
 * source adapter picks a `SerpProvider` by `SERP_PROVIDER` and consumes this
 * shape without knowing which vendor is behind it. `decodo` is the only
 * shipped provider (see serp-provider-decodo.server.ts).
 */

/** A paid (sponsored) result row. */
export interface SerpAd {
  position: number;
  /** The advertiser's domain, from the displayed host where one exists. */
  advertiser_domain: string;
  title: string;
  url: string;
  snippet: string;
}

/** An organic result row. */
export interface SerpOrganic {
  /** Rank within the organic block (`pos`, falling back to `pos_overall`). */
  position: number;
  /** Host of the result url, with a leading "www." stripped. */
  domain: string;
  title: string;
  url: string;
  snippet: string;
}

/** A successfully fetched SERP, already normalized for storage. */
export interface SerpResult {
  query: string;
  /** ISO-8601 timestamp of the fetch. */
  fetched_at: string;
  provider: string;
  /** Paid results. An empty list is a real "no sponsored results", never a failure. */
  ads: SerpAd[];
  /** Organic results. An empty list is a real "no organic results". */
  organic: SerpOrganic[];
}

/**
 * A fetch that could not produce a SERP. `reason` is a machine-readable,
 * stable string (`not_configured`, `quota`, `fetch_error`, `decodo_bad_json`,
 * `decodo_http_<status>`, `decodo_no_result`, `decodo_status_<code>`,
 * `decodo_parse_break`) so callers can branch without parsing prose.
 */
export interface SerpUnavailable {
  unavailable: true;
  reason: string;
}

export interface SerpProvider {
  /** `gl`/`hl` are fixed to the US/English market the seam watches. */
  search(input: { query: string; gl: "us"; hl: "en" }): Promise<SerpResult | SerpUnavailable>;
}
