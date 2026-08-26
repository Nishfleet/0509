import { decodeHtmlEntities as decodeXml } from "~/lib/decode-html.server";
import { presenceContentHash } from "~/lib/presence-hash";
import {
  assertRobotsAllowedForUrls,
  presenceSafeFetch,
} from "~/lib/presence-robots.server";
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

const MAX_WEBSITE_FETCH_BYTES = 750_000;
const MAX_FEED_CANDIDATE_FETCHES = 6;

export const websiteConnector = {
  id: "website" as const,
  supportedModes: ["self", "competitor"] as const,

  estimateCost(): CostEstimate {
    return { units: 1, description: "One public HTTP fetch with conditional headers" };
  },

  async validateTarget(input: ValidateTargetInput): Promise<ValidateTargetResult> {
    const raw = input.targetUrl?.trim();
    if (!raw) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "missing_url",
        errorMessage: "Enter a website URL to track.",
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

    safeUrl.hash = "";
    safeUrl.search = "";
    const normalized = safeUrl.toString().replace(/\/$/, "") || safeUrl.toString();

    return {
      ok: true,
      targetKey: safeUrl.hostname.toLowerCase(),
      targetUrl: normalized,
      coverageLabel: "PUBLIC_WEB_BEST_EFFORT",
      metadata: {
        feedDiscovery: "pending",
      },
    };
  },

  async healthCheck(): Promise<HealthCheckResult> {
    return {
      ok: true,
      status: "healthy",
      summary: "Website tracking uses public feeds and pages — no account connection required.",
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
        errorMessage: "Website target URL is missing.",
      };
    }

    const fetchImpl = ctx.fetchImpl ?? fetch;
    const feedUrl = typeof target.metadata.feedUrl === "string" ? target.metadata.feedUrl : null;
    const candidateUrls = [target.targetUrl];
    if (feedUrl) {
      candidateUrls.push(feedUrl);
    } else {
      candidateUrls.push(...guessFeedCandidates(target.targetUrl));
    }

    const robotsCheck = await assertRobotsAllowedForUrls(target.targetUrl, candidateUrls, fetchImpl);
    if (!robotsCheck.allowed) {
      return {
        ok: false,
        items: [],
        errorCode: robotsCheck.errorCode ?? "robots_disallowed",
        errorMessage: robotsCheck.errorMessage ?? "robots.txt blocks crawling.",
        cursor: {
          robotsStatus: robotsCheck.policy.status,
          robotsCheckedAt: robotsCheck.policy.fetchedAt,
        },
      };
    }

    const discoveredFeed = feedUrl ?? (await discoverFeedUrl(target.targetUrl, fetchImpl));
    if (discoveredFeed) {
      const feedRobots = await assertRobotsAllowedForUrls(target.targetUrl, [discoveredFeed], fetchImpl);
      if (!feedRobots.allowed) {
        return {
          ok: false,
          items: [],
          errorCode: feedRobots.errorCode ?? "robots_disallowed",
          errorMessage: feedRobots.errorMessage ?? "robots.txt blocks the feed URL.",
          cursor: {
            robotsStatus: feedRobots.policy.status,
            robotsCheckedAt: feedRobots.policy.fetchedAt,
          },
        };
      }

      const feedResult = await fetchFeed(discoveredFeed, fetchImpl, cursor);
      if (feedResult.ok) {
        return {
          ...feedResult,
          cursor: {
            feedUrl: discoveredFeed,
            robotsStatus: robotsCheck.policy.status,
            robotsCheckedAt: robotsCheck.policy.fetchedAt,
            ...(feedResult.cursor ?? {}),
          },
        };
      }
    }

    const pageResult = await fetchPageChange(target.targetUrl, fetchImpl, cursor);
    return {
      ...pageResult,
      cursor: {
        robotsStatus: robotsCheck.policy.status,
        robotsCheckedAt: robotsCheck.policy.fetchedAt,
        ...(pageResult.cursor ?? {}),
      },
    };
  },
};

async function discoverFeedUrl(siteUrl: string, fetchImpl: typeof fetch) {
  let fetches = 0;
  const page = await fetchPublicResource(siteUrl, fetchImpl);
  fetches += 1;
  if (!page?.body) {
    return guessFeedCandidates(siteUrl)[0] ?? null;
  }

  const linkMatch = page.body.match(
    /<link[^>]+rel=["']alternate["'][^>]+type=["'](application\/rss\+xml|application\/atom\+xml)["'][^>]*>/gi,
  );
  if (linkMatch) {
    for (const tag of linkMatch) {
      const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
      if (!href) continue;
      const resolved = await resolvePublicHttpUrl(new URL(href, siteUrl));
      if (resolved) return resolved.toString();
    }
  }

  for (const candidate of guessFeedCandidates(siteUrl)) {
    if (fetches >= MAX_FEED_CANDIDATE_FETCHES) break;
    fetches += 1;
    const head = await fetchPublicResource(candidate, fetchImpl, { method: "HEAD" });
    if (head?.ok) {
      const type = head.contentType ?? "";
      if (type.includes("xml") || type.includes("rss") || type.includes("atom")) {
        return candidate;
      }
    }
  }

  return null;
}

function guessFeedCandidates(siteUrl: string) {
  try {
    const base = new URL(siteUrl);
    return [
      new URL("/feed", base).toString(),
      new URL("/rss", base).toString(),
      new URL("/rss.xml", base).toString(),
      new URL("/atom.xml", base).toString(),
      new URL("/blog/feed", base).toString(),
    ];
  } catch {
    return [];
  }
}

async function fetchFeed(
  feedUrl: string,
  fetchImpl: typeof fetch,
  cursor?: { etag?: string | null; lastModified?: string | null },
): Promise<PollResult> {
  const response = await fetchPublicResource(feedUrl, fetchImpl, {
    etag: cursor?.etag,
    lastModified: cursor?.lastModified,
  });
  if (!response) {
    return {
      ok: false,
      items: [],
      errorCode: "fetch_failed",
      errorMessage: "Could not fetch the website feed.",
    };
  }

  if (response.notModified) {
    return {
      ok: true,
      items: [],
      etag: response.etag,
      lastModified: response.lastModified,
      coverageLabel: "VERIFIED_PUBLIC_FEED",
      costUnits: 0,
    };
  }

  if (!response.ok || !response.body) {
    return {
      ok: false,
      items: [],
      errorCode: "feed_unavailable",
      errorMessage: `Feed responded with HTTP ${response.status}.`,
    };
  }

  const items = parseFeedItems(response.body, feedUrl);
  if (items.length === 0 && !looksLikeFeedDocument(response.body)) {
    return {
      ok: false,
      items: [],
      errorCode: "feed_parse_failed",
      errorMessage: "Website feed did not contain valid RSS or Atom entries.",
      etag: response.etag,
      lastModified: response.lastModified,
    };
  }

  return {
    ok: true,
    items,
    etag: response.etag,
    lastModified: response.lastModified,
    coverageLabel: "VERIFIED_PUBLIC_FEED",
    costUnits: 1,
    cursor: { completeSnapshot: items.length > 0, feedUrl },
  };
}

async function fetchPageChange(
  siteUrl: string,
  fetchImpl: typeof fetch,
  cursor?: { etag?: string | null; lastModified?: string | null },
): Promise<PollResult> {
  const response = await fetchPublicResource(siteUrl, fetchImpl, {
    etag: cursor?.etag,
    lastModified: cursor?.lastModified,
  });
  if (!response) {
    return {
      ok: false,
      items: [],
      errorCode: "fetch_failed",
      errorMessage: "Could not fetch the website.",
    };
  }

  if (response.notModified) {
    return {
      ok: true,
      items: [],
      etag: response.etag,
      lastModified: response.lastModified,
      coverageLabel: "PUBLIC_WEB_BEST_EFFORT",
      costUnits: 0,
    };
  }

  if (!response.ok || !response.body) {
    return {
      ok: false,
      items: [],
      errorCode: "page_unavailable",
      errorMessage: `Website responded with HTTP ${response.status}.`,
    };
  }

  const title = extractTitle(response.body) ?? "Website update";
  const observedAt = new Date().toISOString();
  const contentHash = await presenceContentHash({ title, bodyExcerpt: response.body.slice(0, 500) });
  const item: NormalizedPresenceItem = {
    externalId: null,
    canonicalUrl: siteUrl,
    title,
    bodyExcerpt: stripHtml(response.body).slice(0, 280) || null,
    author: null,
    publishedAt: observedAt,
    observedAt,
    contentHash,
    raw: { kind: "page_snapshot" },
  };

  return {
    ok: true,
    items: [item],
    etag: response.etag,
    lastModified: response.lastModified,
    coverageLabel: "PUBLIC_WEB_BEST_EFFORT",
    costUnits: 1,
  };
}

function parseFeedItems(xml: string, feedUrl: string): NormalizedPresenceItem[] {
  const entries: NormalizedPresenceItem[] = [];
  const itemBlocks = [
    ...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi),
  ];

  for (const match of itemBlocks.slice(0, 25)) {
    const block = match[1] ?? "";
    const title = decodeXml(extractTag(block, "title") ?? "Untitled post");
    const link =
      block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] ??
      extractTag(block, "link") ??
      feedUrl;
    const publishedAt = extractTag(block, "pubDate") ?? extractTag(block, "published") ?? extractTag(block, "updated");
    const author =
      extractTag(block, "author") ??
      block.match(/<name>([^<]+)<\/name>/i)?.[1] ??
      null;
    const excerpt = decodeXml(
      stripHtml(extractTag(block, "description") ?? extractTag(block, "summary") ?? extractTag(block, "content") ?? ""),
    ).slice(0, 280);
    const observedAt = new Date().toISOString();
    entries.push({
      externalId: extractTag(block, "guid") ?? extractTag(block, "id"),
      canonicalUrl: link,
      title,
      bodyExcerpt: excerpt || null,
      author,
      publishedAt: publishedAt ? new Date(publishedAt).toISOString() : observedAt,
      observedAt,
      contentHash: "",
      raw: { kind: "feed_entry", feedUrl },
    });
  }

  return entries;
}

function looksLikeFeedDocument(xml: string) {
  return /<(rss|feed)\b/i.test(xml) || /<rdf:RDF\b/i.test(xml);
}

async function fetchPublicResource(
  url: string,
  fetchImpl: typeof fetch,
  options: {
    method?: string;
    etag?: string | null;
    lastModified?: string | null;
  } = {},
) {
  const response = await presenceSafeFetch(url, fetchImpl, {
    method: options.method,
    maxBytes: MAX_WEBSITE_FETCH_BYTES,
    etag: options.etag,
    lastModified: options.lastModified,
  });
  if (!response) {
    return null;
  }

  return {
    ok: response.ok,
    notModified: response.notModified ?? false,
    status: response.status,
    etag: response.etag,
    lastModified: response.lastModified,
    body: response.body,
    contentType: response.contentType,
  };
}

function extractTitle(html: string) {
  return decodeXml(
    html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ??
      html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      "",
  ) || null;
}

function extractTagPatternForTag(tag: string): RegExp | null {
  switch (tag) {
    case "author":
      return /<author[^>]*>([\s\S]*?)<\/author>/i;
    case "content":
      return /<content[^>]*>([\s\S]*?)<\/content>/i;
    case "description":
      return /<description[^>]*>([\s\S]*?)<\/description>/i;
    case "guid":
      return /<guid[^>]*>([\s\S]*?)<\/guid>/i;
    case "id":
      return /<id[^>]*>([\s\S]*?)<\/id>/i;
    case "link":
      return /<link[^>]*>([\s\S]*?)<\/link>/i;
    case "pubDate":
      return /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i;
    case "published":
      return /<published[^>]*>([\s\S]*?)<\/published>/i;
    case "summary":
      return /<summary[^>]*>([\s\S]*?)<\/summary>/i;
    case "title":
      return /<title[^>]*>([\s\S]*?)<\/title>/i;
    case "updated":
      return /<updated[^>]*>([\s\S]*?)<\/updated>/i;
    default:
      return null;
  }
}

/** Extract inner text of allowlisted feed tags. Unknown tags, including
 * those that contain regex metacharacters, return null. */
export function extractTag(block: string, tag: string): string | null {
  const pattern = extractTagPatternForTag(tag);
  if (pattern === null) return null;
  const match = block.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
