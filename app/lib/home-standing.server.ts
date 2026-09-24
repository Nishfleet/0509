import { z } from "zod";

import { readBriefPayload } from "./brief-payload";
import type { BriefPayload } from "./brief-payload";
import type { BriefSchedule } from "./brief-schedule";
import type { HomeCount, HomeEntity, HomeSource } from "./home-standing";

const SELECT_WORKSPACE = `SELECT id, timezone, brief_weekday, brief_hour
FROM workspace WHERE owner_user_id = ?1
ORDER BY created_at ASC
LIMIT 1`;

const SELECT_ENTITIES = `SELECT id, role, domain, state FROM entity WHERE workspace_id = ?1`;

const SELECT_LATEST_DIGEST = `SELECT payload_json FROM digest
WHERE workspace_id = ?1 AND kind = 'weekly'
ORDER BY period_end DESC
LIMIT 1`;

const SELECT_SOURCES = `SELECT key, kind, platform FROM source WHERE is_enabled = 1 ORDER BY kind ASC, key ASC`;

const SELECT_COUNTS = `SELECT s.entity_id, src.key AS source_key, COUNT(*) AS n FROM signal s
JOIN source src ON src.id = s.source_id
WHERE s.workspace_id = ?1 AND s.is_tombstoned = 0
AND s.observed_at >= (SELECT json_extract(payload_json, '$.period_start') FROM digest
WHERE workspace_id = ?1 AND kind = 'weekly' ORDER BY period_end DESC LIMIT 1)
GROUP BY s.entity_id, src.key`;

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

const sourceRows = z.array(
  z.object({
    key: z.string(),
    kind: z.enum(["site", "ads", "mentions", "hiring"]),
    platform: z.string(),
  }),
);

const countRows = z.array(
  z.object({
    entity_id: z.string(),
    source_key: z.string(),
    n: z.number().int(),
  }),
);

export interface HomeStandingInputs {
  schedule: BriefSchedule;
  workspaceId: string;
  entities: readonly HomeEntity[];
  sources: readonly HomeSource[];
  counts: readonly HomeCount[];
  payload: BriefPayload | null;
}

export async function readHomeStandingInputs(
  db: D1Database,
  ownerUserId: string,
): Promise<HomeStandingInputs | null> {
  const found = await db.prepare(SELECT_WORKSPACE).bind(ownerUserId).first();
  if (found === null) return null;
  const workspace = workspaceRow.parse(found);
  const [entities, digests, sources, counts] = await db.batch([
    db.prepare(SELECT_ENTITIES).bind(workspace.id),
    db.prepare(SELECT_LATEST_DIGEST).bind(workspace.id),
    db.prepare(SELECT_SOURCES),
    db.prepare(SELECT_COUNTS).bind(workspace.id),
  ]);
  const latest = digestRows.parse(digests.results)[0];
  return {
    schedule: { timezone: workspace.timezone, weekday: workspace.brief_weekday, hour: workspace.brief_hour },
    workspaceId: workspace.id,
    entities: entityRows.parse(entities.results),
    sources: sourceRows.parse(sources.results),
    counts: countRows
      .parse(counts.results)
      .map((row) => ({ entityId: row.entity_id, sourceKey: row.source_key, count: row.n })),
    payload: latest === undefined ? null : readBriefPayload(latest.payload_json),
  };
}
