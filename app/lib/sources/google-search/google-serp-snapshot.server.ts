/**
 * Google Search (Decodo SERP) — snapshot payload building + diff (#2181 do:4).
 *
 * The seam's generic `runSources` path stores the adapter payload verbatim
 * and calls `adapter.diff(prev, next)`; the seam emits each returned
 * SourceChange through the existing Meta alert path (`createWatchEvent`)
 * tagged with `sourceId` in metadata. This module owns the payload shape and
 * the diff logic; it does not emit alerts itself.
 *
 * The stored payload is the public brand page's read contract
 * (`app/components/brand-page/source-sections.tsx` `GoogleSearchBrandSection`
 * reads `fetchedAt`, `sponsoredAdvertisers` and
 * `organic[].{position,url,title,prevPosition}`). `prevPosition` is computed
 * here from the previous stored snapshot, so the page's up/down delta
 * rendering works without a second read.
 *
 * Diff cases (issue #2181 do:4), each producing AT MOST one SourceChange:
 * - a sponsored advertiser domain appears / disappears (ad_new / ad_inactive)
 * - the competitor's own domain moves 3+ organic positions inside the top 10
 *   (website_page_changed)
 * - the own domain leaves / enters the top 10
 *   (website_page_removed / website_page_added)
 * - other domains newly present in the top 10 (website_page_added)
 *
 * Unavailable never blocks the Meta check — the adapter returns unavailable
 * from `fetch` and the seam stores nothing, so `diff` is never called with a
 * failed snapshot.
 */

import type { JsonRecord } from "~/lib/data/helpers.server";
import type { SourceChange } from "~/lib/sources/types";
import type { SerpAd, SerpOrganic } from "~/lib/sources/google-search/serp-provider";

/**
 * How many ranked organic rows the stored payload keeps. Membership is decided
 * by rank ORDER, never by the absolute position number: the mapper falls back
 * to the page rank (`pos_overall`) when a row has no organic `pos`, so a
 * numeric `position <= 10` cutoff would drop a real top-10 row and let a
 * dropped own-domain row fire a false "left the top 10".
 */
const TOP_ORGANIC_ROWS = 10;

/**
 * An own-domain move smaller than this is noise (a single promoted or demoted
 * result) and stays silent; exactly 3 fires.
 */
const OWN_DOMAIN_MOVE_THRESHOLD = 3;

export interface GoogleSerpOrganicRow extends SerpOrganic {
  /**
   * The position this url held in the previous stored snapshot, or null when
   * there is no previous snapshot or the url did not appear in it.
   */
  prevPosition: number | null;
}

export interface GoogleSerpSnapshotPayload extends JsonRecord {
  /** The competitor's registrable domain, e.g. "nike.com". */
  domain: string;
  /** The brand query actually sent to the provider. */
  query: string;
  /** The provider that answered, e.g. "decodo". */
  provider: string;
  /** ISO-8601 timestamp of the fetch. */
  fetchedAt: string;
  /**
   * Unique sponsored advertiser domains, first-seen order preserved,
   * lowercased, leading "www." stripped. The diff normalizes both sides the
   * same way, so a stored entry keeps its meaning whatever casing or "www."
   * prefix an older payload wrote.
   */
  sponsoredAdvertisers: string[];
  /** The mapped sponsored rows, as returned by the provider. */
  ads: SerpAd[];
  /**
   * The `TOP_ORGANIC_ROWS` best-ranked rows (see `topOrganicRows`), ascending,
   * each carrying its previous position for delta display. A row with no
   * usable position is never stored.
   */
  organic: GoogleSerpOrganicRow[];
}

/**
 * Build the stored snapshot payload from a successful fetch: the ranked top
 * 10 organic rows with their previous positions, and the sponsored advertiser
 * list.
 *
 * Pure and non-mutating: the caller's arrays and rows are read, never written
 * (the sorted list is a copy of the row objects).
 */
export function buildSnapshotPayload(input: {
  domain: string;
  query: string;
  provider: string;
  fetchedAt: string;
  ads: SerpAd[];
  organic: SerpOrganic[];
  /** The previous stored snapshot, used for `prevPosition` only. */
  prev: GoogleSerpSnapshotPayload | null;
}): GoogleSerpSnapshotPayload {
  // Previous positions are read off the SAME top-10 set the diff uses, so the
  // builder and the diff agree: a previous row outside the top 10 is not a
  // previous position. A stored payload may be older or partial, so a
  // missing/!Array organic block reads as "no previous rows" rather than
  // throwing. Rows come back in rank order, so the first occurrence of a key
  // is the best rank for that key.
  const prevByUrl = new Map<string, number>();
  const prevByPath = new Map<string, number>();
  for (const row of topOrganicRows(readOrganicRows(input.prev))) {
    const keys = urlMatchKeys(row.url);
    if (!keys) continue;
    if (!prevByUrl.has(keys.exact)) prevByUrl.set(keys.exact, row.position);
    if (!prevByPath.has(keys.hostPath)) prevByPath.set(keys.hostPath, row.position);
  }

  // The top 10 by rank order, mapped to the stored row shape. The caller's
  // array and rows are read, never written: filter copies the array, sort,
  // map and the row literals copy again.
  const topRows = topOrganicRows(input.organic).map((row) => {
    const keys = urlMatchKeys(row.url);
    return {
      position: row.position,
      domain: row.domain,
      title: row.title,
      url: row.url,
      snippet: row.snippet,
      prevPosition: keys ? (prevByUrl.get(keys.exact) ?? prevByPath.get(keys.hostPath) ?? null) : null,
    };
  });

  return {
    domain: input.domain,
    query: input.query,
    provider: input.provider,
    fetchedAt: input.fetchedAt,
    sponsoredAdvertisers: advertiserDomains(input.ads),
    ads: [...input.ads],
    organic: topRows,
  };
}

/**
 * Diff the previous and next Google Search snapshots. Returns [] for the
 * first snapshot (no baseline) and [] when `next` is malformed (either list
 * missing or !Array) — never throws, matching `diffGoogleAdsSnapshots`.
 *
 * The PREVIOUS payload is guarded per category instead, so a partial older
 * payload still produces the alerts it can support: the advertiser rules need
 * only `prev.sponsoredAdvertisers` to be an array and the organic rules need
 * only `prev.organic` to be an array.
 *
 * `next.domain` is the competitor's own domain. Its organic presence is
 * matched case-insensitively; a crossing in or out of the top 10 emits only
 * the enter/leave change, never also a move change.
 */
export function diffGoogleSerpSnapshots(
  prev: GoogleSerpSnapshotPayload | null,
  next: GoogleSerpSnapshotPayload,
): SourceChange[] {
  if (!prev) return [];
  // `next` is read whole: a malformed `next` list would make every rule read as
  // a change (a missing `next.organic` reads as the own domain having
  // vanished), so a malformed `next` keeps the whole diff silent.
  if (!isReadableSnapshot(next)) return [];

  const changes: SourceChange[] = [];

  // 1/2. Sponsored advertiser domains. Both sides go through the same
  // normalization (trim, lowercase, no leading "www.") and dedupe, so neither
  // a stored "WWW.Adidas.com" beside "adidas.com" nor a blank or repeated
  // entry can produce a contradictory ad_new + ad_inactive pair in one run.
  // A previous payload with no usable advertiser list skips only this block.
  if (Array.isArray(prev.sponsoredAdvertisers)) {
    const prevAdvertisers = uniqueAdvertiserDomains(prev.sponsoredAdvertisers);
    const nextAdvertisers = uniqueAdvertiserDomains(next.sponsoredAdvertisers);
    const prevAdvertiserSet = new Set(prevAdvertisers);
    const nextAdvertiserSet = new Set(nextAdvertisers);

    const addedAdvertisers = nextAdvertisers.filter((domain) => !prevAdvertiserSet.has(domain));
    if (addedAdvertisers.length > 0) {
      changes.push({
        eventType: "ad_new",
        title: `${count(addedAdvertisers.length, "new sponsored advertiser")} on ${next.domain}`,
        summary: `New sponsored advertiser${plural(addedAdvertisers.length)} on ${next.domain}: ${addedAdvertisers.join(", ")}.`,
        metadata: { category: "new_sponsored_advertisers", advertiserDomains: addedAdvertisers },
      });
    }

    const removedAdvertisers = prevAdvertisers.filter((domain) => !nextAdvertiserSet.has(domain));
    if (removedAdvertisers.length > 0) {
      changes.push({
        eventType: "ad_inactive",
        title: `${count(removedAdvertisers.length, "sponsored advertiser")} gone from ${next.domain}`,
        summary: `No longer sponsoring on ${next.domain}: ${removedAdvertisers.join(", ")}.`,
        metadata: { category: "removed_sponsored_advertisers", advertiserDomains: removedAdvertisers },
      });
    }
  }

  // 3/4/5/6. The organic rules, guarded as their own category: skipped only
  // when the previous payload has no usable organic list (an older/partial
  // payload — an empty array is a real "no organic results" and still runs
  // them).
  if (Array.isArray(prev.organic)) {
    // The competitor's own domain inside the organic list. Both helpers read
    // the shared top-10 set, so "non-null" IS "in the top 10" and the three
    // rules below are mutually exclusive. The topmost row wins for a domain (a
    // duplicated domain is a rare shape; the best rank is the one worth
    // alerting on). The own domain is matched through `isOwnDomain`, so an own
    // subdomain row counts as the own domain.
    const own = normalizeDomain(next.domain);
    if (own) {
      const prevOwn = topPositionForDomain(prev.organic, own);
      const nextOwn = topPositionForDomain(next.organic, own);

      if (prevOwn !== null && nextOwn === null) {
        // 4. Left the top 10 — and, this being a top-10-only payload, absent
        // from the organic rows entirely.
        changes.push({
          eventType: "website_page_removed",
          title: `${next.domain} left the Google top 10`,
          summary: `${next.domain} was #${prevOwn} and is no longer in the top 10 organic results.`,
          metadata: { category: "own_domain_left_top10", domain: next.domain, from: prevOwn },
        });
      } else if (prevOwn === null && nextOwn !== null) {
        // 5. Entered the top 10.
        changes.push({
          eventType: "website_page_added",
          title: `${next.domain} entered the Google top 10`,
          summary: `${next.domain} is now #${nextOwn} in the top 10 organic results.`,
          metadata: { category: "own_domain_entered_top10", domain: next.domain, to: nextOwn },
        });
      } else if (prevOwn !== null && nextOwn !== null) {
        // 3. Moved while staying in the top 10.
        const delta = nextOwn - prevOwn;
        if (Math.abs(delta) >= OWN_DOMAIN_MOVE_THRESHOLD) {
          const direction = delta > 0 ? "down" : "up";
          changes.push({
            eventType: "website_page_changed",
            title: `${next.domain} moved ${direction} ${Math.abs(delta)} in Google Search`,
            summary: `${next.domain} moved ${direction} ${Math.abs(delta)} position${plural(Math.abs(delta))} on Google Search: #${prevOwn} to #${nextOwn}.`,
            metadata: {
              category: "own_domain_move",
              domain: next.domain,
              from: prevOwn,
              to: nextOwn,
              delta,
            },
          });
        }
      }
    }

    // 6. Other domains newly present in the top 10. The own domain (or any of
    // its subdomains) is excluded so entering the top 10 is reported once
    // (rules 3/4/5), not twice.
    const prevDomains = new Set(domainsInOrder(topOrganicRows(prev.organic)));
    const newTop10Domains = domainsInOrder(topOrganicRows(next.organic)).filter(
      (domain) => !isOwnDomain(domain, own) && !prevDomains.has(domain),
    );
    if (newTop10Domains.length > 0) {
      changes.push({
        eventType: "website_page_added",
        title: `${count(newTop10Domains.length, "new domain")} in the Google top 10`,
        summary: `New in the top 10 organic results: ${newTop10Domains.join(", ")}.`,
        metadata: { category: "new_top10_domains", domains: newTop10Domains },
      });
    }
  }

  return changes;
}

/**
 * The stored shape `next` must have for a diff to mean anything: both lists it
 * compares must be arrays. (`ads` is not read here — only
 * `sponsoredAdvertisers`, which is the derived advertiser list — so a payload
 * without it is still a usable baseline.) The previous payload is guarded per
 * category in the diff body instead.
 */
function isReadableSnapshot(payload: GoogleSerpSnapshotPayload): boolean {
  return Array.isArray(payload.sponsoredAdvertisers) && Array.isArray(payload.organic);
}

/** Organic rows off a stored payload, or [] when that block is unusable. */
function readOrganicRows(payload: GoogleSerpSnapshotPayload | null): GoogleSerpOrganicRow[] {
  const rows = payload?.organic;
  return Array.isArray(rows) ? rows : [];
}

/**
 * Collapse the sponsored rows to a unique advertiser domain list: first-seen
 * order preserved, lowercased, a leading "www." stripped, empties dropped.
 */
function advertiserDomains(ads: SerpAd[]): string[] {
  const seen = new Set<string>();
  const domains: string[] = [];
  for (const ad of ads) {
    const domain = normalizeDomain(ad.advertiser_domain);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    domains.push(domain);
  }
  return domains;
}

/**
 * Unique advertiser domains, first-seen order preserved: trimmed, lowercased,
 * a leading "www." stripped, blanks and non-strings dropped. Normalizing here
 * as well as in the builder is what keeps a stored "WWW.Adidas.com" and a
 * stored "adidas.com" from reading as one domain added and one removed.
 */
function uniqueAdvertiserDomains(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const domains: string[] = [];
  for (const value of values) {
    const domain = normalizeDomain(value);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    domains.push(domain);
  }
  return domains;
}

/**
 * The ranked top of an organic list: rows with a usable position, best rank
 * first, capped at `TOP_ORGANIC_ROWS`. This is the one membership rule the
 * builder and the diff both use.
 *
 * Rank ORDER decides membership, not the absolute number: the mapper falls
 * back to the page rank (`pos_overall`) when a row has no organic `pos`, so a
 * `position <= 10` filter would drop a real top-10 row and let a dropped
 * own-domain row fire a false "left the top 10". A row with no usable position
 * (non-finite, or the 0 the mapper can emit) is neither stored nor diffable.
 * Ties break on domain then url, so the stored order is deterministic.
 *
 * Reads the caller's rows and returns a new sorted array of those same rows.
 */
function topOrganicRows<T extends SerpOrganic>(rows: readonly T[]): T[] {
  return rows.filter((row) => validPosition(row.position)).sort(compareRank).slice(0, TOP_ORGANIC_ROWS);
}

/** Rank order: position ascending, then domain, then url, for determinism. */
function compareRank(a: SerpOrganic, b: SerpOrganic): number {
  if (a.position !== b.position) return a.position - b.position;
  const aDomain = normalizeDomain(a.domain);
  const bDomain = normalizeDomain(b.domain);
  if (aDomain !== bDomain) return aDomain < bDomain ? -1 : 1;
  if (a.url === b.url) return 0;
  return a.url < b.url ? -1 : 1;
}

/** A position this module can rank and diff: finite and at least 1. */
function validPosition(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1;
}

/**
 * Whether a normalized organic domain is the own domain or a subdomain of it.
 * The watchlist stores the registrable domain ("nike.com") while an organic
 * row stores the raw host ("store.nike.com"), so an exact match would miss the
 * competitor's own subdomains. A blank own domain matches nothing.
 */
function isOwnDomain(domain: string, own: string): boolean {
  if (!domain || !own) return false;
  return domain === own || domain.endsWith(`.${own}`);
}

/** Domains of the organic rows in rank order, deduped, first-seen order kept. */
function domainsInOrder(rows: GoogleSerpOrganicRow[]): string[] {
  const seen = new Set<string>();
  const domains: string[] = [];
  for (const row of rows) {
    const domain = normalizeDomain(row.domain);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    domains.push(domain);
  }
  return domains;
}

/**
 * The best (lowest) position among the top-10 rows of `domain` or one of its
 * subdomains, or null when the domain is not in the top 10. `domain` is already
 * normalized. Membership comes from `topOrganicRows`, so it cannot drift from
 * the set the builder stored.
 */
function topPositionForDomain(rows: readonly GoogleSerpOrganicRow[], domain: string): number | null {
  let best: number | null = null;
  for (const row of topOrganicRows(rows)) {
    if (!isOwnDomain(normalizeDomain(row.domain), domain)) continue;
    if (best === null || row.position < best) best = row.position;
  }
  return best;
}

/** A host or domain as this module compares it: trimmed, lowercased, no "www.". */
function normalizeDomain(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim().toLowerCase();
  return value.startsWith("www.") ? value.slice(4) : value;
}

/**
 * The two keys a result url is matched on across snapshots, or null when there
 * is no url at all.
 *
 * `exact` is the canonical url with the host lowercased. The path, query and
 * fragment are left exactly as the provider returned them: url paths are
 * case-sensitive, so lowercasing them would merge two genuinely different
 * pages and hide a real ranking change.
 *
 * `hostPath` (host plus pathname, query and fragment dropped) is the
 * documented fallback, consulted only when nothing matched exactly. Google
 * attaches ephemeral tracking params and `#:~:text=` scroll-to-text fragments
 * to a result it is still showing in the same spot; without the fallback that
 * silently nulls `prevPosition` and reads as a brand-new entry. The trade-off:
 * two results that share a path but differ in the query as genuinely different
 * pages (per-variant urls) are read as one url moving, not as a new one. A
 * result without a usable url is not matched at all. An unparseable string is
 * its own single key, trimmed and as-is.
 */
function urlMatchKeys(raw: unknown): { exact: string; hostPath: string } | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    parsed.hostname = parsed.hostname.toLowerCase();
    return { exact: parsed.href, hostPath: `${parsed.host}${parsed.pathname}` };
  } catch {
    return { exact: value, hostPath: value };
  }
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${plural(n)}`;
}
