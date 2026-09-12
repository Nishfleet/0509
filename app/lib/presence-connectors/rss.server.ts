import { decodeHtmlEntities as decodeXml } from "~/lib/decode-html.server";
import { isQueryFeedUrl } from "~/lib/mention-match.server";
import { evaluateConnectorAccessGate } from "~/lib/presence-access-gates.server";
import { presenceContentHash } from "~/lib/presence-hash";
import { presenceSafeFetch, PRESENCE_USER_AGENT } from "~/lib/presence-robots.server";
import type {
  CostEstimate,
  HealthCheckResult,
  NormalizedPresenceItem,
  PollResult,
  PresenceConnectorContext,
  ValidateTargetInput,
  ValidateTargetResult,
} from "~/lib/presence-types";
import { resolvePublicHttpUrl, resolvePublicRedirectUrl } from "~/lib/public-url.server";

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
        metadata: { feedUrl: normalized, feedDiscovery: "direct" },
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
        return await resolveQueryFeedItemUrls(
          {
            ...retry.result,
            cursor: { feedUrl: discovered, ...(retry.result.cursor ?? {}) },
          },
          feedUrl,
          fetchImpl,
        );
      }
    }

    return await resolveQueryFeedItemUrls(fetched.result, feedUrl, fetchImpl);
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
  const items = await parseFeedItems(body, feedUrl);

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

/**
 * Query-feed item URL resolution (mention backbone, Nishfleet/0509#3250).
 *
 * Google News query feeds (`news.google.com/rss/search?q=...`) embed article
 * links as `https://news.google.com/rss/articles/<id>` URLs that 302-redirect
 * to the publisher. Without resolution, the same story lands under a different
 * `url_hash` per surface — the dedup UNIQUE on `(source_target_id, url_hash)`
 * can't group the same publisher URL across surfaces, and the mention rank
 * `cross-source dedup` (docs/mentions/PLAN.md §4) collapses on the redirect.
 *
 * Resolution runs through `presenceSafeFetch` with manual redirects so every
 * hop is SSRF-checked by `resolvePublicHttpUrl`. The fetched body is
 * discarded — only the final URL is captured. When resolution fails (timeout,
 * private redirect target, SSRF block, missing Location), the original
 * `news.google.com` URL stays as `canonicalUrl` and the redirect URL is
 * recorded under `raw.googleNewsRedirect` so a later retry has the context.
 *
 * For non-query feeds this is a no-op pass-through: the items already carry
 * their publisher URL as `canonicalUrl`. Cost stays one extra bounded fetch
 * per query-feed item, which the issue flags as the per-poll budget trade.
 */
async function resolveQueryFeedItemUrls(
  result: PollResult,
  feedUrl: string,
  fetchImpl: typeof fetch,
): Promise<PollResult> {
  if (!result.ok || result.items.length === 0) return result;
  if (!isQueryFeedUrl(feedUrl)) return result;

  const resolved = await Promise.all(
    result.items.map((item) => resolveItemCanonicalUrl(item, fetchImpl)),
  );

  // Rehash any item whose canonicalUrl changed — the contentHash covers
  // (title, bodyExcerpt, author, publishedAt), not the URL, so the
  // content_hash stays the same; url_hash is what we re-derive downstream
  // via `presenceUrlHash` (hash of canonical_url), so persisting the
  // resolved URL is the contract.
  const itemsWithRefreshedHash: NormalizedPresenceItem[] = [];
  for (let i = 0; i < result.items.length; i += 1) {
    const original = result.items[i];
    const next = resolved[i];
    itemsWithRefreshedHash.push({
      ...original,
      canonicalUrl: next.canonicalUrl,
      raw: {
        ...(original.raw ?? {}),
        ...(next.rawExtras ?? {}),
      },
    });
  }

  return {
    ...result,
    items: itemsWithRefreshedHash,
  };
}

async function resolveItemCanonicalUrl(
  item: NormalizedPresenceItem,
  fetchImpl: typeof fetch,
): Promise<{ canonicalUrl: string; rawExtras?: Record<string, unknown> }> {
  const original = item.canonicalUrl;
  if (!isGoogleNewsRssRedirect(original)) {
    return { canonicalUrl: original };
  }

  let currentUrl: URL | null = await resolvePublicHttpUrl(original);
  for (let redirects = 0; currentUrl && redirects <= 5; redirects += 1) {
    let response: Response;
    try {
      response = await fetchWithTimeoutForRedirect(
        currentUrl.toString(),
        fetchImpl,
      );
    } catch {
      currentUrl = null;
      break;
    }
    if (response.status >= 300 && response.status < 400) {
      const next = resolvePublicRedirectUrl(response.headers.get("location"), currentUrl);
      // Drain the body so the runtime can release the socket — we only want
      // the Location header.
      try {
        await response.arrayBuffer();
      } catch {
        // ignore — body drain is best-effort
      }
      currentUrl = next ? await resolvePublicHttpUrl(next) : null;
      continue;
    }
    // Non-redirect response (200, 404, etc.): stop following. The final URL
    // we reached is the publisher canonical URL even if the page itself
    // failed — the next poll will surface that via the standard poll path.
    try {
      await response.arrayBuffer();
    } catch {
      // ignore
    }
    break;
  }

  if (!currentUrl) {
    return {
      canonicalUrl: original,
      rawExtras: { googleNewsRedirect: original, googleNewsResolved: null },
    };
  }

  const resolvedUrl = currentUrl.toString();
  if (resolvedUrl === original) {
    return { canonicalUrl: original, rawExtras: { googleNewsRedirect: original } };
  }
  return {
    canonicalUrl: resolvedUrl,
    rawExtras: { googleNewsRedirect: original, googleNewsResolved: resolvedUrl },
  };
}

function isGoogleNewsRssRedirect(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.toLowerCase() === "news.google.com" &&
      parsed.pathname.startsWith("/rss/articles")
    );
  } catch {
    return false;
  }
}

/**
 * A minimal HEAD-with-manual-redirect fetch used purely to learn the final
 * URL of a Google News redirect. Re-uses `presenceSafeFetch`'s SSRF contract
 * by going through `fetchWithTimeout` directly (the same helper
 * `presenceSafeFetch` uses internally) — every hop is re-validated by
 * `resolvePublicHttpUrl` in the loop above.
 */
async function fetchWithTimeoutForRedirect(
  url: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const { fetchWithTimeout } = await import("~/lib/fetch-timeout.server");
  return fetchWithTimeout(
    url,
    {
      method: "GET",
      redirect: "manual",
      headers: { "user-agent": PRESENCE_USER_AGENT },
    },
    { fetcher: fetchImpl, timeoutMs: 5_000 },
  );
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
