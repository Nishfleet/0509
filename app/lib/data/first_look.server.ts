import { env } from "cloudflare:workers";
import { z } from "zod";

import type { FirstLookRival } from "../first-look";
import { ALTERNATE_MARKER } from "./watch.server";

const SELECT_FIRST_LOOK = `SELECT e.id, COALESCE(NULLIF(e.name, ''), e.domain) AS name,
       COUNT(DISTINCT sn.page_id) AS pages,
       MAX(sn.fetched_at) AS checked_at,
       (EXISTS (SELECT 1 FROM page hp WHERE hp.entity_id = e.id AND hp.role = 'home' AND hp.deferred_at IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM watch aw WHERE aw.entity_id = e.id AND aw.is_active = 1 AND ${ALTERNATE_MARKER("aw")})) AS unreadable
  FROM entity e
  LEFT JOIN watch w ON w.entity_id = e.id AND w.is_active = 1
  LEFT JOIN snapshot sn ON sn.watch_id = w.id
 WHERE e.workspace_id = ?1 AND e.role = 'competitor' AND e.state = 'on'
 GROUP BY e.id
 ORDER BY e.created_at ASC, e.id ASC
 LIMIT 12`;

const firstLookRow = z.object({
  id: z.string(),
  name: z.string(),
  pages: z.number(),
  checked_at: z.string().nullable(),
  unreadable: z.number(),
});

export async function readFirstLook(workspaceId: string): Promise<FirstLookRival[]> {
  const { results } = await env.DB.prepare(SELECT_FIRST_LOOK).bind(workspaceId).all();
  return z
    .array(firstLookRow)
    .parse(results)
    .map((row) => ({
      id: row.id,
      name: row.name,
      pages: row.pages,
      checkedAt: row.checked_at,
      unreadable: row.unreadable === 1,
    }));
}
