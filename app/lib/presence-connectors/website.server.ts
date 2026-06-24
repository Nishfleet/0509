import {
  contentLengthExceeds,
  readResponseTextWithinLimit,
} from "~/lib/bounded-response.server";
import { presenceContentHash } from "~/lib/presence-hash";
import type {
  CostEstimate,
  HealthCheckResult,
  NormalizedPresenceItem,
  PollResult,
  PresenceConnectorContext,
  ValidateTargetInput,
  ValidateTargetResult,
} from "~/lib/presence-types";
import {
  resolvePublicHttpUrl,
  resolvePublicRedirectUrl,
} from "~/lib/public-url.server";

const MAX_WEBSITE_FETCH_BYTES = 750_000;
const MAX_WEBSITE_REDIRECTS = 5;
const USER_AGENT = "0509-presence/1.0 (+https://0509.io)";

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
    const discoveredFeed = feedUrl ?? (await discoverFeedUrl(target.targetUrl, fetchImpl));
    if (discoveredFeed) {
      const feedResult = await fetchFeed(discoveredFeed, fetchImpl, cursor);
      if (feedResult.ok) {
        return {
          ...feedResult,
          cursor: { feedUrl: discoveredFeed, ...(feedResult.cursor ?? {}) },
        };
      }
    }

    const pageResult = await fetchPageChange(target.targetUrl, fetchImpl, cursor);
    return pageResult;
  },
};

async function discoverFeedUrl(siteUrl: string, fetchImpl: typeof fetch) {
  const page = await fetchPublicResource(siteUrl, fetchImpl);
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
  return {
    ok: true,
    items,
    etag: response.etag,
    lastModified: response.lastModified,
    coverageLabel: "VERIFIED_PUBLIC_FEED",
    costUnits: 1,
  } as PollResult & { coverageLabel?: string };
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
    return { ok: true, items: [], etag: response.etag, lastModified: response.lastModified, costUnits: 0 };
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

async function fetchPublicResource(
  url: string,
  fetchImpl: typeof fetch,
  options: {
    method?: string;
    etag?: string | null;
    lastModified?: string | null;
  } = {},
) {
  let currentUrl = await resolvePublicHttpUrl(url);
  for (let redirects = 0; currentUrl && redirects <= MAX_WEBSITE_REDIRECTS; redirects += 1) {
    const headers: Record<string, string> = {
      accept: "text/html,application/xhtml+xml,application/xml,text/xml,*/*",
      "user-agent": USER_AGENT,
    };
    if (options.etag) headers["if-none-match"] = options.etag;
    if (options.lastModified) headers["if-modified-since"] = options.lastModified;

    const response = await fetchImpl(currentUrl.toString(), {
      method: options.method ?? "GET",
      redirect: "manual",
      headers,
    });

    if (response.status === 304) {
      return {
        ok: true,
        notModified: true,
        status: 304,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        body: null,
        contentType: response.headers.get("content-type"),
      };
    }

    if (response.status >= 300 && response.status < 400) {
      const redirected = resolvePublicRedirectUrl(response.headers.get("location"), currentUrl);
      currentUrl = redirected ? await resolvePublicHttpUrl(redirected) : null;
      continue;
    }

    if (options.method === "HEAD") {
      return {
        ok: response.ok,
        notModified: false,
        status: response.status,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        body: null,
        contentType: response.headers.get("content-type"),
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        notModified: false,
        status: response.status,
        etag: null,
        lastModified: null,
        body: null,
        contentType: null,
      };
    }

    if (contentLengthExceeds(response.headers, MAX_WEBSITE_FETCH_BYTES)) {
      return null;
    }

    const body = await readResponseTextWithinLimit(response, MAX_WEBSITE_FETCH_BYTES);
    return {
      ok: true,
      notModified: false,
      status: response.status,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      body,
      contentType: response.headers.get("content-type"),
    };
  }

  return null;
}

function extractTitle(html: string) {
  return decodeXml(
    html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ??
      html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      "",
  ) || null;
}

function extractTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.trim() ?? null;
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeXml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}
