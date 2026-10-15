import { z } from "zod";

import { changeActsSql } from "../jev/thresholds";
import type { WorkLedger } from "../work-ledger";

const CHANGE_ACTS = `EXISTS (SELECT 1 FROM jev_verdict v WHERE v.signal_id = s.id AND v.question_id = 'noteworthy_change' AND ${changeActsSql("s", "v")})`;
const CHANGE_JUDGED = `EXISTS (SELECT 1 FROM jev_verdict v WHERE v.signal_id = s.id AND v.question_id = 'noteworthy_change')`;

const SELECT_PAGES = `SELECT COUNT(DISTINCT CASE WHEN sn.id IS NOT NULL THEN e.id END) AS rivals, COUNT(DISTINCT sn.page_id) AS pages
FROM entity e
LEFT JOIN watch w ON w.entity_id = e.id
LEFT JOIN snapshot sn ON sn.watch_id = w.id AND sn.page_id IS NOT NULL AND sn.fetched_at >= ?2 AND sn.fetched_at < ?3
WHERE e.workspace_id = ?1 AND e.role = 'competitor' AND e.state = 'on'`;

const SELECT_SIGNALS = `SELECT
  SUM(CASE WHEN s.kind = 'change' THEN 1 ELSE 0 END) AS changes_seen,
  SUM(CASE WHEN s.kind = 'change' AND ${CHANGE_ACTS} THEN 1 ELSE 0 END) AS changes_told,
  SUM(CASE WHEN s.kind = 'change' AND ${CHANGE_JUDGED} AND NOT ${CHANGE_ACTS} THEN 1 ELSE 0 END) AS changes_set_aside,
  SUM(CASE WHEN s.kind = 'mention' AND (s.state IS NULL OR s.state <> 'unjudged') THEN 1 ELSE 0 END) AS mentions_read,
  SUM(CASE WHEN s.kind = 'mention' AND s.is_tombstoned = 0 AND (s.state IS NULL OR s.state <> 'unjudged') THEN 1 ELSE 0 END) AS mentions_kept
FROM signal s
JOIN entity e ON e.id = s.entity_id AND e.workspace_id = ?1 AND e.role = 'competitor' AND e.state = 'on'
WHERE s.workspace_id = ?1 AND s.kind IN ('change', 'mention') AND s.observed_at >= ?2 AND s.observed_at < ?3
  AND s.duplicate_of IS NULL AND (s.kind = 'mention' OR s.is_tombstoned = 0)`;

const pageRows = z.tuple([z.object({ rivals: z.number().int(), pages: z.number().int() })]);

const count = z
  .number()
  .int()
  .nullable()
  .transform((value) => value ?? 0);

const signalRows = z.tuple([
  z.object({
    changes_seen: count,
    changes_told: count,
    changes_set_aside: count,
    mentions_read: count,
    mentions_kept: count,
  }),
]);

export async function readWorkLedger(
  db: D1Database,
  input: { workspaceId: string; from: string; until: string },
): Promise<WorkLedger> {
  const { workspaceId, from, until } = input;
  const [pageResult, signalResult] = await db.batch([
    db.prepare(SELECT_PAGES).bind(workspaceId, from, until),
    db.prepare(SELECT_SIGNALS).bind(workspaceId, from, until),
  ]);
  const [pages] = pageRows.parse(pageResult?.results);
  const [signals] = signalRows.parse(signalResult?.results);
  return { rivals: pages.rivals, pages_read: pages.pages, ...signals };
}
