import { env } from "cloudflare:workers";

import { D6_QUESTION_ID } from "../standing-score";
import {
  MENTION_FEED_SQL,
  mentionFeedBinds,
  mentionsFromRows,
  type MentionReadRow,
  type MentionRowModel,
} from "../mention-feed";

interface MentionFeedSqlRow {
  id: string;
  title: string | null;
  url: string;
  published_at: string | null;
  observed_at: string;
  platform: string;
  kind: string;
  entity_state: string;
  p: number | null;
}

function toReadRow(row: MentionFeedSqlRow): MentionReadRow {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    platform: row.platform,
    kind: row.kind,
    publishedAt: row.published_at,
    observedAt: row.observed_at,
    entityState: row.entity_state,
    p: row.p,
  };
}

export async function readMentionFeed(workspaceId: string, now: Date): Promise<MentionRowModel[]> {
  const binds = mentionFeedBinds(workspaceId, D6_QUESTION_ID);
  const { results } = await env.DB.prepare(MENTION_FEED_SQL).bind(binds[0], binds[1]).all<MentionFeedSqlRow>();
  return mentionsFromRows(results.map(toReadRow), now);
}
