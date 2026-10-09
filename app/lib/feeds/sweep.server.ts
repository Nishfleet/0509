import { getDomain } from "tldts";
import { z } from "zod";

import { readPaidWorkspaceIds } from "../data/plan.server";
import type { FeedTarget } from "../data/watch.server";
import { insertWatches, readEntitiesWithoutFeedWatch, readFeedTargets } from "../data/watch.server";
import { readEnabledSourceId } from "../data/source.server";
import { readThrough } from "../identity/probe-cache.server";
import { feedCandidates } from "./discover-feed";
import { fetchFeed, fetchHomepage } from "./fetch-feed.server";
import { isFeedDocument } from "./parse-feed";

const FEED_SCHEMA = z.object({ feedUrl: z.string().nullable() });

const FEED_TTL_SECONDS = 604_800;

export interface FoundFeed {
  entityId: string;
  feedUrl: string | null;
  watched: boolean;
}

export async function planFeedSweep(): Promise<{
  entities: readonly { id: string; domain: string }[];
  targets: readonly FeedTarget[];
}> {
  const paid = await readPaidWorkspaceIds(new Date());
  const targets = (await readFeedTargets()).filter((target) => paid.has(target.workspaceId));
  const entities = (await readEntitiesWithoutFeedWatch()).filter((entity) => paid.has(entity.workspaceId));
  return { entities: entities.map(({ id, domain }) => ({ id, domain })), targets };
}

async function firstReadableFeed(candidates: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    const result = await fetchFeed(candidate, null);
    if (result.outcome === "ok" && isFeedDocument(result.body)) return candidate;
  }
  return null;
}

async function loadFeed(homepage: string): Promise<z.infer<typeof FEED_SCHEMA>> {
  const html = await fetchHomepage(homepage);
  return { feedUrl: await firstReadableFeed(await feedCandidates(html, homepage)) };
}

export async function findFeed(entity: { id: string; domain: string }): Promise<FoundFeed> {
  const none = { entityId: entity.id, feedUrl: null, watched: false };
  const registrable = getDomain(entity.domain);
  if (registrable === null || registrable !== entity.domain) return none;

  const homepage = `https://${entity.domain}/`;
  const found = await readThrough({
    key: `feed:v3:${registrable}:url`,
    schema: FEED_SCHEMA,
    ttlSeconds: FEED_TTL_SECONDS,
    run: () => loadFeed(homepage),
  });
  if (found.feedUrl === null) return none;

  const sourceId = await readEnabledSourceId("feed.rss");
  if (sourceId === null) return { ...none, feedUrl: found.feedUrl };

  await insertWatches([{ id: crypto.randomUUID(), entityId: entity.id, sourceId, targetKey: found.feedUrl }]);
  return { entityId: entity.id, feedUrl: found.feedUrl, watched: true };
}
