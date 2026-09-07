/**
 * Domain-match levels and the customer-facing three-tier mapping.
 *
 * Lives outside `*.server.ts` so client display code can label a row
 * verified / likely / unmatched without pulling server-only modules
 * into the browser bundle.
 */

export type DomainMatchLevel =
  | "exact_hostname"
  | "registrable_domain"
  | "verified_advertiser_domain"
  | "verified_alias"
  | "verified_entity"
  | "likely_brand_name"
  | "unverified_text_candidate"
  | "unverified_provider_candidate";

/**
 * The three customer-facing result tiers (BET 2). Every candidate lands in
 * exactly one: `verified` (advertiser or landing page provably linked to the
 * searched domain), `likely` (brand-name match, the advertiser IS the brand
 * but no website link was captured), or `unmatched` (returned by the provider
 * with no brand connection, including keyword-only text mentions). The free
 * preview never dead-ends: an unmatched row is still a row, labelled as such.
 */
export type DomainMatchTier = "verified" | "likely" | "unmatched";

const VERIFIED_LEVELS = new Set<DomainMatchLevel>([
  "exact_hostname",
  "registrable_domain",
  "verified_advertiser_domain",
  "verified_alias",
  "verified_entity",
]);

const LIKELY_LEVELS = new Set<DomainMatchLevel>(["likely_brand_name"]);

export function isVerifiedDomainMatchLevel(level: DomainMatchLevel) {
  return VERIFIED_LEVELS.has(level);
}

export function isLikelyDomainMatchLevel(level: DomainMatchLevel) {
  return LIKELY_LEVELS.has(level);
}

/**
 * Map a match level to its customer-facing tier. `undefined`/unknown levels
 * (a raw provider ad with no explanation) are `unmatched` — the provider
 * returned them but nothing connects them to the searched brand.
 */
export function domainMatchTier(
  level: DomainMatchLevel | string | null | undefined,
): DomainMatchTier {
  if (typeof level === "string" && VERIFIED_LEVELS.has(level as DomainMatchLevel)) {
    return "verified";
  }
  if (typeof level === "string" && LIKELY_LEVELS.has(level as DomainMatchLevel)) {
    return "likely";
  }
  return "unmatched";
}
