import { env } from "cloudflare:workers";
import { z } from "zod";

import { D6_QUESTION_ID } from "../standing-score";
import { mentionsFromRows, type MentionReadRow, type MentionRowModel } from "../mention-feed";

const MENTION_FEED_SQL = `SELECT m.id, m.title, m.canonical_url AS url, m.published_at, m.observed_at, m.state,
  (SELECT COUNT(*) FROM signal d WHERE d.duplicate_of = m.id AND d.is_tombstoned = 0) AS also_count,
  s.platform, s.kind, v.p, v.reason, v.id AS verdict_id, v.decided_at AS verdict_decided_at
FROM mention m
JOIN entity e ON e.id = m.entity_id AND e.workspace_id = m.workspace_id AND e.state = 'on'
JOIN source s ON s.id = m.source_id
LEFT JOIN jev_verdict v ON v.id = (
  SELECT v2.id FROM jev_verdict v2
  WHERE v2.signal_id = m.id AND v2.workspace_id = m.workspace_id AND v2.question_id = ?2
  ORDER BY v2.decided_at DESC
  LIMIT 1
)
WHERE m.workspace_id = ?1 AND m.duplicate_of IS NULL
ORDER BY m.observed_at DESC, m.id DESC
LIMIT 50`;

const mentionFeedSqlRow = z.object({
  id: z.string(),
  title: z.string().nullable(),
  url: z.string(),
  published_at: z.string().nullable(),
  observed_at: z.string(),
  state: z.enum(["judged", "unjudged"]).nullable(),
  also_count: z.number(),
  platform: z.string(),
  kind: z.string(),
  p: z.number().nullable(),
  reason: z.string().nullable(),
  verdict_id: z.string().nullable(),
  verdict_decided_at: z.string().nullable(),
});

type MentionFeedSqlRow = z.infer<typeof mentionFeedSqlRow>;

function toReadRow(row: MentionFeedSqlRow): MentionReadRow {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    platform: row.platform,
    kind: row.kind,
    publishedAt: row.published_at,
    observedAt: row.observed_at,
    p: row.p,
    reason: row.reason,
    verdictId: row.verdict_id,
    verdictDecidedAt: row.verdict_decided_at,
    state: row.state,
    alsoCount: row.also_count,
  };
}

export async function readMentionFeed(workspaceId: string, now: Date): Promise<MentionRowModel[]> {
  const { results } = await env.DB.prepare(MENTION_FEED_SQL).bind(workspaceId, D6_QUESTION_ID).all();
  return mentionsFromRows(z.array(mentionFeedSqlRow).parse(results).map(toReadRow), now);
}
