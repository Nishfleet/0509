import {
  isLikelyDomainMatchLevel,
  isVerifiedDomainMatchLevel,
  type DomainMatchLevel,
} from "~/lib/search-domain-match";
import {
  comparableHostname,
  foldDomainLabel,
  hostnamesMatchBrandStemExtension,
  hostnamesMatchBrandVerifiedProperty,
  hostnamesMatchDomainIntent,
  registrableDomainFromHostname,
} from "~/lib/search-query";
import type { ParsedSearchQuery } from "~/lib/search-query";
import type { AdRecord } from "~/lib/types";

export {
  domainMatchTier,
  isLikelyDomainMatchLevel,
  isVerifiedDomainMatchLevel,
  type DomainMatchLevel,
  type DomainMatchTier,
} from "~/lib/search-domain-match";

export interface DomainMatchExplanation {
  level: DomainMatchLevel;
  matchedDomain: string | null;
  matchedSignal: string;
  confidenceCategory: "verified" | "likely" | "unverified";
  providerSource: AdRecord["source"];
  customerReason: string;
}

export interface DomainMatchedAd {
  ad: AdRecord;
  match: DomainMatchExplanation;
}

export function explainDomainMatch(
  ad: AdRecord,
  intent: ParsedSearchQuery,
  aliases: Set<string> = new Set(),
  identityAliases: string[] = [],
): DomainMatchExplanation | null {
  if (intent.intent !== "domain" || !intent.registrableDomain) {
    return null;
  }

  const landingHost = extractHostname(ad.landingPageUrl);
  if (landingHost && hostnamesMatchDomainIntent(landingHost, intent)) {
    const level =
      normalizeHostname(landingHost) === normalizeHostname(intent.hostname ?? "") ||
      comparableHostname(landingHost) === intent.comparableHostname
        ? "exact_hostname"
        : "registrable_domain";

    return buildExplanation(ad, level, landingHost, "landing_page_url", customerLandingReason(level, intent));
  }

  if (landingHost && hostnamesMatchBrandVerifiedProperty(landingHost, intent)) {
    return buildExplanation(
      ad,
      "verified_alias",
      landingHost,
      "regional_property",
      `Landing page matches ${comparableHostname(landingHost)}, a related site for ${displayDomain(intent)}`,
    );
  }

  if (
    landingHost &&
    hostnamesMatchBrandStemExtension(landingHost, intent) &&
    advertiserMatchesBrandStem(ad, intent)
  ) {
    return buildExplanation(
      ad,
      "verified_alias",
      landingHost,
      "brand_stem_property",
      `Landing page matches ${comparableHostname(landingHost)}, a product site for ${displayDomain(intent)}`,
    );
  }

  const snapshotHost = extractHostname(ad.adSnapshotUrl);
  if (snapshotHost && aliases.has(comparableHostname(snapshotHost))) {
    return buildExplanation(
      ad,
      "verified_alias",
      snapshotHost,
      "canonical_alias",
      `Landing page matches ${displayDomain(intent)}`,
    );
  }

  for (const alias of aliases) {
    if (landingHost && comparableHostname(landingHost) === comparableHostname(alias)) {
      return buildExplanation(
        ad,
        "verified_alias",
        landingHost,
        "audited_alias",
        `Landing page matches ${displayDomain(intent)}`,
      );
    }
  }

  const advertiserDomain = inferAdvertiserDomain(ad.advertiser);
  if (advertiserDomain && hostnamesMatchDomainIntent(advertiserDomain, intent)) {
    return buildExplanation(
      ad,
      "verified_advertiser_domain",
      advertiserDomain,
      "advertiser_domain",
      `Advertiser domain matches ${displayDomain(intent)}`,
    );
  }

  if (hasVerifiedEntityLink(ad, intent, identityAliases)) {
    return buildExplanation(
      ad,
      "verified_entity",
      intent.registrableDomain,
      "verified_entity",
      `Advertiser is linked to ${displayDomain(intent)}`,
    );
  }

  if (hasBrandNameMatch(ad, intent)) {
    return buildExplanation(
      ad,
      "likely_brand_name",
      intent.registrableDomain,
      "advertiser_name",
      `Advertiser name matches ${displayDomain(intent)} — website link not captured`,
    );
  }

  if (hasKeywordOnlyMatch(ad, intent)) {
    return buildExplanation(
      ad,
      "unverified_text_candidate",
      null,
      "keyword_only",
      `Mentions “${stemFromDomain(intent.registrableDomain)}” in ad text only`,
    );
  }

  return null;
}

export function classifyDomainMatches(
  ads: AdRecord[],
  intent: ParsedSearchQuery,
  options: { aliases?: string[]; identityAliases?: string[]; includeUnverified?: boolean } = {},
): DomainMatchedAd[] {
  const aliasSet = new Set((options.aliases ?? []).map((value) => comparableHostname(value)));
  const matched: DomainMatchedAd[] = [];

  for (const ad of ads) {
    const explanation = explainDomainMatch(ad, intent, aliasSet, options.identityAliases ?? []);
    if (!explanation) {
      continue;
    }

    if (
      !options.includeUnverified &&
      (explanation.level === "unverified_text_candidate" ||
        explanation.level === "likely_brand_name")
    ) {
      continue;
    }

    matched.push({ ad, match: explanation });
  }

  return matched.sort(
    (left, right) => domainMatchLevelRank(left.match.level) - domainMatchLevelRank(right.match.level),
  );
}

export function rankDomainMatches(matches: DomainMatchedAd[]) {
  return [...matches].sort((left, right) => {
    const levelDelta = domainMatchLevelRank(left.match.level) - domainMatchLevelRank(right.match.level);
    if (levelDelta !== 0) {
      return levelDelta;
    }

    if (left.ad.active !== right.ad.active) {
      return left.ad.active ? -1 : 1;
    }

    const leftSeen = Date.parse(left.ad.lastSeenAt ?? left.ad.firstSeenAt ?? "") || 0;
    const rightSeen = Date.parse(right.ad.lastSeenAt ?? right.ad.firstSeenAt ?? "") || 0;
    if (leftSeen !== rightSeen) {
      return rightSeen - leftSeen;
    }

    return left.ad.metaAdId.localeCompare(right.ad.metaAdId);
  });
}

export function dedupeDomainMatches(matches: DomainMatchedAd[]) {
  const seen = new Set<string>();
  const deduped: DomainMatchedAd[] = [];

  for (const entry of matches) {
    const key = [
      entry.ad.metaAdId,
      entry.ad.landingPageUrl ?? "",
      entry.ad.previewHeadline,
      entry.ad.format,
    ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(entry);
  }

  return deduped;
}

export function rejectGeographyKeywordOnlyMatch(ad: AdRecord, intent: ParsedSearchQuery) {
  const explanation = explainDomainMatch(ad, intent);
  return explanation?.level === "unverified_text_candidate";
}

function domainMatchLevelRank(level: DomainMatchLevel) {
  switch (level) {
    case "exact_hostname":
      return 0;
    case "registrable_domain":
      return 1;
    case "verified_advertiser_domain":
      return 2;
    case "verified_alias":
      return 3;
    case "verified_entity":
      return 4;
    case "likely_brand_name":
      return 5;
    case "unverified_text_candidate":
      return 6;
    case "unverified_provider_candidate":
      return 7;
    default:
      return 99;
  }
}

function buildExplanation(
  ad: AdRecord,
  level: DomainMatchLevel,
  matchedDomain: string | null,
  matchedSignal: string,
  customerReason: string,
): DomainMatchExplanation {
  return {
    level,
    matchedDomain,
    matchedSignal,
    confidenceCategory: isVerifiedDomainMatchLevel(level)
      ? "verified"
      : isLikelyDomainMatchLevel(level)
        ? "likely"
        : "unverified",
    providerSource: ad.source,
    customerReason,
  };
}

function customerLandingReason(level: DomainMatchLevel, intent: ParsedSearchQuery) {
  if (level === "exact_hostname" && intent.hostname) {
    return `Landing page matches ${intent.hostname}`;
  }

  return `Landing page matches ${displayDomain(intent)}`;
}

function displayDomain(intent: ParsedSearchQuery) {
  return intent.registrableDomain ?? intent.comparableHostname ?? intent.originalInput;
}

function hasVerifiedEntityLink(ad: AdRecord, intent: ParsedSearchQuery, identityAliases: string[]) {
  if (identityAliases.length === 0) {
    return false;
  }
  if (!advertiserIsBrandStem(ad, intent)) {
    return false;
  }

  const stem = foldDomainLabel(stemFromDomain(intent.registrableDomain ?? ""));
  if (!stem || stem.length < 3) {
    return false;
  }

  return identityAliases.some((alias) => identityAliasConfirmsStem(alias, stem));
}

function identityAliasConfirmsStem(alias: string, stem: string) {
  const head = alias.split(/[|–—:•]/)[0] ?? alias;
  const foldedHead = foldDomainLabel(head);
  const foldedAlias = foldDomainLabel(alias);
  const leading = foldDomainLabel(head.trim().split(/\s+/)[0] ?? "");
  return foldedHead === stem || foldedAlias === stem || leading === stem;
}

function advertiserMatchesBrandStem(ad: AdRecord, intent: ParsedSearchQuery) {
  return hasBrandNameMatch(ad, intent) || advertiserIsBrandStem(ad, intent);
}

function advertiserIsBrandStem(ad: AdRecord, intent: ParsedSearchQuery) {
  const stem = foldDomainLabel(stemFromDomain(intent.registrableDomain ?? ""));
  if (!stem || stem.length < 3) {
    return false;
  }

  const foldedAdvertiser = foldDomainLabel(ad.advertiser);
  if (foldedAdvertiser === stem) {
    return true;
  }

  const stripped = foldDomainLabel(stripBrandSuffixes(foldForMatch(ad.advertiser)));
  return stripped === stem;
}

/**
 * Cache-only advertiser-name → brand-stem match for the public /ads/:domain
 * page (issue #1428). Meta advertiser page names are space-separated
 * ("Sugar Cosmetics", "Bombay Shaving Company", "Ridge Wallet", "H&M") while
 * the domain label is the concatenated stem. `wordBoundaryMatch` on the raw
 * name misses these because the stem is not a contiguous token in the spaced
 * name; `foldDomainLabel` removes spaces/punctuation on both sides, so
 * "Sugar Cosmetics" → "sugarcosmetics" === stem. This is the cache-only twin
 * of the search pipeline's `advertiserIsBrandStem`, used by `adIsBrandOwned`
 * so a brand's own ads are not framed as "other advertisers" on the indexed
 * /ads/:domain surface.
 *
 * Two paths, both EXACT fold equality (never substring), so "Nykaam" →
 * "nykaam" ≠ "nykaa" stays false:
 *  1. The full advertiser name folds exactly to the stem. Allowed down to a
 *     2-char stem (e.g. "H&M" → "hm") because an exact full-name fold is safe
 *     where substring matching would not be — the whole page name must fold to
 *     the stem, nothing more.
 *  2. The advertiser name with common brand suffixes stripped ("Official",
 *     "India", "Inc", …) folds exactly to the stem, gated at stem length ≥ 3
 *     so a 2-char stem cannot over-match a suffix-stripped phrase.
 */
export function advertiserNameMatchesBrandStem(advertiser: string, brandDomain: string): boolean {
  const stem = foldDomainLabel(stemFromDomain(brandDomain));
  if (!stem) {
    return false;
  }
  if (foldDomainLabel(advertiser) === stem) {
    return true;
  }
  if (stem.length >= 3) {
    const stripped = foldDomainLabel(stripBrandSuffixes(foldForMatch(advertiser)));
    if (stripped === stem) {
      return true;
    }
  }
  return false;
}

/**
 * Brand-name match (BET 2 "likely" tier). The advertiser IS the brand — its
 * name is the brand stem, optionally followed by common corporate/geo
 * suffixes ("Allbirds", "Allbirds Official", "Allbirds Japan") — but no landing
 * page or advertiser-domain link was captured to prove it. This is the tier
 * that keeps allbirds/notion/oura off the dead-end empty state.
 *
 * The check is deliberately NOT a substring test. "ESHAL HOMEOPATHIC CLINIC
 * OKARA" contains "okara" but is a clinic in the city of Okara, not okara.ai;
 * its leading token is "eshal", so it falls through to `unverified_text_candidate`
 * (unmatched), preserving the okara.ai precision fix.
 */
function hasBrandNameMatch(ad: AdRecord, intent: ParsedSearchQuery) {
  const stem = foldDomainLabel(stemFromDomain(intent.registrableDomain ?? ""));
  if (!stem || stem.length < 3) {
    return false;
  }

  // A verifiable link already classified this ad upstream; brand-name is a
  // fallback for ads we could not otherwise connect.
  if (hostnamesMatchDomainIntent(extractHostname(ad.landingPageUrl), intent)) {
    return false;
  }
  if (hostnamesMatchDomainIntent(inferAdvertiserDomain(ad.advertiser), intent)) {
    return false;
  }

  const foldedAdvertiser = foldDomainLabel(ad.advertiser);
  if (foldedAdvertiser === stem) {
    return true;
  }

  const raw = foldForMatch(ad.advertiser).trim();
  if (!raw) {
    return false;
  }

  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens[0] && foldDomainLabel(tokens[0]) === stem) {
    return true;
  }
  return foldDomainLabel(stripBrandSuffixes(raw)) === stem;
}

const BRAND_NAME_SUFFIXES = [
  "official",
  "official store",
  "official site",
  "inc",
  "inc.",
  "llc",
  "ltd",
  "ltd.",
  "co",
  "co.",
  "corp",
  "corp.",
  "corporation",
  "brand",
  "store",
  "shop",
  "the",
  "global",
  "usa",
  "us",
  "uk",
  "eu",
  "india",
  "japan",
  "jp",
  "me",
  "au",
  "nz",
  "ca",
  "kr",
  "cn",
  "ae",
  "sa",
  "asia",
  "europe",
  "middle east",
  "pvt",
  "pvt.",
  "private limited",
  "limited",
];

function stripBrandSuffixes(advertiser: string) {
  let value = advertiser.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of BRAND_NAME_SUFFIXES) {
      if (value === suffix) {
        return "";
      }
      if (value.endsWith(" " + suffix)) {
        value = value.slice(0, -suffix.length - 1).trim();
        changed = true;
      }
    }
  }
  return value;
}

function hasKeywordOnlyMatch(ad: AdRecord, intent: ParsedSearchQuery) {
  const stem = stemFromDomain(intent.registrableDomain ?? "");
  if (!stem || stem.length < 3) {
    return false;
  }

  if (hostnamesMatchDomainIntent(extractHostname(ad.landingPageUrl), intent)) {
    return false;
  }

  if (hostnamesMatchDomainIntent(inferAdvertiserDomain(ad.advertiser), intent)) {
    return false;
  }

  const haystack = [
    ad.advertiser,
    ad.body,
    ad.previewHeadline,
    ad.previewSubhead,
    ad.hook,
    ad.offer,
    ad.cta,
    ...(ad.countries ?? []),
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(stem);
}

function foldForMatch(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function inferAdvertiserDomain(advertiser: string) {
  const trimmed = advertiser.trim();
  if (!trimmed || !trimmed.includes(".")) {
    return null;
  }

  const token = trimmed
    .split(/\s+/)
    .find((part) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(part));
  return token ? normalizeHostname(token) : null;
}

function extractHostname(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return normalizeHostname(url.hostname);
  } catch {
    return null;
  }
}

function stemFromDomain(domain: string) {
  const registrable = registrableDomainFromHostname(domain) ?? domain;
  const label = registrable.split(".")[0] ?? "";
  return label.replace(/^www\./, "").toLowerCase();
}

function normalizeHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}
