import { z } from "zod";

import type { StandingScore } from "../../app/lib/data/standing.server";
import { upsertStandingScores } from "../../app/lib/data/standing.server";
import {
  D3_QUESTION_ID,
  D6_QUESTION_ID,
  reliabilitySchema,
  scoreBucketSchema,
  scoreByEntity,
  weightsAsOf,
} from "./score";

export const COUNT_BUCKETS = `SELECT s.entity_id AS entity_id,
  CASE
    WHEN s.kind = 'mention' AND v.p >= 0.9 THEN 'mention_matters'
    WHEN s.kind = 'mention' AND v.p > 0.1 THEN 'mention_normal'
    WHEN s.kind = 'change' AND v.p >= 0.9 THEN 'site_change_noteworthy'
    WHEN s.kind = 'ad' AND s.aspect IS NOT NULL THEN 'ad_copy_change'
    WHEN s.kind = 'ad' AND s.published_at >= ?2 AND s.published_at < ?3 THEN 'ad_new_creative'
    WHEN s.kind = 'hiring' THEN 'hiring_new_role'
  END AS bucket,
  src.reliability AS reliability,
  COUNT(*) AS n
FROM signal s
JOIN entity e ON e.id = s.entity_id AND e.workspace_id = ?1 AND e.state = 'on'
JOIN source src ON src.id = s.source_id
LEFT JOIN jev_verdict v ON v.signal_id = s.id
  AND v.question_id = CASE s.kind WHEN 'mention' THEN ?4 WHEN 'change' THEN ?5 END
WHERE s.workspace_id = ?1 AND s.observed_at >= ?2 AND s.observed_at < ?3 AND s.is_tombstoned = 0
GROUP BY s.entity_id, bucket, src.reliability
HAVING bucket IS NOT NULL`;

const ON_ENTITY_IDS = `SELECT id FROM entity WHERE workspace_id = ?1 AND state = 'on' ORDER BY id`;

const ALL_WEIGHTS = `SELECT key, weight, effective_from FROM scoring_weight`;

export interface RefreshInput {
  workspaceId: string;
  weekStartAt: string;
  windowStartAt: string;
  windowEndAt: string;
  computedAt: string;
}

const entityIdRows = z.array(z.object({ id: z.string() }));

const weightRows = z.array(z.object({ key: z.string(), weight: z.number(), effective_from: z.string() }));

const bucketCountRows = z.array(
  z.object({
    entity_id: z.string(),
    bucket: scoreBucketSchema,
    reliability: reliabilitySchema,
    n: z.number().int(),
  }),
);

export async function refreshWorkspaceScores(
  db: D1Database,
  input: RefreshInput,
): Promise<ReadonlyMap<string, number>> {
  const reads = await db.batch([
    db.prepare(ON_ENTITY_IDS).bind(input.workspaceId),
    db.prepare(ALL_WEIGHTS),
    db.prepare(COUNT_BUCKETS).bind(
      input.workspaceId,
      input.windowStartAt,
      input.windowEndAt,
      D6_QUESTION_ID,
      D3_QUESTION_ID,
    ),
  ]);
  const entityIds = entityIdRows.parse(reads[0].results).map((row) => row.id);
  const weights = weightsAsOf(weightRows.parse(reads[1].results), input.weekStartAt);
  const counts = bucketCountRows.parse(reads[2].results);
  const scores = scoreByEntity(counts, weights);
  const rows: StandingScore[] = entityIds.map((entity_id) => ({
    workspace_id: input.workspaceId,
    entity_id,
    week_start_at: input.weekStartAt,
    score: scores.get(entity_id) ?? 0,
    computed_at: input.computedAt,
  }));
  await upsertStandingScores(db, rows);
  return new Map(rows.map((row) => [row.entity_id, row.score]));
}
