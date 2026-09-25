import { z } from "zod";

import type { FreshnessSource } from "../components/freshness-line";
import { readBriefPayload } from "./brief-payload";
import type { BriefPayload } from "./brief-payload";
import type { BriefSchedule } from "./brief-schedule";
import type { HomeCount, HomeEntity, HomeHistoryRow, HomeSource } from "./home-standing";

const SELECT_HISTORY = `SELECT entity_id, week_start_at, rank FROM standing WHERE workspace_id = ?1 AND rank IS NOT NULL AND week_start_at IN (SELECT DISTINCT week_start_at FROM standing WHERE workspace_id = ?1 AND rank IS NOT NULL ORDER BY week_start_at DESC LIMIT 4) ORDER BY week_start_at ASC`;

const SELECT_HOME_SOURCES = `SELECT key, kind, platform FROM source WHERE is_enabled = 1 ORDER BY kind ASC, key ASC`;

const SELECT_HOME_COUNTS = `SELECT s.entity_id, src.key AS source_key, COUNT(*) AS n FROM signal s JOIN source src ON src.id = s.source_id WHERE s.workspace_id = ?1 AND s.is_tombstoned = 0 AND s.observed_at >= (SELECT json_extract(payload_json, '$.period_start') FROM digest WHERE workspace_id = ?1 AND kind = 'weekly' ORDER BY period_end DESC LIMIT 1) GROUP BY s.entity_id, src.key`;

const SELECT_HOME_FRESHNESS = `SELECT src.key AS key, src.kind AS kind, src.platform AS platform, src.is_enabled AS is_enabled, src.config_json AS config_json, src.degraded_reason AS degraded_reason, src.last_good_at AS last_good_at, w.config_json AS watch_config_json, MAX(sn.fetched_at) AS fetched_at, sn.item_count AS item_count, sn.canary_count AS canary_count
FROM watch w
JOIN entity e ON e.id = w.entity_id AND e.workspace_id = ?1 AND e.state = 'on'
JOIN source src ON src.id = w.source_id
LEFT JOIN snapshot sn ON sn.watch_id = w.id
WHERE w.is_active = 1
GROUP BY src.id
ORDER BY src.key`;

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

const freshnessRows = z.array(
  z.object({
    key: z.string(),
    kind: z.string(),
    platform: z.string(),
    is_enabled: z.number().int(),
    config_json: z.string(),
    degraded_reason: z.string().nullable(),
    last_good_at: z.string().nullable(),
    watch_config_json: z.string().nullable(),
    fetched_at: z.string().nullable(),
    item_count: z.number().int().nullable(),
    canary_count: z.number().int().nullable(),
  }),
);

export interface HomeStandingInputs {
  schedule: BriefSchedule;
  entities: readonly HomeEntity[];
  payload: BriefPayload | null;
  history: readonly HomeHistoryRow[];
  sources: readonly HomeSource[];
  freshnessSources: readonly FreshnessSource[];
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
  const [historyResult, sourcesResult, countsResult, freshnessResult] = await db.batch([
    db.prepare(SELECT_HISTORY).bind(first.workspace_id),
    db.prepare(SELECT_HOME_SOURCES),
    db.prepare(SELECT_HOME_COUNTS).bind(first.workspace_id),
    db.prepare(SELECT_HOME_FRESHNESS).bind(first.workspace_id),
  ]);
  const history = historyRows.parse(historyResult?.results);
  const sources = sourceRows.parse(sourcesResult?.results);
  const counts = countRows.parse(countsResult?.results).map((row) => ({ entityId: row.entity_id, sourceKey: row.source_key, count: row.n }));
  const freshnessSources = freshnessRows.parse(freshnessResult?.results).map((row) => ({
    kind: row.kind,
    source: {
      key: row.key,
      platform: row.platform,
      is_enabled: row.is_enabled,
      config_json: row.config_json,
      degraded_reason: row.degraded_reason,
      last_good_at: row.last_good_at,
      watch_config_json: row.watch_config_json,
    },
    snapshot:
      row.fetched_at === null
        ? null
        : {
            fetched_at: row.fetched_at,
            item_count: row.item_count ?? 0,
            canary_count: row.canary_count,
          },
  }));
  return {
    schedule: { timezone: first.timezone, weekday: first.brief_weekday, hour: first.brief_hour },
    entities: rows.flatMap((row) => {
      const entity = entityFrom(row);
      return entity === null ? [] : [entity];
    }),
    payload: first.payload_json === null ? null : readBriefPayload(first.payload_json),
    history,
    sources,
    freshnessSources,
    counts,
  };
}
