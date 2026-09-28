import { env } from "cloudflare:workers";
import { z } from "zod";

import type { SnapshotInput } from "./competitor-snapshot";
import { daysBefore } from "./site-changes.server";
import { D3_QUESTION_ID, D6_QUESTION_ID } from "./standing-score";
import { sourceName } from "./source-name";

const SELECT_COMPETITOR_COUNTS = `SELECT
  COALESCE(SUM(CASE WHEN s.kind = 'ad' AND s.aspect IS NULL AND s.published_at >= ?3 AND s.published_at < ?4 THEN 1 ELSE 0 END), 0) AS new_creatives,
  COALESCE(SUM(CASE WHEN s.kind = 'ad' AND s.aspect IS NOT NULL THEN 1 ELSE 0 END), 0) AS copy_changes,
  COALESCE(SUM(CASE WHEN s.kind = 'change' AND v.p >= 0.9 THEN 1 ELSE 0 END), 0) AS site_changes,
  COALESCE(SUM(CASE WHEN s.kind = 'mention' AND v.p >= 0.9 THEN 1 ELSE 0 END), 0) AS mentions,
  COALESCE(SUM(CASE WHEN s.kind = 'hiring' THEN 1 ELSE 0 END), 0) AS new_roles
FROM signal s
LEFT JOIN jev_verdict v ON v.signal_id = s.id
  AND v.question_id = CASE s.kind WHEN 'mention' THEN ?5 WHEN 'change' THEN ?6 END
WHERE s.workspace_id = ?1 AND s.entity_id = ?2
  AND s.observed_at >= ?3 AND s.observed_at < ?4 AND s.is_tombstoned = 0`;

const SELECT_COMPETITOR_STANDING = `SELECT rank, movement FROM standing
WHERE workspace_id = ?1 AND entity_id = ?2 AND rank IS NOT NULL
ORDER BY week_start_at DESC LIMIT 1`;

const SELECT_COMPETITOR_COVERAGE = `SELECT src.key AS key, src.kind AS kind, src.platform AS platform,
  MAX(CASE WHEN sn.fetched_at >= ?3 AND sn.fetched_at < ?4 THEN 1 ELSE 0 END) AS answered
FROM watch w
JOIN entity e ON e.id = w.entity_id AND e.workspace_id = ?1
JOIN source src ON src.id = w.source_id AND src.is_enabled = 1
LEFT JOIN snapshot sn ON sn.watch_id = w.id
WHERE w.entity_id = ?2 AND w.is_active = 1
GROUP BY src.key, src.kind, src.platform
ORDER BY src.key`;

const countRow = z.object({
  new_creatives: z.number(),
  copy_changes: z.number(),
  site_changes: z.number(),
  mentions: z.number(),
  new_roles: z.number(),
});

const countRows = z.tuple([countRow]);

const standingRows = z.array(
  z.object({ rank: z.number().int(), movement: z.number().int().nullable() }),
);

const sourceKind = z.enum(["ads", "mentions", "site", "hiring"]);

const coverageRows = z.array(
  z.object({
    key: z.string(),
    kind: sourceKind,
    platform: z.string(),
    answered: z.number().int(),
  }),
);

export async function readCompetitorSnapshot(
  workspaceId: string,
  entityId: string,
  now: Date,
): Promise<SnapshotInput> {
  const since = daysBefore(now, 7);
  const until = now.toISOString();

  const [countsResult, standingResult, coverageResult] = await env.DB.batch([
    env.DB.prepare(SELECT_COMPETITOR_COUNTS).bind(
      workspaceId,
      entityId,
      since,
      until,
      D6_QUESTION_ID,
      D3_QUESTION_ID,
    ),
    env.DB.prepare(SELECT_COMPETITOR_STANDING).bind(workspaceId, entityId),
    env.DB.prepare(SELECT_COMPETITOR_COVERAGE).bind(workspaceId, entityId, since, until),
  ]);

  const [counts] = countRows.parse(countsResult.results);
  const standing = standingRows.parse(standingResult.results)[0];
  const sources = coverageRows.parse(coverageResult.results);

  return {
    standing:
      standing === undefined
        ? null
        : { rank: standing.rank, movement: standing.movement },
    counts: {
      newCreatives: counts.new_creatives,
      copyChanges: counts.copy_changes,
      noteworthyChanges: counts.site_changes,
      mentionsThatMatter: counts.mentions,
      newRoles: counts.new_roles,
    },
    sources: sources.map((source) => ({
      kind: source.kind,
      name: sourceName(source.kind, source.platform),
      answered: source.answered === 1,
    })),
  };
}
