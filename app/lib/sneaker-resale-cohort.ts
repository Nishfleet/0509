/**
 * Pure cohort derivation for the sneaker-resale cluster (issue #1946, phase 1).
 *
 * The cohort is the subset of `data/seed-lists/sneaker-resale.json` whose
 * domains already carry >=1 verified-or-likely ad row in the existing
 * `public_search` discovery cache (the BET 5 publisher's write path). A brand
 * with no cache row, an expired cache row, a non-`public_search` row, or
 * only `unmatched` ads is `hasCoverage: false` and is excluded.
 *
 * This module is deliberately a pure helper: no D1 imports, no server-only
 * dependencies, no provider calls. The D1 lookup that produces
 * `tierByDomain` lives in `app/lib/sneaker-resale-cohort.server.ts`, which
 * is also read-only.
 */

import type { SeedList } from "./ads-domain-publisher.server";
import {
  isLikelyDomainMatchLevel,
  isVerifiedDomainMatchLevel,
  type DomainMatchLevel,
} from "./search-domain-match";

/**
 * Per-domain tier counts derived from the publisher's most recent
 * `public_search` discovery cache row. The shape is intentionally compact so
 * the backfill that consumes this map (phase 2) can decide inclusion with
 * a single boolean — `hasCoverage` — without re-counting every match level.
 */
export interface SneakerResaleTier {
  /** Number of ads whose `domainMatch.level` is a verified match level. */
  verifiedCount: number;
  /** Number of ads whose `domainMatch.level` is `likely_brand_name`. */
  likelyCount: number;
  /** Number of ads whose tier is `unmatched` (provider returned, no link). */
  unmatchedCount: number;
  /**
   * `true` when the brand has at least one verified OR likely ad. A brand
   * with only `unmatched` ads stays out of the cohort — no phantom offer
   * timeline is ever created.
   */
  hasCoverage: boolean;
  /** `fresh` when a non-expired row was found; `stale` otherwise. */
  cacheStatus: "fresh" | "stale";
}

/** One cohort entry: a seed-list brand with verified-or-likely coverage. */
export interface SneakerResaleCohortEntry {
  /** Canonicalized domain (lowercase, leading `www.` stripped). */
  domain: string;
  /** Display brand name from the seed list, when present. */
  brand?: string;
  /** The tier counts backing the inclusion decision. */
  tier: SneakerResaleTier;
}

/**
 * Canonicalize a domain for cohort membership. Mirrors the publisher's
 * `validateSeedList` (lowercase, leading `www.` stripped, trailing dot
 * dropped) so a seed entry like `WWW.StockX.com` and the publisher's
 * `cache_key` for `stockx.com` compare equal. Returns `null` for empty /
 * non-string input so the helper stays total over a possibly-untrusted
 * seed list.
 */
export function canonicalizeSneakerResaleDomain(input: unknown): string | null {
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
 * Build an empty `SneakerResaleTier`. Used when the publisher hasn't
 * written a row for a domain yet but the helper still needs to surface the
 * shape — the backfill ignores `hasCoverage: false` entries.
 */
export function emptySneakerResaleTier(): SneakerResaleTier {
  return {
    verifiedCount: 0,
    likelyCount: 0,
    unmatchedCount: 0,
    hasCoverage: false,
    cacheStatus: "stale",
  };
}

/**
 * Count tier hits for a flat list of ad match levels. Exported so the
 * server-side adapter (`sneaker-resale-cohort.server.ts`) and tests share
 * the same predicate; the backfill must rely on the same predicate the
 * cohort helper uses or the count-vs-cohort contract drifts.
 */
export function countSneakerResaleTier(levels: readonly string[]): {
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
 * Derive the cohort from a seed list and a per-domain tier map.
 *
 * Inclusion rule: a seed entry is in the cohort when (a) its canonicalized
 * domain appears in `tierByDomain` AND (b) that entry's `hasCoverage` is
 * `true`. Empty seed lists yield an empty cohort; missing tier entries keep
 * their seed brand off the cohort (no phantom timeline); duplicate seed
 * domains are collapsed.
 */
export function deriveSneakerResaleCohort(
  seedList: SeedList,
  tierByDomain: ReadonlyMap<string, SneakerResaleTier>,
): SneakerResaleCohortEntry[] {
  const cohort: SneakerResaleCohortEntry[] = [];
  if (!Array.isArray(seedList?.domains)) {
    return cohort;
  }
  const seen = new Set<string>();
  for (const entry of seedList.domains) {
    const canonical = canonicalizeSneakerResaleDomain(entry?.domain);
    if (!canonical || seen.has(canonical)) {
      continue;
    }
    const tier = tierByDomain.get(canonical);
    if (!tier || !tier.hasCoverage) {
      continue;
    }
    seen.add(canonical);
    cohort.push({
      domain: canonical,
      brand: typeof entry?.brand === "string" ? entry.brand : undefined,
      tier,
    });
  }
  return cohort;
}