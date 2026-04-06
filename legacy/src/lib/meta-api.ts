/**
 * Meta Ad Library API client
 *
 * Endpoint: https://graph.facebook.com/v23.0/ads_archive
 * Docs: https://developers.facebook.com/docs/graph-api/reference/ads_archive/
 *
 * Rate limit: ~200 calls/hour (error code 613)
 * Auth: access_token query param (user token with ads_read permission)
 *
 * Limitation: Non-EU commercial ads have restricted data. The API was
 * designed for political/issue ad transparency; non-political ads from
 * outside the EU may return limited results.
 */

import type { AdRecord } from "./demo-data";

const META_API_VERSION = "v23.0";
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}/ads_archive`;

// Fields requested from Meta API
const FIELDS = [
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
].join(",");

// Country label → ISO code
const COUNTRY_CODE_MAP: Record<string, string> = {
  all: "ALL",
  "United States": "US",
  "United Kingdom": "GB",
  India: "IN",
  Canada: "CA",
  Australia: "AU",
};

// ISO code → display label
const REVERSE_COUNTRY_MAP: Record<string, string> = {
  US: "United States",
  GB: "United Kingdom",
  IN: "India",
  CA: "Canada",
  AU: "Australia",
};

// Platform display label → Meta API platform slug
const PLATFORM_MAP: Record<string, string> = {
  Facebook: "facebook",
  Instagram: "instagram",
  Messenger: "messenger",
};

// Creative type filter → Meta media_type value (null = no filter)
const MEDIA_TYPE_MAP: Record<string, string | null> = {
  all: null,
  image: "IMAGE",
  video: "VIDEO",
  carousel: null, // No direct Meta filter; detected from response structure
};

// Consistent accent color derived from advertiser name
function accentFromName(name: string): string {
  const palette = [
    "#0f8b7f",
    "#d37d55",
    "#6a73ff",
    "#0f7de7",
    "#8757d8",
    "#0c8f6a",
    "#d28c3c",
    "#e05c5c",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash + name.charCodeAt(i)) % palette.length;
  }
  return palette[hash];
}

// Format ISO date string to short label e.g. "Mar 5"
function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Raw shape returned by Meta's ads_archive endpoint
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
      before?: string;
    };
    next?: string;
  };
  error?: {
    code: number;
    message: string;
    type?: string;
  };
}

export interface MetaSearchParams {
  query: string;
  mode: "advertiser" | "keyword";
  country: string;
  platform: string;
  status: "active" | "paused" | "all";
  creativeType: "image" | "video" | "carousel" | "all";
  after?: string;
  limit?: number;
}

export interface MetaSearchResult {
  ads: AdRecord[];
  nextCursor: string | undefined;
}

export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly isRateLimit: boolean,
    public readonly isAuthError: boolean,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

/**
 * Convert a single raw Meta ad object into our normalized AdRecord format.
 */
export function parseMetaAd(raw: MetaRawAd): AdRecord {
  const advertiser = raw.page_name ?? "Unknown Advertiser";
  const bodies = raw.ad_creative_bodies ?? [];
  const titles = raw.ad_creative_link_titles ?? [];
  const descriptions = raw.ad_creative_link_descriptions ?? [];
  const captions = raw.ad_creative_link_captions ?? [];

  // Detect carousel from multiple creatives
  const isCarousel = bodies.length > 1 || titles.length > 1;
  let creativeType: AdRecord["creativeType"];
  if (isCarousel) {
    creativeType = "carousel";
  } else if (raw.media_type?.toUpperCase() === "VIDEO") {
    creativeType = "video";
  } else {
    creativeType = "image";
  }

  const copy = bodies[0] ?? titles[0] ?? "";
  // Use second body as hook if available; otherwise truncate copy
  const hook = bodies.length > 1 ? bodies[1] : copy.slice(0, 150);
  const headline = titles[0] ?? advertiser;
  const subhead = descriptions[0] ?? copy.slice(0, 100);
  const cta = captions[0] ?? "Learn more";

  const status: AdRecord["status"] =
    raw.ad_active_status === "ACTIVE" ? "active" : "paused";

  const platforms = (raw.publisher_platforms ?? [])
    .map((p) => {
      const lower = p.toLowerCase();
      if (lower === "facebook") return "Facebook";
      if (lower === "instagram") return "Instagram";
      if (lower === "messenger") return "Messenger";
      return p;
    })
    .filter((p): p is string => ["Facebook", "Instagram", "Messenger"].includes(p));

  const countries = (raw.ad_reached_countries ?? [])
    .map((code) => REVERSE_COUNTRY_MAP[code] ?? code)
    .filter(Boolean);

  const firstSeen = formatDate(raw.ad_delivery_start_time);
  const lastSeen =
    status === "active" && !raw.ad_delivery_stop_time
      ? "Present"
      : formatDate(raw.ad_delivery_stop_time) || "Unknown";

  const badgeMap: Record<AdRecord["creativeType"], string> = {
    image: "Static image",
    video: "Video creative",
    carousel: "Carousel",
  };

  return {
    id: raw.id,
    advertiser,
    angleTags: [],
    copy: copy.slice(0, 400),
    countries: countries.length > 0 ? countries : ["Unknown"],
    creativeType,
    cta,
    firstSeen,
    hook: hook.slice(0, 200),
    keywords: [],
    landingPage: raw.ad_snapshot_url ?? "",
    lastSeen,
    platforms: platforms.length > 0 ? platforms : ["Facebook"],
    preview: {
      accent: accentFromName(advertiser),
      badge: badgeMap[creativeType],
      headline: headline.slice(0, 100),
      subhead: subhead.slice(0, 130),
    },
    researchNote: `Retrieved live from Meta Ad Library. Ad ID: ${raw.id}.`,
    status,
  };
}

/**
 * Fetch ads from Meta Ad Library API and return normalized AdRecord[].
 *
 * Throws MetaApiError on API-level failures (rate limit, auth, bad request).
 * Throws TypeError / network errors on fetch failures (let caller handle).
 */
export async function fetchMetaAds(
  params: MetaSearchParams,
  accessToken: string,
): Promise<MetaSearchResult> {
  const sp = new URLSearchParams();

  sp.set("access_token", accessToken);
  sp.set("fields", FIELDS);
  sp.set("limit", String(Math.min(params.limit ?? 25, 50)));

  // Search terms (required by Meta API — must be non-empty or paired with page IDs)
  sp.set("search_terms", params.query.trim() || " ");
  if (params.mode === "advertiser" && params.query.trim()) {
    // Exact phrase gives better advertiser name matching
    sp.set("search_type", "KEYWORD_EXACT_PHRASE");
  }

  // Country
  const countryCode = COUNTRY_CODE_MAP[params.country] ?? "ALL";
  const countryArray = countryCode === "ALL" ? ["ALL"] : [countryCode];
  sp.set("ad_reached_countries", JSON.stringify(countryArray));

  // Status
  const statusMap: Record<string, string> = {
    active: "ACTIVE",
    paused: "INACTIVE",
    all: "ALL",
  };
  sp.set("ad_active_status", statusMap[params.status] ?? "ALL");

  // Platform
  if (params.platform !== "all" && PLATFORM_MAP[params.platform]) {
    sp.set(
      "publisher_platforms",
      JSON.stringify([PLATFORM_MAP[params.platform]]),
    );
  }

  // Creative type (carousel has no direct filter; we detect it in parsing)
  const mediaType = MEDIA_TYPE_MAP[params.creativeType];
  if (mediaType) {
    sp.set("media_type", mediaType);
  }

  // Cursor-based pagination
  if (params.after) {
    sp.set("after", params.after);
  }

  const url = `${META_API_BASE}?${sp.toString()}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    // No caching — always fetch fresh ad data
    cache: "no-store",
  });

  const json: MetaApiResponse = await res.json();

  if (json.error) {
    const code = json.error.code;
    // Rate limit codes: 613 (rate limit), 32 (app-level), 17 (user-level)
    const isRateLimit = code === 613 || code === 32 || code === 17;
    // Auth codes: 190 (invalid token), 102 (invalid session)
    const isAuthError = code === 190 || code === 102;
    throw new MetaApiError(json.error.message, code, isRateLimit, isAuthError);
  }

  if (!res.ok) {
    throw new MetaApiError(
      `Meta API HTTP ${res.status}`,
      res.status,
      res.status === 429,
      res.status === 401 || res.status === 403,
    );
  }

  const ads = (json.data ?? []).map(parseMetaAd);
  const nextCursor = json.paging?.cursors?.after;

  return { ads, nextCursor };
}
