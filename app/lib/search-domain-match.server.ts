import { comparableHostname, hostnamesMatchDomainIntent, registrableDomainFromHostname } from "~/lib/search-query";
import type { ParsedSearchQuery } from "~/lib/search-query";
import type { AdRecord } from "~/lib/types";

export type DomainMatchLevel =
  | "exact_hostname"
  | "registrable_domain"
  | "verified_advertiser_domain"
  | "verified_alias"
  | "verified_entity"
  | "unverified_text_candidate";

export interface DomainMatchExplanation {
  level: DomainMatchLevel;
  matchedDomain: string | null;
  matchedSignal: string;
  confidenceCategory: "verified" | "unverified";
  providerSource: AdRecord["source"];
  customerReason: string;
}

export interface DomainMatchedAd {
  ad: AdRecord;
  match: DomainMatchExplanation;
}

const VERIFIED_LEVELS = new Set<DomainMatchLevel>([
  "exact_hostname",
  "registrable_domain",
  "verified_advertiser_domain",
  "verified_alias",
  "verified_entity",
]);

export function isVerifiedDomainMatchLevel(level: DomainMatchLevel) {
  return VERIFIED_LEVELS.has(level);
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

    if (!options.includeUnverified && explanation.level === "unverified_text_candidate") {
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
    case "unverified_text_candidate":
      return 5;
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
    confidenceCategory: isVerifiedDomainMatchLevel(level) ? "verified" : "unverified",
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
  const landingHost = extractHostname(ad.landingPageUrl);
  if (!landingHost || !hostnamesMatchDomainIntent(landingHost, intent)) {
    return false;
  }

  const advertiser = ad.advertiser.toLowerCase();
  return identityAliases.some((alias) => alias && advertiser.includes(alias.toLowerCase()));
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
