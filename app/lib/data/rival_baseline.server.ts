import { z } from "zod";

import { feedFactsFrom, SELECT_FEED_SNAPSHOTS } from "../feeds/feed-facts.server";
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
WHERE s.workspace_id = ?1 AND s.kind = 'change' AND s.is_tombstoned = 0 AND s.duplicate_of IS NULL AND s.observed_at < ?3
GROUP BY s.entity_id`;

const SELECT_ROLES = `SELECT DISTINCT p.entity_id AS entity_id, p.role AS role
FROM page p
JOIN entity e ON e.id = p.entity_id AND e.workspace_id = ?1 AND e.role = 'competitor' AND e.state = 'on'
WHERE p.role IN ('pricing', 'product', 'blog', 'careers')`;

const SELECT_ALL_FACTS = `SELECT 'kind' AS section, entity_id, kind AS c1, title AS c2, at AS c3, n AS c4 FROM (${SELECT_KIND_FACTS})
UNION ALL SELECT 'site', entity_id, description, pages, reads, first_read_at FROM (${SELECT_SITE_FACTS})
UNION ALL SELECT 'change', entity_id, changes, last_change_at, NULL, NULL FROM (${SELECT_CHANGE_FACTS})
UNION ALL SELECT 'role', entity_id, role, NULL, NULL, NULL FROM (${SELECT_ROLES})
UNION ALL SELECT 'feed', entity_id, item_count, r2_key, NULL, NULL FROM (${SELECT_FEED_SNAPSHOTS})`;

const factRow = z.discriminatedUnion("section", [
  z.object({
    section: z.literal("kind"),
    entity_id: z.string(),
    c1: z.string(),
    c2: z.string().nullable(),
    c3: z.string(),
    c4: z.number().int(),
  }),
  z.object({
    section: z.literal("site"),
    entity_id: z.string(),
    c1: z.string().nullable(),
    c2: z.number().int(),
    c3: z.number().int(),
    c4: z.string().nullable(),
  }),
  z.object({
    section: z.literal("change"),
    entity_id: z.string(),
    c1: z.number().int(),
    c2: z.string().nullable(),
  }),
  z.object({ section: z.literal("role"), entity_id: z.string(), c1: z.string() }),
  z.object({
    section: z.literal("feed"),
    entity_id: z.string(),
    c1: z.number().int(),
    c2: z.string().nullable(),
  }),
]);

type FactRow = z.infer<typeof factRow>;
type Section<K extends FactRow["section"]> = Extract<FactRow, { section: K }>;

function ofSection<K extends FactRow["section"]>(rows: readonly FactRow[], section: K): Section<K>[] {
  return rows.filter((row): row is Section<K> => row.section === section);
}

function groupBy<T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) grouped.set(keyOf(row), [...(grouped.get(keyOf(row)) ?? []), row]);
  return grouped;
}

export async function readRivalFacts(db: D1Database, workspaceId: string, now: Date): Promise<Map<string, RivalFacts>> {
  const since = new Date(now.getTime() - BASELINE_DAYS * DAY_MS).toISOString();
  const until = now.toISOString();
  const { results } = await db.prepare(SELECT_ALL_FACTS).bind(workspaceId, since, until).all();
  const rows = z.array(factRow).parse(results);
  const kinds = groupBy(ofSection(rows, "kind"), (row) => row.entity_id);
  const changes = new Map(ofSection(rows, "change").map((row) => [row.entity_id, row]));
  const roles = groupBy(ofSection(rows, "role"), (row) => row.entity_id);
  const feeds = await feedFactsFrom(
    ofSection(rows, "feed").map((row) => ({ entity_id: row.entity_id, item_count: row.c1, r2_key: row.c2 })),
  );
  return new Map(
    ofSection(rows, "site").map((row) => [
      row.entity_id,
      {
        description: row.c1,
        pages: row.c2,
        reads: row.c3,
        firstReadAt: row.c4,
        changes: changes.get(row.entity_id)?.c1 ?? 0,
        lastChangeAt: changes.get(row.entity_id)?.c2 ?? null,
        roles: (roles.get(row.entity_id) ?? []).map((role) => role.c1),
        kinds: (kinds.get(row.entity_id) ?? []).map((found): BaselineKind => ({
          kind: found.c1,
          count: found.c4,
          latestTitle: found.c2,
          latestAt: found.c3,
        })),
        feed: feeds.get(row.entity_id) ?? null,
      },
    ]),
  );
}
