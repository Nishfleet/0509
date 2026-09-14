import { evaluateConnectorAccessGate } from "~/lib/presence-access-gates.server";
import { presenceContentHash } from "~/lib/presence-hash";
import { presenceSafeFetch } from "~/lib/presence-robots.server";
import { normalizePublicHttpUrl } from "~/lib/public-url.server";
import type {
  CostEstimate,
  HealthCheckResult,
  NormalizedPresenceItem,
  PollResult,
  PresenceConnectorContext,
  ValidateTargetInput,
  ValidateTargetResult,
} from "~/lib/presence-types";

/**
 * App-stores presence connector (issue #3210 — split of #3171, the source
 * after #3178). ONE connector, TWO lawful public surfaces, no key, no
 * account, $0:
 *
 * - Apple: the documented iTunes Search/Lookup API
 *   (`GET https://itunes.apple.com/lookup?id=<id>&country=<cc>` — no
 *   registration, no key; Apple's own rate guidance is roughly 20 calls per
 *   minute) plus the long-lived customer-review RSS feed
 *   (`GET https://itunes.apple.com/<cc>/rss/customerreviews/page=1/id=<id>/sortby=mostrecent/json`
 *   — an undocumented long-duration surface, given the same honest posture
 *   the PLAN gives Google News RSS: it works, no contract, never deep-paged
 *   past page=1).
 * - Google Play: the public details page
 *   `https://play.google.com/store/apps/details?id=<pkg>&hl=en&gl=US`
 *   (robots.txt checked 2026-09-13: `/store/apps/details` is not
 *   Disallow-listed) — the structured `SoftwareApplication` (schema.org)
 *   ld+json block embedded by the page carries name, author, description,
 *   rating and rating count.
 *
 * The target = ONE public app listing. Each Apple poll costs exactly 2
 * requests (1 lookup + 1 SINGLE reviews page — never paged past page=1,
 * so the ~20/minute guidance cannot be stressed by serialized polls);
 * each Google poll costs exactly 1. Google Play REVIEWS are NOT captured:
 * no free public API exposes them — the most-starred community scraper
 * (`facundoolano/google-play-scraper`, 2,963★, verified 2026-09-13) talks to
 * Play's private undocumented `batchexecute` endpoint, which fails the
 * public-surfaces-only rule; the exclusion is documented in
 * docs/mentions/PLAN.md (the documented-exclusion clause the issue allows,
 * the listing itself remaining captured).
 *
 * Statelessness and dedup: the poll returns NO cursor. Dedup lives in the
 * table's `UNIQUE (source_target_id, url_hash)` — the canonicalUrl is the
 * dedup key, exactly the #3205 contract:
 * - the Apple listing's canonicalUrl is built from the API's primary key
 *   (`apps.apple.com/<cc>/app/id<trackId>`, a documented stable form, the
 *   way hn builds news.ycombinator.com/item?id=<objectID>) and its
 *   contentHash covers the trimmed title/excerpt/author/publishedAt only —
 *   the rating/count ride `raw` and are captured at first sight, so the
 *   same listing hashes identically every poll: one row, no revision churn;
 * - a review's canonicalUrl = the feed's `rel=related` link + a `review`
 *   parameter (both fields come from the RSS; `normalizePublicHttpUrl` only
 *   strips the fragment, the query — and the review id — survives), and its
 *   publishedAt is the review's `updated` instant: an edited review gets a
 *   new publishedAt -> new contentHash -> a REVISION, never a duplicate;
 * - an entry without a `rel=related` href or an id is skipped, never
 *   given a fabricated canonicalUrl (same posture as the threads/gdelt
 *   suites);
 * - a listing the lookup no longer returns is an honest `ok: true,
 *   items: []` — the second request is not even spent.
 *
 * The connector ships dark behind `PRESENCE_APPSTORE_ROLLOUT` (off by
 * default); writing `connector_id = 'appstore'` into source_target requires
 * the 0104 CHECK-widen migration — the code changes nothing else.
 */
const APPSTORE_MAX_BYTES = 2_000_000;
const MAX_LISTING_TITLE_CHARS = 120;
const MAX_LISTING_EXCERPT_CHARS = 280;
const MAX_REVIEW_TITLE_CHARS = 120;
const MAX_REVIEW_EXCERPT_CHARS = 280;
/** Country defaulted when the target does not name one (posture verified: 200). */
const DEFAULT_COUNTRY = "us";
/** Locale pinned for the Play details page — without it the answer follows
 * the caller's geography and the description would drift between polls. */
const PLAY_HL = "en";
const PLAY_GL = "US";
/** Stable probe app for healthCheck (keyless lookup). */
const PROBE_APP_ID = "544007664";

/** The query parameter carrying the review id inside the review's canonical URL. */
export const REVIEW_URL_PARAM = "review";

export const PLAY_DETAILS_HOST = "play.google.com";
export const APPLE_LISTING_HOST = "apps.apple.com";
export const APPLE_FEED_HOST = "itunes.apple.com";

interface ItunesApp {
  wrapperType?: string | null;
  kind?: string | null;
  trackId?: number | null;
  trackName?: string | null;
  trackCensoredName?: string | null;
  trackViewUrl?: string | null;
  description?: string | null;
  artistName?: string | null;
  sellerName?: string | null;
  releaseDate?: string | null;
  currentVersionReleaseDate?: string | null;
  averageUserRating?: number | null;
  userRatingCount?: number | null;
  primaryGenreName?: string | null;
  version?: string | null;
  bundleId?: string | null;
}

interface ItunesLookupResponse {
  resultCount?: number;
  results?: ItunesApp[];
}

interface ItunesReviewLink {
  attributes?: { rel?: string | null; href?: string | null };
}

interface ItunesReviewEntry {
  author?: { name?: { label?: string | null } };
  updated?: { label?: string | null };
  id?: { label?: string | null };
  title?: { label?: string | null };
  content?: { label?: string | null };
  // Apple returns `link` as one object on some feeds and an array on others.
  link?: ItunesReviewLink | ItunesReviewLink[] | null;
  "im:rating"?: { label?: string | null };
  "im:version"?: { label?: string | null };
  "im:voteSum"?: { label?: string | null };
  "im:voteCount"?: { label?: string | null };
}

interface ItunesReviewsFeed {
  feed?: { entry?: ItunesReviewEntry | ItunesReviewEntry[] | null };
}

interface AggregateRating {
  ratingValue?: string | number | null;
  ratingCount?: string | number | null;
}

interface SoftwareApplicationLd {
  name?: string | null;
  description?: string | null;
  author?: { name?: string | null } | null;
  applicationCategory?: string | null;
  contentRating?: string | null;
  operatingSystem?: string | null;
  aggregateRating?: AggregateRating | null;
}

/** Lookup — the documented iTunes Search API, 1 request, no key. */
export function buildItunesLookupUrl(appId: string, countryCode: string): string {
  const url = new URL(`https://${APPLE_FEED_HOST}/lookup`);
  url.searchParams.set("id", appId);
  url.searchParams.set("country", countryCode || DEFAULT_COUNTRY);
  return url.toString();
}

/** The customer-review RSS feed — page=1 ONLY, never read past it. */
export function buildItunesReviewsUrl(appId: string, countryCode: string): string {
  const cc = (countryCode || DEFAULT_COUNTRY).toLowerCase();
  return new URL(
    `https://${APPLE_FEED_HOST}/${cc}/rss/customerreviews/page=1/id=${encodeURIComponent(appId)}/sortby=mostrecent/json`,
  ).toString();
}

/** The public Google Play details page — hl/gl pinned (stable descriptions). */
export function buildPlayDetailsUrl(packageId: string): string {
  const url = new URL(`https://${PLAY_DETAILS_HOST}/store/apps/details`);
  url.searchParams.set("id", packageId);
  url.searchParams.set("hl", PLAY_HL);
  url.searchParams.set("gl", PLAY_GL);
  return url.toString();
}

const PLAY_PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
const APPLE_COUNTRY_RE = /^[a-z]{2}(?:-[a-z]{2})?$/i;
const APPLE_APP_HOSTS = new Set(["apps.apple.com", "itunes.apple.com"]);

export interface ParsedAppStoreTarget {
  store: "apple" | "google";
  appId: string;
  countryCode: string;
  listingUrl: string;
}

/** Resolves ONE public app listing (Apple or Google Play) from its URL. */
export function parseAppStoreTarget(raw: unknown): ParsedAppStoreTarget | null {
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();

  if (APPLE_APP_HOSTS.has(host)) {
    const parts = url.pathname.split("/").filter(Boolean);
    let appId: string | null = null;
    for (const part of parts) {
      const m = /^id(\d+)$/i.exec(part);
      if (m) {
        appId = m[1];
        break;
      }
    }
    if (!appId) {
      return null;
    }
    const country =
      parts.length > 0 && APPLE_COUNTRY_RE.test(parts[0]) ? parts[0].toLowerCase() : DEFAULT_COUNTRY;
    return { store: "apple", appId, countryCode: country, listingUrl: canonicalAppleListing(country, appId) };
  }

  if (host === PLAY_DETAILS_HOST) {
    if (!url.pathname.startsWith("/store/apps/details")) {
      return null;
    }
    const pkg = url.searchParams.get("id");
    if (!pkg || !PLAY_PACKAGE_RE.test(pkg)) {
      return null;
    }
    return { store: "google", appId: pkg, countryCode: DEFAULT_COUNTRY, listingUrl: canonicalPlayListing(pkg) };
  }

  return null;
}

function canonicalAppleListing(countryCode: string, appId: string): string {
  const literal = `https://${APPLE_LISTING_HOST}/${countryCode}/app/id${appId}`;
  const normalized = normalizePublicHttpUrl(literal);
  return normalized ? normalized.toString() : literal;
}

function canonicalPlayListing(packageId: string): string {
  const literal = `https://${PLAY_DETAILS_HOST}/store/apps/details?id=${encodeURIComponent(packageId)}`;
  const normalized = normalizePublicHttpUrl(literal);
  return normalized ? normalized.toString() : literal;
}

export const appstoreConnector = {
  id: "appstore" as const,
  supportedModes: ["self", "competitor"] as const,

  estimateCost(): CostEstimate {
    return {
      units: 2,
      description:
        "Apple target: 1 iTunes lookup + 1 reviews page (2 requests). Google Play: 1 listing. Public surfaces, $0, no account.",
    };
  },

  async validateTarget(
    input: ValidateTargetInput,
    ctx: PresenceConnectorContext,
  ): Promise<ValidateTargetResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "appstore", input.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: gate.reasonCode ?? "connector_disabled",
        errorMessage: gate.reasonMessage ?? "App-store tracking is not available.",
      };
    }

    const raw = input.targetUrl ?? input.targetHandle ?? input.metadata?.appStoreUrl;
    const parsed = parseAppStoreTarget(raw);
    if (!parsed) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "unparsable_app_store_url",
        errorMessage:
          "Paste the public listing URL: https://apps.apple.com/.../id... or https://play.google.com/store/apps/details?id=...",
      };
    }

    return {
      ok: true,
      targetKey: `${parsed.store}:${parsed.appId.toLowerCase()}`,
      targetUrl: parsed.listingUrl,
      targetHandle: null,
      coverageLabel: "PUBLIC_WEB_BEST_EFFORT",
      metadata: {
        store: parsed.store,
        appId: parsed.appId,
        countryCode: parsed.countryCode,
        listingUrl: parsed.listingUrl,
      },
    };
  },

  async healthCheck(ctx: PresenceConnectorContext): Promise<HealthCheckResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "appstore", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        status: "pending",
        summary: gate.reasonMessage ?? "App-store tracking is not enabled.",
        errorCode: gate.reasonCode,
      };
    }

    // The rollout is on: one keyless public lookup, 1 network hop, nothing else.
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const response = await presenceSafeFetch(buildItunesLookupUrl(PROBE_APP_ID, DEFAULT_COUNTRY), fetchImpl, {
      method: "GET",
      maxBytes: APPSTORE_MAX_BYTES,
      accept: "application/json",
    });

    if (!response || !response.ok) {
      return {
        ok: false,
        status: "degraded",
        summary: response
          ? `The iTunes lookup probe answered HTTP ${response.status}.`
          : "The iTunes lookup probe did not answer.",
        errorCode: "appstore_unreachable",
      };
    }

    return {
      ok: true,
      status: "healthy",
      summary: "Apple lookup + Google Play listings available — no key, no account.",
    };
  },

  async poll(
    ctx: PresenceConnectorContext,
    target: {
      id: string;
      userId: string;
      targetKey: string;
      targetUrl: string | null;
      targetHandle: string | null;
      metadata: Record<string, unknown>;
    },
  ): Promise<PollResult> {
    // 1. The kill flag first — an off flag costs no network hop.
    const gate = await evaluateConnectorAccessGate(ctx.env, "appstore", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        items: [],
        errorCode: gate.reasonCode ?? "connector_disabled",
        errorMessage: gate.reasonMessage ?? "The app-stores connector is not enabled.",
      };
    }

    // 2. Identify the target. Defensive derivation: a target without
    // metadata (an old import, a test bench) falls back to its
    // "apple:<id>" / "google:<pkg>" key.
    const meta = target.metadata ?? {};
    let store = typeof meta.store === "string" ? meta.store : "";
    let appId = typeof meta.appId === "string" ? meta.appId : "";
    let country = typeof meta.countryCode === "string" ? meta.countryCode : "";
    if (!store || !appId) {
      const key = typeof target.targetKey === "string" ? target.targetKey : "";
      const idx = key.indexOf(":");
      if (idx > 0) {
        if (!store) {
          store = key.slice(0, idx);
        }
        if (!appId) {
          appId = key.slice(idx + 1);
        }
      }
    }
    if (!appId || (store !== "apple" && store !== "google")) {
      return {
        ok: false,
        items: [],
        errorCode: "appstore_target_invalid",
        errorMessage: "The target names neither an Apple (id) nor a Google Play (package) listing.",
      };
    }
    if (!country || !APPLE_COUNTRY_RE.test(country)) {
      country = DEFAULT_COUNTRY;
    }

    // 3. Dispatch. Stateless by design: dedup is the table's UNIQUE
    // (source_target_id, url_hash) — no watermark, no cursor (the gdelt
    // posture). A failed leg returns ok: false with no items, so the
    // service keeps the prior table state — a failure never silently skips
    // mentions or halves the truth.
    const fetchImpl = ctx.fetchImpl ?? fetch;
    return store === "apple"
      ? pollAppleTarget(fetchImpl, appId, country)
      : pollGoogleTarget(fetchImpl, appId);
  },
};

async function pollAppleTarget(
  fetchImpl: typeof fetch,
  appId: string,
  country: string,
): Promise<PollResult> {
  // Leg 1 — the documented keyless listing lookup.
  const lookupRes = await presenceSafeFetch(buildItunesLookupUrl(appId, country), fetchImpl, {
    method: "GET",
    maxBytes: APPSTORE_MAX_BYTES,
    accept: "application/json",
  });
  if (!lookupRes) {
    return { ok: false, items: [], errorCode: "appstore_unreachable", costUnits: 1 };
  }
  if (!lookupRes.ok) {
    return {
      ok: false,
      items: [],
      errorCode: lookupRes.status === 429 ? "rate_limited" : "appstore_lookup_error",
      costUnits: 1,
    };
  }
  let lookup: ItunesLookupResponse;
  try {
    // presenceSafeFetch hands back a PresenceSafeFetchResult whose `body` is
    // the already-bounded string — there is no .json() on it (the hn
    // contract). An empty/absent body throws and answers lookup_error.
    lookup = JSON.parse(lookupRes.body ?? "") as ItunesLookupResponse;
  } catch {
    return { ok: false, items: [], errorCode: "appstore_lookup_error", costUnits: 1 };
  }

  const results = Array.isArray(lookup.results) ? lookup.results : [];
  // An id lookup can resolve to a non-software entity (e.g. an artist id from
  // a legacy itunes.apple.com URL) — only a software result is a listing.
  const app = results.find((r) => r.wrapperType === "software" || r.kind === "software");
  if (!app) {
    // The listing no longer answers the lookup — an honest empty poll. The
    // second request is not even spent: there is nothing to hash against.
    return { ok: true, items: [], costUnits: 1, coverageLabel: "PUBLIC_WEB_BEST_EFFORT" };
  }

  // Leg 2 — ONE customer-review RSS page. The connector NEVER reads past
  // page=1: the Apple-side guidance is ~20 calls/minute, polls are
  // serialized upstream, and the newest-reviews page is the freshness the
  // mention table needs. Everything older stays unreaped by design.
  const reviewsRes = await presenceSafeFetch(buildItunesReviewsUrl(appId, country), fetchImpl, {
    method: "GET",
    maxBytes: APPSTORE_MAX_BYTES,
    accept: "application/json",
  });
  if (!reviewsRes) {
    return { ok: false, items: [], errorCode: "appstore_unreachable", costUnits: 2 };
  }
  if (!reviewsRes.ok) {
    return {
      ok: false,
      items: [],
      errorCode: reviewsRes.status === 429 ? "rate_limited" : "appstore_reviews_error",
      costUnits: 2,
    };
  }
  let feed: ItunesReviewsFeed;
  try {
    // Same PresenceSafeFetchResult contract — JSON.parse the bounded body.
    feed = JSON.parse(reviewsRes.body ?? "") as ItunesReviewsFeed;
  } catch {
    return { ok: false, items: [], errorCode: "appstore_reviews_error", costUnits: 2 };
  }

  const observedAt = new Date().toISOString();
  const trackId = typeof app.trackId === "number" ? String(app.trackId) : appId;
  const title = (collapse(app.trackName ?? app.trackCensoredName ?? "") || `App ${trackId}`).slice(
    0,
    MAX_LISTING_TITLE_CHARS,
  );
  const bodyExcerpt = collapse(app.description).slice(0, MAX_LISTING_EXCERPT_CHARS) || null;
  const author = collapse(app.sellerName ?? app.artistName ?? "") || null;
  const publishedAt = safeIsoDate(app.releaseDate);
  const listing: NormalizedPresenceItem = {
    externalId: trackId,
    canonicalUrl: canonicalAppleListing(country, trackId),
    title,
    bodyExcerpt,
    author,
    publishedAt,
    observedAt,
    contentHash: await presenceContentHash({ title, bodyExcerpt, author, publishedAt }),
    raw: {
      kind: "appstore_listing",
      store: "apple",
      rating: readNumberField(app.averageUserRating),
      ratingCount: readNumberField(app.userRatingCount),
      version: collapse(app.version) || null,
      primaryGenreName: collapse(app.primaryGenreName) || null,
      bundleId: collapse(app.bundleId) || null,
    },
  };

  // Reviews ride AFTER the listing, in the feed's own order. A review
  // without a rel=related href or an id is skipped — never a fabricated
  // canonicalUrl (the threads/gdelt posture).
  const items: NormalizedPresenceItem[] = [listing];
  const rawEntries = feed.feed?.entry;
  const entries = Array.isArray(rawEntries) ? rawEntries : rawEntries ? [rawEntries] : [];
  for (const entry of entries) {
    const review = await appleReviewItem(entry, appId, observedAt);
    if (review) {
      items.push(review);
    }
  }
  return { ok: true, items, costUnits: 2, coverageLabel: "PUBLIC_WEB_BEST_EFFORT" };
}

async function appleReviewItem(
  entry: ItunesReviewEntry,
  appId: string,
  observedAt: string,
): Promise<NormalizedPresenceItem | null> {
  const links = Array.isArray(entry.link) ? entry.link : entry.link ? [entry.link] : [];
  const relatedLink = links.find((link) => link?.attributes?.rel === "related");
  const href = relatedLink?.attributes?.href ?? null;
  const reviewId = typeof entry.id?.label === "string" ? entry.id.label.trim() : "";
  if (!href || !reviewId) {
    return null;
  }
  let related: URL;
  try {
    related = new URL(href);
  } catch {
    return null;
  }
  related.searchParams.set(REVIEW_URL_PARAM, reviewId);
  const normalized = normalizePublicHttpUrl(related.toString());
  if (!normalized) {
    return null;
  }

  const title = (collapse(entry.title?.label) || `Review ${reviewId}`).slice(0, MAX_REVIEW_TITLE_CHARS);
  const bodyExcerpt = collapse(entry.content?.label).slice(0, MAX_REVIEW_EXCERPT_CHARS) || null;
  const author = collapse(entry.author?.name?.label) || null;
  // The feed exposes only `updated` — the review's last-edit instant, not
  // its original post date. That is exactly what the dedup design needs:
  // an edited review (new `updated` -> new publishedAt -> new contentHash)
  // becomes a revision, never a duplicate.
  const publishedAt = safeIsoDate(entry.updated?.label);
  return {
    externalId: reviewId,
    canonicalUrl: normalized.toString(),
    title,
    bodyExcerpt,
    author,
    publishedAt,
    observedAt,
    contentHash: await presenceContentHash({ title, bodyExcerpt, author, publishedAt }),
    raw: {
      kind: "appstore_review",
      store: "apple",
      appId,
      rating: readNumberField(entry["im:rating"]?.label),
      voteSum: readNumberField(entry["im:voteSum"]?.label),
      voteCount: readNumberField(entry["im:voteCount"]?.label),
      version: collapse(entry["im:version"]?.label) || null,
    },
  };
}

async function pollGoogleTarget(fetchImpl: typeof fetch, appId: string): Promise<PollResult> {
  // ONE request — the public details page, hl/gl pinned.
  const res = await presenceSafeFetch(buildPlayDetailsUrl(appId), fetchImpl, {
    method: "GET",
    maxBytes: APPSTORE_MAX_BYTES,
    accept: "text/html",
  });
  if (!res) {
    return { ok: false, items: [], errorCode: "appstore_unreachable", costUnits: 1 };
  }
  if (!res.ok) {
    return {
      ok: false,
      items: [],
      errorCode: res.status === 429 ? "rate_limited" : "appstore_play_error",
      costUnits: 1,
    };
  }
  // The bounded body already rode the PresenceSafeFetchResult — no second
  // read, no Response contract. An empty body (a 304 with no conditional
  // request, say) yields no structured block → the honest empty poll.
  const html = res.body ?? "";

  const ld = extractSoftwareApplication(html);
  if (!ld || !ld.name) {
    // The structured listing block is absent this poll — honest empty, no
    // fabricated mention (the same posture as an empty search result).
    return { ok: true, items: [], costUnits: 1, coverageLabel: "PUBLIC_WEB_BEST_EFFORT" };
  }

  const observedAt = new Date().toISOString();
  const title = (collapse(ld.name) || `App ${appId}`).slice(0, MAX_LISTING_TITLE_CHARS);
  const bodyExcerpt = collapse(ld.description).slice(0, MAX_LISTING_EXCERPT_CHARS) || null;
  const author = collapse(ld.author?.name ?? "") || null;
  const item: NormalizedPresenceItem = {
    externalId: appId,
    canonicalUrl: canonicalPlayListing(appId),
    title,
    bodyExcerpt,
    author,
    // The Play page exposes no first-published instant; publishedAt stays
    // null by design. The contentHash covers title/excerpt/author only, so
    // the listing hashes identically on every poll and the table's
    // UNIQUE (source_target_id, url_hash) keeps it ONE row — rating shifts
    // ride `raw` and never churn revisions.
    publishedAt: null,
    observedAt,
    contentHash: await presenceContentHash({ title, bodyExcerpt, author, publishedAt: null }),
    raw: {
      kind: "appstore_listing",
      store: "google",
      rating: readNumberField(ld.aggregateRating?.ratingValue),
      ratingCount: readNumberField(ld.aggregateRating?.ratingCount),
      applicationCategory: collapse(ld.applicationCategory) || null,
      contentRating: collapse(ld.contentRating) || null,
    },
  };
  return { ok: true, items: [item], costUnits: 1, coverageLabel: "PUBLIC_WEB_BEST_EFFORT" };
}

function extractSoftwareApplication(html: string): SoftwareApplicationLd | null {
  for (const match of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1].trim());
    } catch {
      continue;
    }
    const nodes = Array.isArray(parsed) ? parsed : [parsed];
    for (const node of nodes) {
      if (node && typeof node === "object" && (node as Record<string, unknown>)["@type"] === "SoftwareApplication") {
        return node as SoftwareApplicationLd;
      }
    }
  }
  return null;
}

function readNumberField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function safeIsoDate(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function collapse(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
