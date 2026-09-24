import { z } from "zod";

import { readBriefPayload } from "./brief-payload";
import type { BriefPayload } from "./brief-payload";
import type { BriefSchedule } from "./brief-schedule";
import type { HomeEntity } from "./home-standing";

export const SELECT_HOME_STANDING = `SELECT
  w.id AS workspace_id,
  w.timezone,
  w.brief_weekday,
  w.brief_hour,
  e.id AS entity_id,
  e.role,
  e.domain,
  e.state,
  (
    SELECT d.payload_json
    FROM digest d
    WHERE d.workspace_id = w.id AND d.kind = 'weekly'
    ORDER BY d.period_end DESC
    LIMIT 1
  ) AS payload_json
FROM workspace w
LEFT JOIN entity e ON e.workspace_id = w.id
WHERE w.owner_user_id = ?1
  AND w.id = (
    SELECT id FROM workspace
    WHERE owner_user_id = ?1
    ORDER BY created_at ASC
    LIMIT 1
  )`;

const homeRow = z.object({
  workspace_id: z.string(),
  timezone: z.string(),
  brief_weekday: z.number().int(),
  brief_hour: z.number().int(),
  entity_id: z.string().nullable(),
  role: z.enum(["self", "competitor"]).nullable(),
  domain: z.string().nullable(),
  state: z.string().nullable(),
  payload_json: z.string().nullable(),
});

const homeRows = z.array(homeRow);

export interface HomeStandingInputs {
  schedule: BriefSchedule;
  entities: readonly HomeEntity[];
  payload: BriefPayload | null;
}

function entityFrom(row: z.infer<typeof homeRow>): HomeEntity | null {
  if (row.entity_id === null || row.role === null || row.domain === null || row.state === null) {
    return null;
  }
  return { id: row.entity_id, role: row.role, domain: row.domain, state: row.state };
}

export async function readHomeStandingInputs(
  db: D1Database,
  ownerUserId: string,
): Promise<HomeStandingInputs | null> {
  const rows = homeRows.parse((await db.prepare(SELECT_HOME_STANDING).bind(ownerUserId).all()).results);
  const first = rows[0];
  if (first === undefined) return null;
  return {
    schedule: { timezone: first.timezone, weekday: first.brief_weekday, hour: first.brief_hour },
    entities: rows.flatMap((row) => {
      const entity = entityFrom(row);
      return entity === null ? [] : [entity];
    }),
    payload: first.payload_json === null ? null : readBriefPayload(first.payload_json),
  };
}
