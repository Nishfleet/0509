import { env } from "cloudflare:workers";
import { z } from "zod";

import type { FeedFacts } from "../rival-baseline";

const MAX_FEEDS = 30;

export const SELECT_FEED_SNAPSHOTS = `SELECT w.entity_id AS entity_id, sn.item_count AS item_count, sn.payload_r2_key AS r2_key
FROM watch w
JOIN source src ON src.id = w.source_id AND src.key = 'feed.rss'
JOIN entity e ON e.id = w.entity_id AND e.workspace_id = ?1 AND e.role = 'competitor' AND e.state = 'on'
JOIN snapshot sn ON sn.id = (SELECT x.id FROM snapshot x WHERE x.watch_id = w.id ORDER BY x.fetched_at DESC LIMIT 1)
WHERE w.is_active = 1
LIMIT ${String(MAX_FEEDS)}`;

export interface FeedSnapshotRow {
  entity_id: string;
  item_count: number;
  r2_key: string | null;
}

const storedPosts = z.array(z.object({ title: z.string().catch(""), publishedAt: z.string().nullable().catch(null) }));

function newest(posts: z.infer<typeof storedPosts>): { title: string | null; at: string | null } {
  const dated = posts
    .filter((post) => post.publishedAt !== null && !Number.isNaN(Date.parse(post.publishedAt)))
    .sort((a, b) => Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? ""));
  const latest = dated[0] ?? posts[0];
  return { title: latest?.title ?? null, at: latest?.publishedAt ?? null };
}

async function factsOf(row: FeedSnapshotRow): Promise<FeedFacts> {
  const none = { posts: row.item_count, latestTitle: null, latestAt: null };
  if (row.r2_key === null) return none;
  try {
    const object = await env.SNAPSHOTS.get(row.r2_key);
    if (object === null) return none;
    const parsed = storedPosts.safeParse(JSON.parse(await object.text()));
    if (!parsed.success) return none;
    const latest = newest(parsed.data);
    return { posts: row.item_count, latestTitle: latest.title, latestAt: latest.at };
  } catch {
    return none;
  }
}

export async function feedFactsFrom(rows: readonly FeedSnapshotRow[]): Promise<Map<string, FeedFacts>> {
  const facts = await Promise.all(rows.map(async (row) => [row.entity_id, await factsOf(row)] as const));
  return new Map(facts);
}
