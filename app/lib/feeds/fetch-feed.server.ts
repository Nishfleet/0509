import { cappedText, fetchOutbound } from "../fetch/outbound.server";
import { CRAWLER_USER_AGENT, robotsAllows } from "../fetch/robots.server";

export interface FeedValidators {
  etag: string | null;
  lastModified: string | null;
}

export type FeedFetch =
  | { outcome: "ok"; body: string; validators: FeedValidators }
  | { outcome: "not-modified" }
  | { outcome: "gone" }
  | { outcome: "unreadable" };

const MAX_FEED_BYTES = 2 * 1024 * 1024;

const FEED_TIMEOUT_MS = 8_000;

const ACCEPT = "application/atom+xml, application/rss+xml, application/xml;q=0.9, text/xml;q=0.8";

function requestHeaders(validators: FeedValidators | null): Record<string, string> {
  return {
    "user-agent": CRAWLER_USER_AGENT,
    accept: ACCEPT,
    ...(validators?.etag ? { "if-none-match": validators.etag } : {}),
    ...(validators?.lastModified ? { "if-modified-since": validators.lastModified } : {}),
  };
}

async function classify(response: Response): Promise<FeedFetch> {
  if (response.status === 304) return { outcome: "not-modified" };
  if (!response.ok) {
    await response.body?.cancel();
    return { outcome: response.status === 404 || response.status === 410 ? "gone" : "unreadable" };
  }
  const body = await cappedText(response, MAX_FEED_BYTES);
  if (body === null) return { outcome: "unreadable" };
  return {
    outcome: "ok",
    body,
    validators: { etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") },
  };
}

export async function fetchFeed(url: string, validators: FeedValidators | null): Promise<FeedFetch> {
  try {
    if (!(await robotsAllows(url))) return { outcome: "unreadable" };
    const response = await fetchOutbound(url, {
      headers: requestHeaders(validators),
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    });
    return await classify(response);
  } catch (error) {
    console.log(JSON.stringify({ event: "feed.fetch_failed", error: error instanceof Error ? error.name : "unknown" }));
    return { outcome: "unreadable" };
  }
}

export async function fetchHomepage(url: string): Promise<string | null> {
  try {
    if (!(await robotsAllows(url))) return null;
    const response = await fetchOutbound(url, {
      headers: { "user-agent": CRAWLER_USER_AGENT, accept: "text/html" },
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    return await cappedText(response, MAX_FEED_BYTES);
  } catch (error) {
    console.log(
      JSON.stringify({ event: "feed.homepage_failed", error: error instanceof Error ? error.name : "unknown" }),
    );
    return null;
  }
}
