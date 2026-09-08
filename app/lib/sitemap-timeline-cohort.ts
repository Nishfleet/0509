/**
 * Pure cohort derivation for sitemap-listed /timeline/:domain pages
 * (issue #1958, phase 1).
 *
 * The nightly sitemap-timeline backfill (phase 2) captures the homepages of
 * domains that (a) appear in the indexable timeline sitemap
 * (`loadIndexableTimelineEntries` — the complete-proof + non-ad-destination
 * gate, applied for free by reusing that set) and (b) carry >=1 verified-or-
 * likely ad row in the existing `public_search` discovery cache — the same
 * evidence rule the sneaker-resale cohort uses (issue #1946). A domain with
 * no cache row, or only `unmatched` ads, is `hasCoverage: false` and stays
 * off the cohort: its existing /timeline/:domain ledger is honest and must
 * not be overwritten by a phantom capture.
 *
 * Pure helper by design: no D1 imports, no server-only dependencies, no
 * provider calls. The D1 lookups that produce `tierByDomain` and the
 * candidate-domain list live in `app/lib/sitemap-timeline-cohort.server.ts`.
 * Sibling shape to `app/lib/sneaker-resale-cohort.ts`; types are defined
 * locally (never imported from the sneaker module) so the two cohorts can
 * evolve independently.
 */

import {
  isLikelyDomainMatchLevel,
  isVerifiedDomainMatchLevel,
  type DomainMatchLevel,
} from "./search-domain-match";

/**
 * Per-domain tier counts derived from the most recent `public_search`
 * discovery cache row. Compact shape so the backfill (phase 2) can decide
 * inclusion with a single boolean — `hasCoverage` — without re-counting
 * every match level.
 */
export interface SitemapTimelineTier {
  /** Number of ads whose `domainMatch.level` is a verified match level. */
  verifiedCount: number;
  /** Number of ads whose `domainMatch.level` is `likely_brand_name`. */
  likelyCount: number;
  /** Number of ads whose tier is `unmatched` (provider returned, no link). */
  unmatchedCount: number;
  /**
   * `true` when the domain has at least one verified OR likely ad. A domain
   * with only `unmatched` ads stays out of the cohort — no phantom offer
   * timeline is ever captured over its existing ledger.
   */
  hasCoverage: boolean;
  /**
   * `fresh` when the row backing the verdict had `expires_at > now` at read
   * time; `stale` otherwise. Unlike the sneaker adapter, the tier read does
   * NOT filter on expiry (manager decision, issue #1958 phase 1): calendly /
   * adspyder rows have no scheduled writer to refresh them, so an expiry
   * gate would empty the cohort at night and the freeze would persist. The
   * verdict is a durable per-domain evidence fact; the row's age is surfaced
   * here instead so the backfill can still see how old the evidence is.
   */
  cacheStatus: "fresh" | "stale";
}

/**
 * One cohort entry: a sitemap-listed timeline domain with verified-or-likely
 * coverage. There is no brand name to carry — the sitemap paths only ever
 * carry the registrable domain.
 */
export interface SitemapTimelineCohortEntry {
  /** Canonicalized domain (lowercase, leading `www.` stripped). */
  domain: string;
  /** The tier counts backing the inclusion decision. */
  tier: SitemapTimelineTier;
}

/**
 * Build an empty `SitemapTimelineTier`. Used when no discovery cache row
 * exists for a domain yet but the helper still needs to surface the shape —
 * the backfill ignores `hasCoverage: false` entries.
 */
export function emptySitemapTimelineTier(): SitemapTimelineTier {
  return {
    verifiedCount: 0,
    likelyCount: 0,
    unmatchedCount: 0,
    hasCoverage: false,
    cacheStatus: "stale",
  };
}

/**
 * Canonicalize a domain for cohort membership. Same contract as
 * `canonicalizeSneakerResaleDomain` and the publisher's `validateSeedList`:
 * lowercase, trimmed, trailing dot dropped, leading `www.` stripped — so a
 * sitemap path like `/timeline/WWW.Calendly.com` and the publisher's
 * `cache_key` for `calendly.com` compare equal. Returns `null` for
 * empty / non-string input so the helper stays total over possibly-untrusted
 * input.
 */
export function canonicalizeSitemapTimelineDomain(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const trimmed = input.trim().toLowerCase().replace(/\.$/, "");
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/^www\./, "");
}

/**
 * Count tier hits for a flat list of ad match levels. Exported so the
 * server-side adapter (`sitemap-timeline-cohort.server.ts`) and tests share
 * the same predicate; the backfill must rely on the same predicate the
 * cohort helper uses or the count-vs-cohort contract drifts.
 */
export function countSitemapTimelineTier(levels: readonly (string | unknown)[]): {
  verifiedCount: number;
  likelyCount: number;
  unmatchedCount: number;
} {
  let verifiedCount = 0;
  let likelyCount = 0;
  let unmatchedCount = 0;
  for (const raw of levels) {
    if (typeof raw !== "string" || !raw) {
      unmatchedCount += 1;
      continue;
    }
    if (isVerifiedDomainMatchLevel(raw as DomainMatchLevel)) {
      verifiedCount += 1;
    } else if (isLikelyDomainMatchLevel(raw as DomainMatchLevel)) {
      likelyCount += 1;
    } else {
      unmatchedCount += 1;
    }
  }
  return { verifiedCount, likelyCount, unmatchedCount };
}

/**
 * Recover the registrable domain param from a `/timeline/:domain` sitemap
 * path. The sitemap emits exactly this shape (see
 * `indexableTimelineEntriesFromRows` in app/lib/sitemap.server.ts), so the
 * extractor only needs to pin the shape: the path must start with
 * `/timeline/`, have a single non-empty segment after the prefix, and that
 * segment must canonicalize. Multi-segment paths (`/timeline/foo/bar`) and
 * locale-prefixed paths (`/de/timeline/calendly.com`) return null — the
 * registrable domain is never guessed from a partial or nested path. Pure.
 */
export function timelineDomainFromSitemapPath(path: string): string | null {
  if (typeof path !== "string" || !path.startsWith("/timeline/")) {
    return null;
  }
  const rest = path.slice("/timeline/".length);
  if (!rest || rest.includes("/")) {
    return null;
  }
  return canonicalizeSitemapTimelineDomain(rest);
}

/**
 * Reduce sitemap timeline entries to their registrable domains, deduped and
 * in first-seen order. Entries whose path does not map to a `/timeline/:domain`
 * are dropped (never guessed). Pure.
 */
export function timelineDomainsFromSitemapEntries(
  entries: readonly { path: string }[],
): string[] {
  const domains: string[] = [];
  if (!Array.isArray(entries)) {
    return domains;
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    const domain = timelineDomainFromSitemapPath(entry?.path);
    if (!domain || seen.has(domain)) {
      continue;
    }
    seen.add(domain);
    domains.push(domain);
  }
  return domains;
}

/**
 * Derive the cohort from the sitemap-listed candidate domains and a
 * per-domain tier map.
 *
 * Inclusion rule: a candidate is in the cohort when (a) its canonicalized
 * domain is not in `excludedDomains` (normalized through the same
 * canonicalizer, so `www.`/case variants of a demo or sneaker-seed domain
 * still exclude — those rails already own those domains' timelines) AND
 * (b) the tier map has an entry for it with `hasCoverage === true`. Empty
 * candidate lists yield an empty cohort; missing tier entries keep their
 * domain off the cohort (no phantom capture over an honest ledger);
 * duplicate candidates collapse.
 */
export function deriveSitemapTimelineCohort(
  candidateDomains: readonly string[],
  tierByDomain: ReadonlyMap<string, SitemapTimelineTier>,
  excludedDomains?: ReadonlySet<string> | readonly string[],
): SitemapTimelineCohortEntry[] {
  const cohort: SitemapTimelineCohortEntry[] = [];
  if (!Array.isArray(candidateDomains)) {
    return cohort;
  }

  const excluded = new Set<string>();
  if (excludedDomains) {
    for (const raw of excludedDomains) {
      const canonical = canonicalizeSitemapTimelineDomain(raw);
      if (canonical) {
        excluded.add(canonical);
      }
    }
  }

  const seen = new Set<string>();
  for (const raw of candidateDomains) {
    const canonical = canonicalizeSitemapTimelineDomain(raw);
    if (!canonical || seen.has(canonical) || excluded.has(canonical)) {
      continue;
    }
    const tier = tierByDomain.get(canonical);
    if (!tier || tier.hasCoverage !== true) {
      continue;
    }
    seen.add(canonical);
    cohort.push({
      domain: canonical,
      tier,
    });
  }
  return cohort;
}