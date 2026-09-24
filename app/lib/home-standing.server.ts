import { z } from "zod";

import { readBriefPayload } from "./brief-payload";
import type { BriefPayload } from "./brief-payload";
import type { BriefSchedule } from "./brief-schedule";
import type { HomeEntity, HomeHistoryRow } from "./home-standing";

const SELECT_WORKSPACE = `SELECT id, timezone, brief_weekday, brief_hour
FROM workspace WHERE owner_user_id = ?1
ORDER BY created_at ASC
LIMIT 1`;

const SELECT_ENTITIES = `SELECT id, role, domain, state FROM entity WHERE workspace_id = ?1`;

const SELECT_LATEST_DIGEST = `SELECT payload_json FROM digest
WHERE workspace_id = ?1 AND kind = 'weekly'
ORDER BY period_end DESC
LIMIT 1`;

const SELECT_HISTORY = `SELECT entity_id, week_start_at, rank FROM standing WHERE workspace_id = ?1 AND rank IS NOT NULL AND week_start_at IN (SELECT DISTINCT week_start_at FROM standing WHERE workspace_id = ?1 AND rank IS NOT NULL ORDER BY week_start_at DESC LIMIT 4) ORDER BY week_start_at ASC`;

const workspaceRow = z.object({
  id: z.string(),
  timezone: z.string(),
  brief_weekday: z.number().int(),
  brief_hour: z.number().int(),
});

const entityRows = z.array(
  z.object({
    id: z.string(),
    role: z.enum(["self", "competitor"]),
    domain: z.string(),
    state: z.string(),
  }),
);

const digestRows = z.array(z.object({ payload_json: z.string() }));

const historyRows = z.array(
  z.object({ entity_id: z.string(), week_start_at: z.string(), rank: z.number().int() }),
);

export interface HomeStandingInputs {
  schedule: BriefSchedule;
  entities: readonly HomeEntity[];
  payload: BriefPayload | null;
  history: readonly HomeHistoryRow[];
}

export async function readHomeStandingInputs(
  db: D1Database,
  ownerUserId: string,
): Promise<HomeStandingInputs | null> {
  const found = await db.prepare(SELECT_WORKSPACE).bind(ownerUserId).first();
  if (found === null) return null;
  const workspace = workspaceRow.parse(found);
  const [entities, digests, history] = await db.batch([
    db.prepare(SELECT_ENTITIES).bind(workspace.id),
    db.prepare(SELECT_LATEST_DIGEST).bind(workspace.id),
    db.prepare(SELECT_HISTORY).bind(workspace.id),
  ]);
  const latest = digestRows.parse(digests.results)[0];
  return {
    schedule: { timezone: workspace.timezone, weekday: workspace.brief_weekday, hour: workspace.brief_hour },
    entities: entityRows.parse(entities.results),
    payload: latest === undefined ? null : readBriefPayload(latest.payload_json),
    history: historyRows.parse(history.results),
  };
}
