import { z } from "zod";

import { readFeedFacts } from "../feeds/feed-facts.server";
import { BASELINE_DAYS, type BaselineKind, type RivalFacts } from "../rival-baseline";

const DAY_MS = 86_400_000;

const SELECT_KIND_FACTS = `SELECT entity_id, kind, title, at, n FROM (
  SELECT s.entity_id AS entity_id, s.kind AS kind, s.title AS title,
         COALESCE(s.published_at, s.observed_at) AS at,
         COUNT(*) OVER (PARTITION BY s.entity_id, s.kind) AS n,
         ROW_NUMBER() OVER (PARTITION BY s.entity_id, s.kind ORDER BY COALESCE(s.published_at, s.observed_at) DESC, s.id) AS rn
  FROM signal s
  JOIN entity e ON e.id = s.entity_id AND e.workspace_id = ?1 AND e.role = 'competitor' AND e.state = 'on'
  WHERE s.workspace_id = ?1 AND s.kind IN ('content', 'hiring', 'mention')
    AND COALESCE(s.published_at, s.observed_at) >= ?2 AND COALESCE(s.published_at, s.observed_at) < ?3
    AND s.is_tombstoned = 0 AND s.duplicate_of IS NULL AND (s.state IS NULL OR s.state <> 'unjudged')
) WHERE rn = 1`;

const SELECT_SITE_FACTS = `SELECT e.id AS entity_id, json_extract(e.identity_json, '$.description') AS description,
       COUNT(DISTINCT sn.page_id) AS pages, COUNT(sn.id) AS reads, MIN(sn.fetched_at) AS first_read_at
FROM entity e
LEFT JOIN watch w ON w.entity_id = e.id AND w.is_active = 1 AND w.source_id IN (SELECT id FROM source WHERE key = 'site.web')
LEFT JOIN snapshot sn ON sn.watch_id = w.id
WHERE e.workspace_id = ?1 AND e.role = 'competitor' AND e.state = 'on'
GROUP BY e.id`;

const SELECT_CHANGE_FACTS = `SELECT s.entity_id AS entity_id, COUNT(*) AS changes, MAX(s.observed_at) AS last_change_at
FROM signal s
JOIN entity e ON e.id = s.entity_id AND e.workspace_id = ?1 AND e.role = 'competitor' AND e.state = 'on'
WHERE s.workspace_id = ?1 AND s.kind = 'change' AND s.is_tombstoned = 0 AND s.duplicate_of IS NULL AND s.observed_at < ?2
GROUP BY s.entity_id`;

const SELECT_ROLES = `SELECT DISTINCT p.entity_id AS entity_id, p.role AS role
FROM page p
JOIN entity e ON e.id = p.entity_id AND e.workspace_id = ?1 AND e.role = 'competitor' AND e.state = 'on'
WHERE p.role IN ('pricing', 'product', 'blog', 'careers')`;

const kindFactRows = z.array(
  z.object({
    entity_id: z.string(),
    kind: z.string(),
    title: z.string().nullable(),
    at: z.string(),
    n: z.number().int(),
  }),
);

const siteFactRows = z.array(
  z.object({
    entity_id: z.string(),
    description: z.string().nullable(),
    pages: z.number().int(),
    reads: z.number().int(),
    first_read_at: z.string().nullable(),
  }),
);

const changeFactRows = z.array(
  z.object({ entity_id: z.string(), changes: z.number().int(), last_change_at: z.string().nullable() }),
);

const roleRows = z.array(z.object({ entity_id: z.string(), role: z.string() }));

function groupBy<T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) grouped.set(keyOf(row), [...(grouped.get(keyOf(row)) ?? []), row]);
  return grouped;
}

export async function readRivalFacts(db: D1Database, workspaceId: string, now: Date): Promise<Map<string, RivalFacts>> {
  const since = new Date(now.getTime() - BASELINE_DAYS * DAY_MS).toISOString();
  const until = now.toISOString();
  const [kindResult, siteResult, changeResult, roleResult] = await db.batch([
    db.prepare(SELECT_KIND_FACTS).bind(workspaceId, since, until),
    db.prepare(SELECT_SITE_FACTS).bind(workspaceId),
    db.prepare(SELECT_CHANGE_FACTS).bind(workspaceId, until),
    db.prepare(SELECT_ROLES).bind(workspaceId),
  ]);
  const kinds = groupBy(kindFactRows.parse(kindResult?.results), (row) => row.entity_id);
  const changes = new Map(changeFactRows.parse(changeResult?.results).map((row) => [row.entity_id, row]));
  const roles = groupBy(roleRows.parse(roleResult?.results), (row) => row.entity_id);
  const feeds = await readFeedFacts(db, workspaceId);
  return new Map(
    siteFactRows.parse(siteResult?.results).map((row) => [
      row.entity_id,
      {
        description: row.description,
        pages: row.pages,
        reads: row.reads,
        firstReadAt: row.first_read_at,
        changes: changes.get(row.entity_id)?.changes ?? 0,
        lastChangeAt: changes.get(row.entity_id)?.last_change_at ?? null,
        roles: (roles.get(row.entity_id) ?? []).map((role) => role.role),
        kinds: (kinds.get(row.entity_id) ?? []).map((found): BaselineKind => ({
          kind: found.kind,
          count: found.n,
          latestTitle: found.title,
          latestAt: found.at,
        })),
        feed: feeds.get(row.entity_id) ?? null,
      },
    ]),
  );
}
