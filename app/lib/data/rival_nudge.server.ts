import { z } from "zod";

import { TRIAL_DAYS } from "../billing/plans";
import { NUDGE_AFTER_DAYS, NUDGE_MAX_RIVALS, NUDGE_WITHIN_DAYS } from "../rival-nudge";

import { RECAP_DAY } from "./recap.server";

const RIVAL_COUNT = `(SELECT count(*) FROM entity e WHERE e.workspace_id = w.id AND e.role = 'competitor' AND e.state = 'on')`;

const SELECT_FEW_RIVALS = `SELECT ${RIVAL_COUNT} AS rivals, w.created_at FROM workspace w WHERE w.id = ?1`;

const SELECT_NUDGES = `SELECT w.id AS workspace_id,
       p.provider_subscription_id AS subscription_id,
       st.id AS target_id,
       st.target_value,
       st.unsubscribe_token,
       ${RIVAL_COUNT} AS rivals,
       (SELECT COALESCE(NULLIF(e.name, ''), e.domain) FROM entity e
         WHERE e.workspace_id = w.id AND e.role = 'competitor' AND e.state = 'on'
         ORDER BY e.created_at ASC LIMIT 1) AS rival_name
  FROM workspace w
  JOIN plan p ON p.workspace_id = w.id AND p.status = 'active'
  JOIN send_target st ON st.id = (
    SELECT t.id
      FROM send_target t
      JOIN channel c ON c.id = t.channel_id
     WHERE t.workspace_id = w.id AND c.key = 'email' AND c.is_enabled = 1 AND t.is_verified = 1 AND t.role = 'owner'
     ORDER BY t.created_at ASC
     LIMIT 1
  )
 WHERE w.created_at <= ?1 AND w.created_at > ?2 AND ${RIVAL_COUNT} < ?3
   AND NOT (p.trialing = 1 AND p.current_period_end > ?4 AND p.current_period_end <= ?5)`;

const fewRow = z.object({ rivals: z.number(), created_at: z.string() });

const nudgeRow = z.object({
  workspace_id: z.string(),
  subscription_id: z.string().nullable(),
  target_id: z.string(),
  target_value: z.string(),
  unsubscribe_token: z.string().nullable(),
  rivals: z.number(),
  rival_name: z.string().nullable(),
});

export type RivalNudge = z.infer<typeof nudgeRow>;

const DAY_MS = 86_400_000;

function daysBefore(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

export async function readFewRivals(db: D1Database, workspaceId: string, now: Date): Promise<number | null> {
  const row = fewRow.nullable().parse(await db.prepare(SELECT_FEW_RIVALS).bind(workspaceId).first());
  if (row === null || row.rivals >= NUDGE_MAX_RIVALS) return null;
  return row.created_at <= daysBefore(now, NUDGE_AFTER_DAYS) ? row.rivals : null;
}

export async function readRivalNudges(db: D1Database, now: Date): Promise<RivalNudge[]> {
  const { results } = await db
    .prepare(SELECT_NUDGES)
    .bind(
      daysBefore(now, NUDGE_AFTER_DAYS),
      daysBefore(now, NUDGE_WITHIN_DAYS),
      NUDGE_MAX_RIVALS,
      daysBefore(now, RECAP_DAY + 1 - TRIAL_DAYS),
      daysBefore(now, RECAP_DAY - 1 - TRIAL_DAYS),
    )
    .all();
  const nudges: RivalNudge[] = [];
  for (const row of z.array(z.unknown()).parse(results)) {
    const parsed = nudgeRow.safeParse(row);
    if (parsed.success) nudges.push(parsed.data);
    else console.error(JSON.stringify({ event: "delivery.rival_nudge_row_skipped" }));
  }
  return nudges;
}

export function rivalNudgeKey(nudge: Pick<RivalNudge, "workspace_id">): string {
  return `rivalnudge:${nudge.workspace_id}`;
}
