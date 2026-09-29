import { z } from "zod";

import { readBriefPayload } from "./brief-payload";
import type { BriefPayload } from "./brief-payload";
import type { BriefSchedule } from "./brief-schedule";
import type { HomeCount, HomeEntity, HomeHistoryRow, HomeSource } from "./home-standing";

const SELECT_HISTORY = `SELECT entity_id, week_start_at, rank FROM standing WHERE workspace_id = ?1 AND rank IS NOT NULL AND week_start_at IN (SELECT DISTINCT week_start_at FROM standing WHERE workspace_id = ?1 AND rank IS NOT NULL ORDER BY week_start_at DESC LIMIT 4) ORDER BY week_start_at ASC`;

const SELECT_HOME_SOURCES = `SELECT key, kind, platform FROM source WHERE is_enabled = 1 ORDER BY kind ASC, key ASC`;

const SELECT_HOME_COUNTS = `SELECT s.entity_id, src.key AS source_key, COUNT(*) AS n FROM signal s JOIN source src ON src.id = s.source_id WHERE s.workspace_id = ?1 AND s.is_tombstoned = 0 AND s.observed_at >= (SELECT json_extract(payload_json, '$.period_start') FROM digest WHERE workspace_id = ?1 AND kind = 'weekly' ORDER BY period_end DESC LIMIT 1) GROUP BY s.entity_id, src.key`;

export const SELECT_HOME_STANDING = `SELECT
  w.id AS workspace_id,
  w.timezone,
  w.brief_weekday,
  w.brief_hour,
  e.id AS entity_id,
  e.role,
  e.domain,
  COALESCE(e.name, e.domain) AS name,
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
  )
ORDER BY e.role DESC, e.created_at ASC`;

const homeRow = z.object({
  workspace_id: z.string(),
  timezone: z.string(),
  brief_weekday: z.number().int(),
  brief_hour: z.number().int(),
  entity_id: z.string().nullable(),
  role: z.enum(["self", "competitor"]).nullable(),
  domain: z.string().nullable(),
  name: z.string().nullable(),
  state: z.string().nullable(),
  payload_json: z.string().nullable(),
});

const homeRows = z.array(homeRow);

const historyRows = z.array(
  z.object({ entity_id: z.string(), week_start_at: z.string(), rank: z.number().int() }),
);

const sourceRows = z.array(z.object({ key: z.string(), kind: z.enum(["site", "ads", "mentions", "hiring"]), platform: z.string() }));

const countRows = z.array(z.object({ entity_id: z.string(), source_key: z.string(), n: z.number().int() }));

export interface HomeStandingInputs {
  schedule: BriefSchedule;
  entities: readonly HomeEntity[];
  payload: BriefPayload | null;
  history: readonly HomeHistoryRow[];
  sources: readonly HomeSource[];
  counts: readonly HomeCount[];
}

function entityFrom(row: z.infer<typeof homeRow>): HomeEntity | null {
  if (
    row.entity_id === null ||
    row.role === null ||
    row.domain === null ||
    row.name === null ||
    row.state === null
  ) {
    return null;
  }
  return { id: row.entity_id, role: row.role, domain: row.domain, name: row.name, state: row.state };
}

export async function readHomeStandingInputs(
  db: D1Database,
  ownerUserId: string,
): Promise<HomeStandingInputs | null> {
  const rows = homeRows.parse((await db.prepare(SELECT_HOME_STANDING).bind(ownerUserId).all()).results);
  const first = rows[0];
  if (first === undefined) return null;
  const [historyResult, sourcesResult, countsResult] = await db.batch([
    db.prepare(SELECT_HISTORY).bind(first.workspace_id),
    db.prepare(SELECT_HOME_SOURCES),
    db.prepare(SELECT_HOME_COUNTS).bind(first.workspace_id),
  ]);
  const history = historyRows.parse(historyResult?.results);
  const sources = sourceRows.parse(sourcesResult?.results);
  const counts = countRows.parse(countsResult?.results).map((row) => ({ entityId: row.entity_id, sourceKey: row.source_key, count: row.n }));
  return {
    schedule: { timezone: first.timezone, weekday: first.brief_weekday, hour: first.brief_hour },
    entities: rows.flatMap((row) => {
      const entity = entityFrom(row);
      return entity === null ? [] : [entity];
    }),
    payload: first.payload_json === null ? null : readBriefPayload(first.payload_json),
    history,
    sources,
    counts,
  };
}
