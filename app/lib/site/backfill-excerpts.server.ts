import { env } from "cloudflare:workers";

import { readChangesWithoutExcerpt, saveChangeExcerpts } from "../data/signal.server";
import { parseDiffHunks } from "../site-change";
import { changeExcerpt } from "../site-change-excerpt";

const PER_NIGHT = 100;

async function excerptAt(diffKey: string) {
  const object = await env.SNAPSHOTS.get(diffKey);
  if (object === null) return [];
  const hunks = parseDiffHunks(await object.text());
  return hunks === null ? [] : changeExcerpt(hunks);
}

export async function backfillChangeExcerpts(): Promise<number> {
  const rows = await readChangesWithoutExcerpt(PER_NIGHT);
  const filled = await Promise.all(rows.map(async (row) => ({ id: row.id, excerpt: await excerptAt(row.diffKey) })));
  await saveChangeExcerpts(filled);
  return filled.length;
}
