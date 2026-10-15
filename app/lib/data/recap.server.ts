import { z } from "zod";

import { TRIAL_DAYS } from "../billing/plans";
import { baselineLines } from "../rival-baseline";

import { readRivalFacts } from "./rival_baseline.server";

const SELECT_RECAPS = `SELECT p.workspace_id,
       p.provider_subscription_id AS subscription_id,
       st.id AS target_id,
       st.target_value,
       st.unsubscribe_token,
       COALESCE((SELECT w.timezone FROM workspace w WHERE w.id = p.workspace_id), 'UTC') AS timezone,
       (SELECT count(*) FROM signal s
          JOIN entity e ON e.id = s.entity_id AND e.workspace_id = s.workspace_id AND e.role = 'competitor' AND e.state = 'on'
         WHERE s.workspace_id = p.workspace_id AND s.kind = 'change' AND s.is_tombstoned = 0 AND s.duplicate_of IS NULL
           AND s.observed_at >= strftime('%Y-%m-%dT%H:%M:%SZ', p.current_period_end, '-' || ?3 || ' days')) AS change_count,
       (SELECT json_object(
                 'rival', COALESCE(NULLIF(e.name, ''), e.domain),
                 'what', COALESCE(NULLIF(s.title, ''), NULLIF(s.summary, '')))
          FROM signal s
          JOIN entity e ON e.id = s.entity_id AND e.workspace_id = s.workspace_id AND e.role = 'competitor' AND e.state = 'on'
         WHERE s.workspace_id = p.workspace_id AND s.kind = 'change' AND s.is_tombstoned = 0 AND s.duplicate_of IS NULL
           AND COALESCE(NULLIF(s.title, ''), NULLIF(s.summary, '')) IS NOT NULL
           AND s.observed_at >= strftime('%Y-%m-%dT%H:%M:%SZ', p.current_period_end, '-' || ?3 || ' days')
         ORDER BY s.observed_at DESC
         LIMIT 1) AS latest
  FROM plan p
  JOIN send_target st ON st.id = (
    SELECT t.id
      FROM send_target t
      JOIN channel c ON c.id = t.channel_id
     WHERE t.workspace_id = p.workspace_id AND c.key = 'email' AND c.is_enabled = 1 AND t.is_verified = 1 AND t.role = 'owner'
     ORDER BY t.created_at ASC
     LIMIT 1
  )
 WHERE p.trialing = 1 AND p.status = 'active' AND p.current_period_end > ?1 AND p.current_period_end <= ?2`;

const latestMove = z.object({ rival: z.string(), what: z.string() });

export function parseLatest(json: string | null, ctx: z.RefinementCtx): z.infer<typeof latestMove> | null {
  if (json === null) return null;
  try {
    const parsed = latestMove.safeParse(JSON.parse(json));
    if (parsed.success) return parsed.data;
  } catch {
    ctx.addIssue({ code: "custom", message: "latest is not JSON" });
    return z.NEVER;
  }
  ctx.addIssue({ code: "custom", message: "latest has no name or title" });
  return z.NEVER;
}

const recapRow = z.object({
  workspace_id: z.string(),
  subscription_id: z.string().nullable(),
  target_id: z.string(),
  target_value: z.string(),
  unsubscribe_token: z.string().nullable(),
  timezone: z.string(),
  change_count: z.number(),
  latest: z.string().nullable().transform(parseLatest),
});

export interface RivalStanding {
  rival: string;
  lines: string[];
}

export type TrialRecap = z.infer<typeof recapRow> & { standing: RivalStanding[] };

const MAX_STANDINGS = 3;

const SELECT_RIVAL_NAMES = `SELECT id, COALESCE(NULLIF(name, ''), domain) AS rival
  FROM entity
 WHERE workspace_id = ? AND role = 'competitor' AND state = 'on'
 ORDER BY created_at, id`;

const rivalNameRows = z.array(z.object({ id: z.string(), rival: z.string() }));

async function readRivalStandings(
  db: D1Database,
  input: { workspaceId: string; timezone: string; now: Date },
): Promise<RivalStanding[]> {
  const [facts, names] = await Promise.all([
    readRivalFacts(db, input.workspaceId, input.now),
    db.prepare(SELECT_RIVAL_NAMES).bind(input.workspaceId).all(),
  ]);
  return rivalNameRows
    .parse(names.results)
    .flatMap((row) => {
      const found = facts.get(row.id);
      const lines = found === undefined ? [] : baselineLines(found, input.timezone);
      return lines.length === 0 ? [] : [{ rival: row.rival, lines }];
    })
    .slice(0, MAX_STANDINGS);
}

const DAY_MS = 86_400_000;
export const RECAP_DAY = 4;

export async function readTrialRecaps(db: D1Database, now: Date): Promise<TrialRecap[]> {
  const from = new Date(now.getTime() + (TRIAL_DAYS - RECAP_DAY - 1) * DAY_MS);
  const to = new Date(now.getTime() + (TRIAL_DAYS - RECAP_DAY) * DAY_MS);
  const { results } = await db.prepare(SELECT_RECAPS).bind(from.toISOString(), to.toISOString(), TRIAL_DAYS).all();
  const recaps: TrialRecap[] = [];
  for (const row of z.array(z.unknown()).parse(results)) {
    const parsed = recapRow.safeParse(row);
    if (parsed.success) {
      const standing =
        parsed.data.change_count === 0
          ? await readRivalStandings(db, { workspaceId: parsed.data.workspace_id, timezone: parsed.data.timezone, now })
          : [];
      recaps.push({ ...parsed.data, standing });
    } else console.error(JSON.stringify({ event: "billing.recap_row_skipped" }));
  }
  return recaps;
}

export function recapKey(recap: Pick<TrialRecap, "workspace_id">): string {
  return `recap:${recap.workspace_id}`;
}
