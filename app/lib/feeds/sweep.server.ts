import { getDomain } from "tldts";
import { z } from "zod";

import type { FeedTarget } from "../data/watch.server";
import { insertWatches, readEntitiesWithoutFeedWatch, readFeedTargets } from "../data/watch.server";
import { readEnabledSourceId } from "../data/source.server";
import { readThrough } from "../identity/probe-cache.server";
import { readUrl } from "../fetch/transport.server";
import { feedCandidates } from "./discover-feed";
import { fetchFeed } from "./fetch-feed.server";
import { isFeedDocument } from "./parse-feed";

const FEED_SCHEMA = z.object({ feedUrl: z.string().nullable() });

const FEED_TTL_SECONDS = 604_800;

class HomepageDeferredError extends Error {}

export interface FoundFeed {
  entityId: string;
  feedUrl: string | null;
  watched: boolean;
}

export async function planFeedSweep(): Promise<{
  entities: readonly { id: string; domain: string }[];
  targets: readonly FeedTarget[];
}> {
  return { entities: await readEntitiesWithoutFeedWatch(), targets: await readFeedTargets() };
}

async function homepageHtml(domain: string, homepage: string): Promise<string | null> {
  const page = await readUrl(homepage);
  if (page.ok) return page.html;
  if (page.reason === "deferred") throw new HomepageDeferredError(domain);
  return null;
}

async function firstReadableFeed(candidates: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    const result = await fetchFeed(candidate, null);
    if (result.outcome === "ok" && isFeedDocument(result.body)) return candidate;
  }
  return null;
}

async function loadFeed(domain: string, homepage: string): Promise<z.infer<typeof FEED_SCHEMA>> {
  const html = await homepageHtml(domain, homepage);
  return { feedUrl: await firstReadableFeed(feedCandidates(html, homepage)) };
}

async function readFeedThrough(
  domain: string,
  registrable: string,
  homepage: string,
): Promise<z.infer<typeof FEED_SCHEMA> | null> {
  try {
    return await readThrough({
      key: `feed:${registrable}:url`,
      schema: FEED_SCHEMA,
      ttlSeconds: FEED_TTL_SECONDS,
      run: () => loadFeed(domain, homepage),
    });
  } catch (error) {
    if (error instanceof HomepageDeferredError) return null;
    throw error;
  }
}

export async function findFeed(entity: { id: string; domain: string }): Promise<FoundFeed> {
  const none = { entityId: entity.id, feedUrl: null, watched: false };
  const registrable = getDomain(entity.domain);
  if (registrable === null || registrable !== entity.domain) return none;

  const found = await readFeedThrough(entity.domain, registrable, `https://${entity.domain}/`);
  if (found?.feedUrl == null) return none;

  const sourceId = await readEnabledSourceId("feed.rss");
  if (sourceId === null) return { ...none, feedUrl: found.feedUrl };

  await insertWatches([{ id: crypto.randomUUID(), entityId: entity.id, sourceId, targetKey: found.feedUrl }]);
  return { entityId: entity.id, feedUrl: found.feedUrl, watched: true };
}
