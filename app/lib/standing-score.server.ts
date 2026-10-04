import { z } from "zod";

import { ACT_AT, REJECT_AT, changeActsSql } from "./jev/thresholds";
import { D3_QUESTION_ID, D6_QUESTION_ID, reliabilitySchema, scoreBucketSchema } from "./standing-score";

export const COUNT_BUCKETS = `SELECT s.entity_id AS entity_id,
  CASE
    WHEN s.kind = 'mention' AND v.p >= ${String(ACT_AT)} THEN 'mention_matters'
    WHEN s.kind = 'mention' AND v.p > ${String(REJECT_AT)} THEN 'mention_normal'
    WHEN s.kind = 'change' AND ${changeActsSql("s", "v")} THEN 'site_change_noteworthy'
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
WHERE s.workspace_id = ?1 AND s.observed_at >= ?2 AND s.observed_at < ?3 AND s.is_tombstoned = 0 AND s.duplicate_of IS NULL
GROUP BY s.entity_id, bucket, src.reliability
HAVING bucket IS NOT NULL`;

const COUNT_UNJUDGED_INPUTS = `SELECT COUNT(*) AS n
FROM signal s
JOIN entity e ON e.id = s.entity_id AND e.workspace_id = ?1 AND e.state = 'on'
WHERE s.workspace_id = ?1 AND s.observed_at >= ?2 AND s.observed_at < ?3 AND s.is_tombstoned = 0
  AND s.kind IN ('mention', 'change')
  AND NOT EXISTS (
    SELECT 1 FROM jev_verdict v
    WHERE v.signal_id = s.id
      AND v.question_id IN (?4, ?5)
  )`;

export async function countUnjudgedInputs(
  db: D1Database,
  input: { workspaceId: string; windowStartAt: string; windowEndAt: string },
): Promise<number> {
  const row = await db
    .prepare(COUNT_UNJUDGED_INPUTS)
    .bind(input.workspaceId, input.windowStartAt, input.windowEndAt, D6_QUESTION_ID, D3_QUESTION_ID)
    .first<{ n: number }>();
  if (row === null) {
    throw new Error("countUnjudgedInputs returned no row");
  }
  return row.n;
}

export const ALL_WEIGHTS = `SELECT key, weight, effective_from FROM scoring_weight`;

export const weightRows = z.array(z.object({ key: z.string(), weight: z.number(), effective_from: z.string() }));

export const bucketCountRows = z.array(
  z.object({
    entity_id: z.string(),
    bucket: scoreBucketSchema,
    reliability: reliabilitySchema,
    n: z.number().int(),
  }),
);
