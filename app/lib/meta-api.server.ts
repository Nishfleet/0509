import { demoAds } from "~/lib/demo-data";
import { deriveHook, deriveOffer, inferDestinationType, inferLanguageLabel, withStructuredAnalysis } from "~/lib/analysis.server";
import { countryNameFromIso, isoFromCountryName } from "~/lib/countries";
import { readResponseJsonWithinLimit } from "~/lib/bounded-response.server";
import type { AppEnv } from "~/lib/env.server";
import { fetchWithTimeout } from "~/lib/fetch-timeout.server";
import type { AdRecord, NormalizedSavedQuery, SearchMode, SearchResponse } from "~/lib/types";

const DEFAULT_PAGE_LIMIT = 24;
const META_FETCH_TIMEOUT_MS = 15_000;
const META_FETCH_JSON_MAX_BYTES = 1_000_000;

interface MetaRawAd {
  id: string;
  page_name?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  ad_creative_link_descriptions?: string[];
  ad_creative_link_captions?: string[];
  ad_snapshot_url?: string;
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  ad_active_status?: string;
  ad_reached_countries?: string[];
  publisher_platforms?: string[];
  media_type?: string;
}

interface MetaApiResponse {
  data?: MetaRawAd[];
  paging?: {
    cursors?: {
      after?: string;
    };
  };
  error?: {
    code: number;
    message: string;
  };
}

interface SearchAdsOptions {
  allowDemoFallback?: boolean;
}

export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly isAuthError: boolean,
    public readonly isRateLimit: boolean,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

export async function searchAds(
  env: AppEnv,
  query: NormalizedSavedQuery,
  cursor?: string | null,
  options: SearchAdsOptions = {},
): Promise<SearchResponse> {
  if (!env.META_AD_LIBRARY_TOKEN) {
    return demoSearch(query, cursor);
  }

  try {
    return await liveSearch(env, query, cursor);
  } catch (error) {
    if (options.allowDemoFallback === false) {
      throw error;
    }
    return demoSearch(query, cursor);
  }
}

export function demoSearch(
  query: NormalizedSavedQuery,
  cursor?: string | null,
): SearchResponse {
  const matchingAds = demoAds.filter((ad) => matchesAd(ad, query.mode, query.filters));
  const startIndex = cursor ? Number.parseInt(cursor, 10) : 0;
  const nextSlice = matchingAds.slice(startIndex, startIndex + DEFAULT_PAGE_LIMIT);
  const nextCursor =
    startIndex + DEFAULT_PAGE_LIMIT < matchingAds.length
      ? String(startIndex + DEFAULT_PAGE_LIMIT)
      : null;

  return {
    ads: nextSlice.map((ad) => withStructuredAnalysis(ad)),
    nextCursor,
    source: "demo",
  };
}

async function liveSearch(
  env: AppEnv,
  query: NormalizedSavedQuery,
  cursor?: string | null,
): Promise<SearchResponse> {
  const version = env.META_AD_LIBRARY_API_VERSION ?? "v23.0";
  const params = new URLSearchParams();
  params.set("access_token", env.META_AD_LIBRARY_TOKEN ?? "");
  params.set(
    "fields",
    [
      "id",
      "page_name",
      "ad_creative_bodies",
      "ad_creative_link_titles",
      "ad_creative_link_descriptions",
      "ad_creative_link_captions",
      "ad_snapshot_url",
      "ad_delivery_start_time",
      "ad_delivery_stop_time",
      "ad_active_status",
      "ad_reached_countries",
      "publisher_platforms",
      "media_type",
    ].join(","),
  );
  params.set("limit", String(DEFAULT_PAGE_LIMIT));
  params.set("search_terms", query.filters.query || " ");
  params.set(
    "search_type",
    query.mode === "advertiser" ? "KEYWORD_EXACT_PHRASE" : "KEYWORD_UNORDERED",
  );
  params.set("ad_type", "ALL");
  params.set("ad_reached_countries", countryCode(query.filters.country));

  if (cursor) {
    params.set("after", cursor);
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(
      `https://graph.facebook.com/${version}/ads_archive?${params.toString()}`,
      {},
      { timeoutMs: META_FETCH_TIMEOUT_MS },
    );
  } catch (error) {
    // AbortError comes through as a DOMException in Workers and as a
    // DOMException-like Error in Node test runners. Compare by .name so the
    // check is portable across both without relying on the DOMException
    // constructor identity.
    if (error instanceof Error && error.name === "AbortError") {
      throw new MetaApiError(
        `Meta Ad Library request timed out after ${META_FETCH_TIMEOUT_MS / 1000}s.`,
        408,
        false,
        false,
      );
    }
    throw error;
  }
  const payload = await readResponseJsonWithinLimit<MetaApiResponse>(
    response,
    META_FETCH_JSON_MAX_BYTES,
  );
  if (!payload) {
    throw new MetaApiError(
      `Meta Ad Library returned an unreadable response with status ${response.status}.`,
      response.status || 502,
      false,
      false,
    );
  }

  if (!response.ok || payload.error) {
    const code = payload.error?.code ?? response.status;
    throw new MetaApiError(
      payload.error?.message ?? `Meta Ad Library request failed with status ${response.status}.`,
      code,
      code === 190 || code === 102,
      code === 613 || response.status === 429,
    );
  }

  const ads = (payload.data ?? [])
    .map((item) => parseMetaAd(item))
    .filter((ad) => matchesAd(ad, query.mode, query.filters))
    .map((ad) => withStructuredAnalysis(ad));

  return {
    ads,
    nextCursor: payload.paging?.cursors?.after ?? null,
    source: "meta",
  };
}

function parseMetaAd(raw: MetaRawAd): AdRecord {
  const bodies = raw.ad_creative_bodies ?? [];
  const titles = raw.ad_creative_link_titles ?? [];
  const descriptions = raw.ad_creative_link_descriptions ?? [];
  const captions = raw.ad_creative_link_captions ?? [];
  const advertiser = raw.page_name ?? "Unknown advertiser";
  const body = bodies[0] ?? titles[0] ?? descriptions[0] ?? "";
  const previewHeadline = titles[0] ?? advertiser;
  const previewSubhead = descriptions[0] ?? body.slice(0, 120);
  const format = detectCreativeType(raw, bodies, titles);
  const landingPageUrl = extractDestinationUrl(raw.ad_snapshot_url);
  const cta = captions[0] ?? "Learn more";

  return {
    metaAdId: raw.id,
    advertiser,
    body,
    bodySecondary: bodies[1],
    previewHeadline,
    previewSubhead,
    hook: deriveHook(body, previewHeadline),
    offer: deriveOffer(body, cta),
    cta,
    format,
    languageLabel: inferLanguageLabel(`${previewHeadline} ${body}`),
    destinationType: inferDestinationType(landingPageUrl),
    landingPageUrl,
    adSnapshotUrl: raw.ad_snapshot_url ?? null,
    countries: (raw.ad_reached_countries ?? []).map(countryNameFromCode),
    platforms: (raw.publisher_platforms ?? []).map(displayPlatform),
    firstSeenAt: raw.ad_delivery_start_time ?? null,
    lastSeenAt: raw.ad_delivery_stop_time ?? raw.ad_delivery_start_time ?? null,
    active: raw.ad_active_status === "ACTIVE",
    researchSummary: "Pulled from the Meta Ad Library API and normalized into Five to Nine’s analysis schema.",
    source: "meta",
    tags: [],
    landingPage: null,
    analysisFields: [],
  };
}

function detectCreativeType(
  raw: MetaRawAd,
  bodies: string[],
  titles: string[],
): "image" | "video" | "carousel" {
  if (bodies.length > 1 || titles.length > 1) {
    return "carousel";
  }

  if (raw.media_type?.toUpperCase() === "VIDEO") {
    return "video";
  }

  return "image";
}

function matchesAd(ad: AdRecord, mode: SearchMode, filters: NormalizedSavedQuery["filters"]) {
  const query = filters.query.toLowerCase();
  const searchable =
    `${ad.advertiser} ${ad.body} ${ad.previewHeadline} ${ad.previewSubhead} ${ad.hook} ${ad.offer} ${ad.cta}`.toLowerCase();

  const queryMatch = !query
    ? true
    : mode === "advertiser"
      ? ad.advertiser.toLowerCase().includes(query)
      : searchable.includes(query);

  // Demo ads are sample data — they should demo for every visitor country,
  // not only the market they were authored in.
  const countryMatch =
    filters.country === "all" ||
    ad.source === "demo" ||
    ad.countries.includes(filters.country);
  const platformMatch = filters.platform === "all" || ad.platforms.includes(filters.platform);
  const creativeMatch = filters.creativeType === "all" || ad.format === filters.creativeType;
  const statusMatch =
    filters.status === "all" ||
    (filters.status === "active" ? ad.active : !ad.active);
  const firstSeenMatch =
    !filters.firstSeenFrom || !ad.firstSeenAt || ad.firstSeenAt >= filters.firstSeenFrom;
  const lastSeenMatch =
    !filters.lastSeenFrom || !ad.lastSeenAt || ad.lastSeenAt >= filters.lastSeenFrom;

  return (
    queryMatch &&
    countryMatch &&
    platformMatch &&
    creativeMatch &&
    statusMatch &&
    firstSeenMatch &&
    lastSeenMatch
  );
}

function extractDestinationUrl(snapshotUrl?: string) {
  if (!snapshotUrl) {
    return null;
  }

  try {
    const parsed = new URL(snapshotUrl);
    const candidate =
      parsed.searchParams.get("u") ??
      parsed.searchParams.get("url") ??
      parsed.searchParams.get("target_url");

    return candidate ? decodeURIComponent(candidate) : snapshotUrl;
  } catch {
    return snapshotUrl;
  }
}

function displayPlatform(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === "facebook") return "Facebook";
  if (normalized === "instagram") return "Instagram";
  if (normalized === "messenger") return "Messenger";
  return value;
}

function countryCode(value: string) {
  return isoFromCountryName(value) ?? value.toUpperCase();
}

function countryNameFromCode(value: string) {
  return countryNameFromIso(value) ?? value;
}
