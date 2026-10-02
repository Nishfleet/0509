import { env } from "cloudflare:workers";
import { z } from "zod";

import type { BoardSnapshot } from "../data/snapshot.server";
import { insertBoardSnapshot, latestBoardSnapshot } from "../data/snapshot.server";
import { insertContentSignals } from "../data/signal.server";
import type { FeedTarget } from "../data/watch.server";
import { deactivateWatch, markWatchPolled, readWatchConfigJson, writeWatchConfigJson } from "../data/watch.server";
import type { SweepTick } from "../site/sweep.server";
import type { FeedValidators } from "./fetch-feed.server";
import { fetchFeed } from "./fetch-feed.server";
import type { KeyedFeedItem } from "./parse-feed";
import { hashItemKeys, keyItems, parseFeed } from "./parse-feed";

export interface FeedResult {
  outcome: "first" | "unchanged" | "changed" | "gone" | "unreadable";
  newPosts: number;
}

const storedItems = z.array(z.object({ key: z.string() }));

const validatorsSchema = z.object({
  etag: z.string().nullable().optional(),
  lastModified: z.string().nullable().optional(),
});

const configSchema = z.record(z.string(), z.unknown());

function parseConfig(json: string | null): Record<string, unknown> {
  if (json === null) return {};
  try {
    const parsed = configSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function validatorsOf(config: Record<string, unknown>): FeedValidators | null {
  const parsed = validatorsSchema.safeParse(config["feed"]);
  if (!parsed.success) return null;
  return { etag: parsed.data.etag ?? null, lastModified: parsed.data.lastModified ?? null };
}

async function rememberValidators(
  watchId: string,
  config: Record<string, unknown>,
  validators: FeedValidators,
): Promise<void> {
  const next = { ...config, feed: validators };
  if (JSON.stringify(next) === JSON.stringify(config)) return;
  await writeWatchConfigJson(watchId, JSON.stringify(next));
}

async function storeItems(input: {
  snapshotId: string;
  watchId: string;
  r2Key: string;
  hash: string;
  items: readonly KeyedFeedItem[];
  now: string;
}): Promise<void> {
  await env.SNAPSHOTS.put(input.r2Key, JSON.stringify(input.items), {
    httpMetadata: { contentType: "application/json" },
  });
  await insertBoardSnapshot({
    id: input.snapshotId,
    watchId: input.watchId,
    fetchedAt: input.now,
    r2Key: input.r2Key,
    hash: input.hash,
    itemCount: input.items.length,
  });
}

async function fileFreshPosts(input: {
  target: FeedTarget;
  previous: BoardSnapshot;
  items: readonly KeyedFeedItem[];
  snapshotId: string;
  now: string;
}): Promise<number> {
  const { target, previous, items, snapshotId, now } = input;
  const previousObject = previous.r2Key === null ? null : await env.SNAPSHOTS.get(previous.r2Key);
  if (previousObject === null) throw new Error("feed.previous_snapshot_missing");
  const known = new Set(storedItems.parse(JSON.parse(await previousObject.text())).map((item) => item.key));
  const fresh = items.filter((item) => !known.has(item.key));
  await insertContentSignals(
    fresh.map((item) => ({
      id: crypto.randomUUID(),
      workspaceId: target.workspaceId,
      entityId: target.entityId,
      sourceId: target.sourceId,
      watchId: target.watchId,
      snapshotId,
      itemKey: item.key,
      title: item.title,
      excerpt: item.excerpt,
      url: item.url,
      publishedAt: item.publishedAt,
      observedAt: now,
    })),
  );
  return fresh.length;
}

export async function readFeed(target: FeedTarget, tick: SweepTick): Promise<FeedResult> {
  const config = parseConfig(await readWatchConfigJson(target.watchId));
  const fetched = await fetchFeed(target.feedUrl, validatorsOf(config));
  const now = new Date().toISOString();
  if (fetched.outcome === "unreadable") return { outcome: "unreadable", newPosts: 0 };
  if (fetched.outcome === "gone") {
    await deactivateWatch(target.watchId);
    return { outcome: "gone", newPosts: 0 };
  }
  if (fetched.outcome === "not-modified") {
    await markWatchPolled(target.watchId, now);
    return { outcome: "unchanged", newPosts: 0 };
  }
  const parsed = parseFeed(fetched.body, target.feedUrl, new Date(now));
  if (parsed === null) return { outcome: "unreadable", newPosts: 0 };

  await rememberValidators(target.watchId, config, fetched.validators);
  const items = await keyItems(parsed);
  const hash = await hashItemKeys(items);
  const previous = await latestBoardSnapshot(target.watchId, tick.plannedAt);
  const snapshotId = `${tick.instanceId}-${target.watchId}`;
  if (previous !== null && previous.hash === hash) {
    await insertBoardSnapshot({
      id: snapshotId,
      watchId: target.watchId,
      fetchedAt: now,
      r2Key: previous.r2Key,
      hash,
      itemCount: items.length,
    });
    await markWatchPolled(target.watchId, now);
    return { outcome: "unchanged", newPosts: 0 };
  }
  const r2Key = `snapshot/feed/${target.watchId}/${snapshotId}.json`;
  await storeItems({ snapshotId, watchId: target.watchId, r2Key, hash, items, now });
  if (previous === null) {
    await markWatchPolled(target.watchId, now);
    return { outcome: "first", newPosts: 0 };
  }
  const newPosts = await fileFreshPosts({ target, previous, items, snapshotId, now });
  await markWatchPolled(target.watchId, now);
  return { outcome: "changed", newPosts };
}
