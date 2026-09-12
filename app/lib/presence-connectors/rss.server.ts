import { decodeHtmlEntities as decodeXml } from "~/lib/decode-html.server";
import { evaluateConnectorAccessGate } from "~/lib/presence-access-gates.server";
import { presenceContentHash } from "~/lib/presence-hash";
import { presenceSafeFetch } from "~/lib/presence-robots.server";
import type {
  CostEstimate,
  HealthCheckResult,
  NormalizedPresenceItem,
  PollResult,
  PresenceConnectorContext,
  ValidateTargetInput,
  ValidateTargetResult,
} from "~/lib/presence-types";
import { resolvePublicHttpUrl } from "~/lib/public-url.server";

/**
 * RSS / Atom / JSON Feed presence connector.
 *
 * Zero-spend mention backbone: validates a feed URL (or auto-discovers a feed
 * from a site URL via the well-known `<link rel="alternate">` tag), polls it
 * through the SSRF-hardened `presenceSafeFetch` path, and emits normalized
 * `presence_item` rows so mentions from blogs, Substacks, Medium publications,
 * podcast feeds, YouTube channel feeds, and news sites with RSS land in the
 * same presence substrate every other mention source uses — without a paid
 * source, an auth dance, or a quota.
 *
 * Every network hop goes through `presenceSafeFetch`, which re-validates the
 * URL via `resolvePublicHttpUrl` (SSRF hardening) on every request and every
 * redirect. A raw `fetch` to a feed URL is a regression.
 *
 * The connector is wired into the registry but gated behind
 * `PRESENCE_RSS_ROLLOUT` (off by default); activation requires the rollout
 * flag (and, before migration 0093, the `source_target.connector_id` CHECK
 * widened to accept 'rss'), not a code change in this connector.
 */
const MAX_RSS_FETCH_BYTES = 750_000;
/** Bounded excerpt size for a feed entry body. Documented cap, mirrored from the website connector. */
const MAX_FEED_EXCERPT_CHARS = 280;
const MAX_FEED_ITEMS = 25;

/**
 * Google News RSS query-feed support (issue #3178): news.google.com item links
 * are redirects, not canonical publisher URLs. Before hashing (dedup), the
 * connector resolves each redirect to the publisher URL — first by decoding
 * the base64url article id (Google embeds the target URL in it, no extra
 * fetch), then, only when the id does not embed it, by ONE bounded fetch
 * through `presenceSafeFetch` (SSRF-validated redirects). Budget: at most 10
 * resolutions per poll, one request each; unresolved links keep the redirect
 * URL and are flagged in `raw.googleNewsRedirectUnresolved` instead of being
 * dropped — honesty over fabricated canonical URLs.
 */
const GOOGLE_NEWS_HOST = "news.google.com";
const MAX_GNEWS_REDIRECTS_RESOLVED_PER_POLL = 10;
const MAX_GNEWS_RESOLVE_FETCH_BYTES = 100_000;

export const rssConnector = {
  id: "rss" as const,
  supportedModes: ["self", "competitor"] as const,

  estimateCost(): CostEstimate {
    return { units: 1, description: "One public HTTP fetch of an RSS/Atom/JSON feed with conditional headers" };
  },

  async validateTarget(
    input: ValidateTargetInput,
    ctx: PresenceConnectorContext,
  ): Promise<ValidateTargetResult> {
    const raw = input.targetUrl?.trim();
    if (!raw) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "missing_url",
        errorMessage: "Enter an RSS feed URL or a site URL to discover its feed.",
      };
    }

    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    const safeUrl = await resolvePublicHttpUrl(candidate);
    if (!safeUrl) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "ssrf_blocked",
        errorMessage: "That URL is not reachable from the public internet.",
      };
    }

    const normalized = safeUrl.toString().replace(/\/$/, "") || safeUrl.toString();
    const targetKey = safeUrl.hostname.toLowerCase();
    const isNewsQueryFeed = isGoogleNewsNewsUrl(safeUrl.toString());

    // Fetch once through the SSRF-hardened path. The response shape decides
    // whether this is a direct feed or a site page that needs feed discovery.
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const response = await presenceSafeFetch(safeUrl.toString(), fetchImpl, {
      method: "GET",
      maxBytes: MAX_RSS_FETCH_BYTES,
      accept:
        "application/rss+xml,application/atom+xml,application/xml,text/xml,application/feed+json,application/json,text/html,application/xhtml+xml,*/*",
    });

    if (!response || !response.ok || !response.body) {
      // Could not inspect the target now — accept it as a best-effort site
      // target; feed discovery is retried at poll time (mirrors website).
      return {
        ok: true,
        targetKey,
        targetUrl: normalized,
        coverageLabel: "PUBLIC_WEB_BEST_EFFORT",
        metadata: { feedDiscovery: "pending" },
      };
    }

    const body = response.body;
    const contentType = response.contentType ?? "";

    if (isDirectFeedResponse(body, contentType)) {
      return {
        ok: true,
        targetKey,
        targetUrl: normalized,
        coverageLabel: "VERIFIED_PUBLIC_FEED",
        metadata: { feedUrl: normalized, feedDiscovery: "direct", ...(isNewsQueryFeed ? { newsQuery: true } : {}) },
      };
    }

    // Site page: look for <link rel="alternate" type="application/rss+xml" /
    // "application/atom+xml" / "application/json"> and resolve the href.
    const discoveredHref = discoverFeedLink(body);
    if (discoveredHref) {
      const resolved = await resolvePublicHttpUrl(new URL(discoveredHref, safeUrl));
      if (resolved) {
        return {
          ok: true,
          targetKey,
          targetUrl: normalized,
          coverageLabel: "VERIFIED_PUBLIC_FEED",
          metadata: { feedUrl: resolved.toString(), feedDiscovery: "discovered" },
        };
      }
    }

    return {
      ok: true,
      targetKey,
      targetUrl: normalized,
      coverageLabel: "PUBLIC_WEB_BEST_EFFORT",
      metadata: { feedDiscovery: "pending" },
    };
  },

  async healthCheck(ctx: PresenceConnectorContext): Promise<HealthCheckResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "rss", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        status: "pending",
        summary: gate.reasonMessage ?? "RSS feed tracking is not enabled yet.",
        errorCode: gate.reasonCode,
      };
    }
    return {
      ok: true,
      status: "healthy",
      summary: "RSS/Atom/JSON Feed polling is available — no credentials required.",
    };
  },

  async poll(
    ctx: PresenceConnectorContext,
    target: { targetUrl: string | null; metadata: Record<string, unknown> },
    cursor?: { etag?: string | null; lastModified?: string | null },
  ): Promise<PollResult> {
    if (!target.targetUrl) {
      return {
        ok: false,
        items: [],
        errorCode: "missing_target_url",
        errorMessage: "RSS target URL is missing.",
      };
    }

    const fetchImpl = ctx.fetchImpl ?? fetch;
    const storedFeedUrl =
      typeof target.metadata.feedUrl === "string" && target.metadata.feedUrl
        ? target.metadata.feedUrl
        : null;
    const feedUrl = storedFeedUrl ?? target.targetUrl;

    const fetched = await fetchFeed(feedUrl, fetchImpl, cursor);

    // validateTarget accepts a site target it could not inspect on the promise
    // that "feed discovery is retried at poll time (mirrors website)". Keep
    // that promise: when no feedUrl is stored and the fetched document is not
    // a feed, run the same <link rel="alternate"> discovery here and persist
    // the discovered feed via cursor.feedUrl so the next poll fetches it
    // directly.
    if (!storedFeedUrl && fetched.result.errorCode === "feed_parse_failed" && fetched.body) {
      const discovered = await resolveDiscoveredFeedUrl(fetched.body, feedUrl);
      if (discovered) {
        const retry = await fetchFeed(discovered, fetchImpl);
        return {
          ...retry.result,
          cursor: { feedUrl: discovered, ...(retry.result.cursor ?? {}) },
        };
      }
    }

    return fetched.result;
  },
};

async function fetchFeed(
  feedUrl: string,
  fetchImpl: typeof fetch,
  cursor?: { etag?: string | null; lastModified?: string | null },
): Promise<{ result: PollResult; body: string | null }> {
  const response = await presenceSafeFetch(feedUrl, fetchImpl, {
    method: "GET",
    maxBytes: MAX_RSS_FETCH_BYTES,
    etag: cursor?.etag,
    lastModified: cursor?.lastModified,
    accept:
      "application/rss+xml,application/atom+xml,application/xml,text/xml,application/feed+json,application/json,*/*",
  });

  if (!response) {
    return {
      result: {
        ok: false,
        items: [],
        errorCode: "fetch_failed",
        errorMessage: "Could not fetch the RSS feed.",
      },
      body: null,
    };
  }

  if (response.notModified) {
    return {
      result: {
        ok: true,
        items: [],
        etag: response.etag,
        lastModified: response.lastModified,
        coverageLabel: "VERIFIED_PUBLIC_FEED",
        costUnits: 0,
        cursor: { feedUrl },
      },
      body: null,
    };
  }

  if (!response.ok || !response.body) {
    return {
      result: {
        ok: false,
        items: [],
        errorCode: "feed_unavailable",
        errorMessage: `Feed responded with HTTP ${response.status}.`,
      },
      body: null,
    };
  }

  const body = response.body;
  let items = await parseFeedItems(body, feedUrl);

  // Issue #3178: resolve news.google.com redirect links to canonical publisher
  // URLs BEFORE hashing, so the same story dedups like any other mention.
  // Triggered per-item, so a publisher feed carrying syndicated Google News
  // links resolves too.
  if (items.some((item) => isGoogleNewsRedirectUrl(item.canonicalUrl))) {
    items = await resolveGoogleNewsRedirects(items, fetchImpl);
  }

  // Honesty eval 3.4: a valid feed document that simply has zero entries is
  // an honest empty result, not a fabrication. Only a document that is not a
  // feed at all (and yielded nothing) is a parse failure.
  if (items.length === 0 && !looksLikeFeedDocument(body) && !looksLikeJsonFeed(body)) {
    return {
      result: {
        ok: false,
        items: [],
        errorCode: "feed_parse_failed",
        errorMessage: "Feed did not contain valid RSS, Atom, or JSON Feed entries.",
        etag: response.etag,
        lastModified: response.lastModified,
      },
      body,
    };
  }

  return {
    result: {
      ok: true,
      items,
      etag: response.etag,
      lastModified: response.lastModified,
      coverageLabel: "VERIFIED_PUBLIC_FEED",
      costUnits: 1,
      cursor: { feedUrl, completeSnapshot: items.length > 0 },
    },
    body,
  };
}

async function resolveDiscoveredFeedUrl(body: string, baseUrl: string): Promise<string | null> {
  const href = discoverFeedLink(body);
  if (!href) {
    return null;
  }
  try {
    const resolved = await resolvePublicHttpUrl(new URL(href, baseUrl));
    return resolved ? resolved.toString() : null;
  } catch {
    return null;
  }
}

function isDirectFeedResponse(body: string, contentType: string): boolean {
  if (looksLikeFeedDocument(body) || looksLikeJsonFeed(body)) {
    return true;
  }
  const ct = contentType.toLowerCase();
  return (
    ct.includes("rss") ||
    ct.includes("atom") ||
    ct.includes("xml") ||
    ct.includes("feed+json") ||
    (ct.includes("json") && looksLikeJsonFeed(body))
  );
}

function looksLikeFeedDocument(xml: string): boolean {
  return /<(rss|feed|rdf:RDF)\b/i.test(xml);
}

function looksLikeJsonFeed(body: string): boolean {
  const trimmed = body.trimStart();
  if (!trimmed.startsWith("{")) {
    return false;
  }
  // JSON Feed declares a version URI ending in jsonfeed.org/version/...
  return /"version"\s*:\s*"https?:\/\/jsonfeed\.org\/version\//i.test(trimmed);
}

function discoverFeedLink(html: string): string | null {
  const linkTags = html.match(
    /<link\b[^>]*rel=["']alternate["'][^>]*>/gi,
  );
  if (linkTags) {
    for (const tag of linkTags) {
      const type = tag.match(/type=["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? "";
      if (
        type.includes("rss") ||
        type.includes("atom") ||
        type.includes("feed+json") ||
        type === "application/json"
      ) {
        const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
        if (href) return href;
      }
    }
  }
  return null;
}

async function parseFeedItems(body: string, feedUrl: string): Promise<NormalizedPresenceItem[]> {
  if (looksLikeJsonFeed(body)) {
    try {
      const parsed = JSON.parse(body) as {
        items?: Array<Record<string, unknown>>;
      };
      const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
      return collectItems(rawItems.slice(0, MAX_FEED_ITEMS), (item) => normalizeJsonFeedItem(item, feedUrl));
    } catch {
      return [];
    }
  }
  return parseXmlFeedItems(body, feedUrl);
}

async function collectItems(
  entries: Array<Record<string, unknown>>,
  normalize: (entry: Record<string, unknown>) => NormalizedPresenceItem,
): Promise<NormalizedPresenceItem[]> {
  const items: NormalizedPresenceItem[] = [];
  for (const entry of entries) {
    const normalized = normalize(entry);
    const contentHash = await presenceContentHash({
      title: normalized.title,
      bodyExcerpt: normalized.bodyExcerpt,
      author: normalized.author,
      publishedAt: normalized.publishedAt,
    });
    items.push({ ...normalized, contentHash });
  }
  return items;
}

function normalizeJsonFeedItem(
  item: Record<string, unknown>,
  feedUrl: string,
): NormalizedPresenceItem {
  const observedAt = new Date().toISOString();
  const url = typeof item.url === "string" && item.url ? item.url : feedUrl;
  const title = typeof item.title === "string" && item.title ? item.title : "Untitled post";
  const contentText =
    typeof item.content_text === "string"
      ? item.content_text
      : typeof item.summary === "string"
        ? item.summary
        : "";
  const author = readJsonFeedAuthor(item);
  const publishedAt = typeof item.date_published === "string" ? safeIsoDate(item.date_published) : null;
  const externalId =
    typeof item.id === "string" && item.id ? item.id : typeof item.url === "string" ? item.url : null;

  return {
    externalId,
    canonicalUrl: url,
    title,
    bodyExcerpt: stripHtml(contentText).slice(0, MAX_FEED_EXCERPT_CHARS) || null,
    author,
    publishedAt,
    observedAt,
    contentHash: "",
    raw: { kind: "feed_entry", feedUrl, format: "json_feed" },
  };
}

function readJsonFeedAuthor(item: Record<string, unknown>): string | null {
  const authors = item.authors;
  if (Array.isArray(authors) && authors.length > 0) {
    const first = authors[0] as Record<string, unknown> | string | undefined;
    if (typeof first === "string") return first;
    if (first && typeof first.name === "string") return first.name;
  }
  const author = item.author as Record<string, unknown> | string | undefined;
  if (typeof author === "string") return author;
  if (author && typeof author.name === "string") return author.name;
  return null;
}

async function parseXmlFeedItems(xml: string, feedUrl: string): Promise<NormalizedPresenceItem[]> {
  const blocks = [
    ...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi),
  ];

  const entries: NormalizedPresenceItem[] = [];
  for (const match of blocks.slice(0, MAX_FEED_ITEMS)) {
    const block = match[1] ?? "";
    const observedAt = new Date().toISOString();

    const title = decodeXml(extractTag(block, "title") ?? "Untitled post");
    const link =
      block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] ??
      extractTag(block, "link") ??
      feedUrl;
    const publishedRaw =
      extractTag(block, "pubDate") ??
      extractTag(block, "published") ??
      extractTag(block, "updated") ??
      null;
    const author =
      decodeXml(block.match(/<author\b[^>]*>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<\/author>/i)?.[1] ?? "") ||
      decodeXml(extractTag(block, "author") ?? "") ||
      null;
    const excerpt = decodeXml(
      stripHtml(
        extractTag(block, "description") ??
          extractTag(block, "summary") ??
          extractTag(block, "content") ??
          "",
      ),
    ).slice(0, MAX_FEED_EXCERPT_CHARS);
    const externalId = extractTag(block, "guid") ?? extractTag(block, "id") ?? null;

    entries.push({
      externalId,
      // canonicalUrl is the per-item link, NOT the feed URL.
      canonicalUrl: link,
      title,
      bodyExcerpt: excerpt || null,
      author,
      publishedAt: publishedRaw ? safeIsoDate(publishedRaw) ?? observedAt : observedAt,
      observedAt,
      contentHash: "",
      raw: { kind: "feed_entry", feedUrl, format: looksLikeFeedDocument(xml) ? "atom" : "rss" },
    });
  }

  // Hash each entry (contentHash is required on every emitted item).
  for (const entry of entries) {
    entry.contentHash = await presenceContentHash({
      title: entry.title,
      bodyExcerpt: entry.bodyExcerpt,
      author: entry.author,
      publishedAt: entry.publishedAt,
    });
  }

  return entries;
}

// Matches `<tag ...>inner</tag>` for any tag name; the caller checks the name.
// A single precompiled regex avoids `new RegExp(userInput)` (ReDoS) and is
// faster than rebuilding per call. `tag` is always a hardcoded literal here.
const ANY_TAG_RE = /<([a-zA-Z][a-zA-Z0-9:_-]*)\b[^>]*>([\s\S]*?)<\/\1>/gi;

function extractTag(block: string, tag: string): string | null {
  const lower = tag.toLowerCase();
  for (const match of block.matchAll(ANY_TAG_RE)) {
    if (match[1]?.toLowerCase() === lower) {
      return match[2]?.trim() ?? null;
    }
  }
  return null;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function safeIsoDate(value: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function isGoogleNewsHost(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === GOOGLE_NEWS_HOST;
  } catch {
    return false;
  }
}

function isGoogleNewsNewsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== GOOGLE_NEWS_HOST) return false;
    return parsed.pathname === "/rss" || parsed.pathname.startsWith("/rss/");
  } catch {
    return false;
  }
}

function isGoogleNewsRedirectUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase() === GOOGLE_NEWS_HOST && parsed.pathname.startsWith("/rss/articles/");
  } catch {
    return false;
  }
}

/**
 * Resolve news.google.com redirect links to publisher URLs before hashing
 * (issue #3178 dedup bar). Order: (1) decode the base64url article id - the
 * newer CBMi-style ids embed the publisher URL, so no network is needed;
 * (2) at most one bounded fetch per link through `presenceSafeFetch`, whose
 * SSRF-validated redirect walking returns `finalUrl`; (3) when the landed
 * page is still on news.google.com, parse the embedded `data-n-au` attribute.
 * Unresolved links keep the redirect URL and are flagged in raw - never
 * silently dropped.
 */
async function resolveGoogleNewsRedirects(
  items: NormalizedPresenceItem[],
  fetchImpl: typeof fetch,
): Promise<NormalizedPresenceItem[]> {
  let fetchBudget = MAX_GNEWS_REDIRECTS_RESOLVED_PER_POLL;
  const cache = new Map<string, string>();
  for (const item of items) {
    if (!isGoogleNewsRedirectUrl(item.canonicalUrl)) continue;
    item.raw = { ...(item.raw ?? {}), kind: "news_article", provider: "google_news_rss" };

    const cached = cache.get(item.canonicalUrl);
    if (cached) {
      item.canonicalUrl = cached;
      continue;
    }

    let resolved = decodeGoogleNewsArticleId(item.canonicalUrl);
    if (!resolved && fetchBudget > 0) {
      fetchBudget -= 1;
      resolved = await resolveGoogleNewsRedirectByFetch(item.canonicalUrl, fetchImpl);
    }
    if (resolved) {
      cache.set(item.canonicalUrl, resolved);
      item.canonicalUrl = resolved;
    } else {
      item.raw.googleNewsRedirectUnresolved = true;
    }
  }
  return items;
}

function decodeGoogleNewsArticleId(link: string): string | null {
  const match = link.match(/\/rss\/articles\/([A-Za-z0-9_-]+)/);
  if (!match?.[1]) return null;
  try {
    const normalized = match[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
    return decoded.match(/https?:\/\/[^\x00-\x20"'<>]+/)?.[0] ?? null;
  } catch {
    return null;
  }
}

async function resolveGoogleNewsRedirectByFetch(
  link: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const response = await presenceSafeFetch(link, fetchImpl, {
    method: "GET",
    maxBytes: MAX_GNEWS_RESOLVE_FETCH_BYTES,
    accept: "text/html,*/*",
  });
  if (!response?.finalUrl) return null;
  let finalHost = "";
  try {
    finalHost = new URL(response.finalUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (finalHost !== GOOGLE_NEWS_HOST) {
    // At least one SSRF-validated redirect landed off news.google.com.
    return response.finalUrl;
  }
  // Same-host response: the article page embeds the publisher URL in
  // data-n-au. The body is the single bounded response we already hold.
  const embedded = response.body?.match(/data-n-au=["']([^"']+)["']/i)?.[1];
  if (!embedded || embedded.includes(GOOGLE_NEWS_HOST)) return null;
  try {
    const resolved = await resolvePublicHttpUrl(embedded);
    return resolved ? resolved.toString() : null;
  } catch {
    return null;
  }
}
