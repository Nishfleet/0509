import { z } from "zod";
import { parseLatest } from "./recap.server";
import { SENDABLE_SIGNALS } from "../customer-ready";

const SELECT_WINBACKS = `SELECT w.id AS workspace_id,
       p.provider_subscription_id AS subscription_id,
       st.id AS target_id,
       st.target_value,
       st.unsubscribe_token,
       w.last_seen_at,
       (SELECT count(*) FROM ${SENDABLE_SIGNALS} s
          JOIN entity e ON e.id = s.entity_id AND e.workspace_id = s.workspace_id AND e.role = 'competitor' AND e.state = 'on'
         WHERE s.workspace_id = w.id AND s.kind = 'change' AND s.is_tombstoned = 0 AND s.duplicate_of IS NULL
           AND s.observed_at > w.last_seen_at) AS change_count,
       (SELECT json_object(
                 'rival', COALESCE(NULLIF(e.name, ''), e.domain),
                 'what', COALESCE(NULLIF(s.title, ''), NULLIF(s.summary, '')))
          FROM ${SENDABLE_SIGNALS} s
          JOIN entity e ON e.id = s.entity_id AND e.workspace_id = s.workspace_id AND e.role = 'competitor' AND e.state = 'on'
         WHERE s.workspace_id = w.id AND s.kind = 'change' AND s.is_tombstoned = 0 AND s.duplicate_of IS NULL
           AND COALESCE(NULLIF(s.title, ''), NULLIF(s.summary, '')) IS NOT NULL
           AND s.observed_at > w.last_seen_at
         ORDER BY s.observed_at DESC
         LIMIT 1) AS latest
  FROM workspace w
  JOIN plan p ON p.workspace_id = w.id AND p.status = 'active' AND p.trialing = 0
  JOIN send_target st ON st.id = (
    SELECT t.id
      FROM send_target t
      JOIN channel c ON c.id = t.channel_id
     WHERE t.workspace_id = w.id AND c.key = 'email' AND c.is_enabled = 1 AND t.is_verified = 1 AND t.role = 'owner'
     ORDER BY t.created_at ASC
     LIMIT 1
  )
 WHERE w.last_seen_at IS NOT NULL AND w.last_seen_at <= ?1`;

const winbackRow = z.object({
  workspace_id: z.string(),
  subscription_id: z.string().nullable(),
  target_id: z.string(),
  target_value: z.string(),
  unsubscribe_token: z.string().nullable(),
  last_seen_at: z.string(),
  change_count: z.number(),
  latest: z.string().nullable().transform(parseLatest),
});

export type Winback = z.infer<typeof winbackRow>;

const DAY_MS = 86_400_000;
const AWAY_DAYS = 21;

export async function readWinbacks(db: D1Database, now: Date): Promise<Winback[]> {
  const cutoff = new Date(now.getTime() - AWAY_DAYS * DAY_MS).toISOString();
  const { results } = await db.prepare(SELECT_WINBACKS).bind(cutoff).all();
  const winbacks: Winback[] = [];
  for (const row of z.array(z.unknown()).parse(results)) {
    const parsed = winbackRow.safeParse(row);
    if (parsed.success) winbacks.push(parsed.data);
    else console.error(JSON.stringify({ event: "delivery.winback_row_skipped" }));
  }
  return winbacks;
}

export function winbackKey(winback: Pick<Winback, "workspace_id" | "last_seen_at">): string {
  return `winback:${winback.workspace_id}:${winback.last_seen_at}`;
}
