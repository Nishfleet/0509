import { z } from "zod";

import { TRIAL_DAYS } from "../billing/plans";

import { liveWorkspace } from "./active-workspace";

const SELECT_NEW_TRIALS = `SELECT p.workspace_id,
       p.provider_subscription_id AS subscription_id,
       w.timezone,
       w.brief_weekday,
       w.brief_hour,
       st.id AS target_id,
       st.target_value,
       (SELECT count(*) FROM entity e WHERE e.workspace_id = p.workspace_id AND e.role = 'competitor' AND e.state = 'on') AS rival_count,
       (SELECT json_group_array(n.name) FROM (
          SELECT COALESCE(NULLIF(e.name, ''), e.domain) AS name
            FROM entity e
           WHERE e.workspace_id = p.workspace_id AND e.role = 'competitor' AND e.state = 'on'
           ORDER BY e.created_at ASC
           LIMIT 3) n) AS rival_names
  FROM plan p
  JOIN workspace w ON w.id = p.workspace_id
  JOIN send_target st ON st.id = (
    SELECT t.id
      FROM send_target t
      JOIN channel c ON c.id = t.channel_id
     WHERE t.workspace_id = p.workspace_id AND c.key = 'email' AND c.is_enabled = 1 AND t.is_verified = 1 AND t.role = 'owner'
     ORDER BY t.created_at ASC
     LIMIT 1
  )
 WHERE p.trialing = 1 AND p.status = 'active' AND p.current_period_end >= ?1
   AND ${liveWorkspace("p.workspace_id")}`;

const newTrialRow = z.object({
  workspace_id: z.string(),
  subscription_id: z.string().nullable(),
  timezone: z.string(),
  brief_weekday: z.number(),
  brief_hour: z.number(),
  target_id: z.string(),
  target_value: z.string(),
  rival_count: z.number(),
  rival_names: z
    .string()
    .nullable()
    .transform((json) => (json === null ? [] : z.array(z.string()).parse(JSON.parse(json)))),
});

export type NewTrial = z.infer<typeof newTrialRow>;

const DAY_MS = 86_400_000;
const WELCOME_WINDOW_DAYS = 2;

export async function readNewTrials(db: D1Database, now: Date): Promise<NewTrial[]> {
  const since = new Date(now.getTime() + (TRIAL_DAYS - WELCOME_WINDOW_DAYS) * DAY_MS);
  const { results } = await db.prepare(SELECT_NEW_TRIALS).bind(since.toISOString()).all();
  const trials: NewTrial[] = [];
  for (const row of z.array(z.unknown()).parse(results)) {
    const parsed = newTrialRow.safeParse(row);
    if (parsed.success) trials.push(parsed.data);
    else console.error(JSON.stringify({ event: "billing.welcome_row_skipped" }));
  }
  return trials;
}

export function welcomeKey(trial: Pick<NewTrial, "workspace_id">): string {
  return `welcome:${trial.workspace_id}`;
}
