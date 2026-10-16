import { env } from "cloudflare:workers";
import { z } from "zod";

import type { ScoredSignal } from "../../app/lib/biggest-move";
import { isFeedKind } from "../../app/lib/developments";
import { ABOUT_BRAND_KEEP_AT, ACT_AT, changeActsSql } from "../../app/lib/jev/thresholds";
import { D3_QUESTION_ID, D6_QUESTION_ID, reliabilitySchema, scoreBucketSchema } from "../../app/lib/standing-score";
import { SHOWN_SIGNALS } from "../../app/lib/customer-ready";

const SELECT_SCORED_SIGNALS_BY_ENTITY = `SELECT * FROM (SELECT s.id, s.entity_id, s.kind, s.title, s.summary, s.url, s.observed_at,
  src.platform, src.reliability,
  CASE
    WHEN s.kind = 'mention' AND v.p >= ${String(ACT_AT)} THEN 'mention_matters'
    WHEN s.kind = 'mention' AND v.p >= ${String(ABOUT_BRAND_KEEP_AT)} THEN 'mention_normal'
    WHEN s.kind = 'change' AND ${changeActsSql("s", "v")} THEN 'site_change_noteworthy'
    WHEN s.kind = 'ad' AND s.aspect IS NOT NULL THEN 'ad_copy_change'
    WHEN s.kind = 'ad' AND s.published_at >= ?3 AND s.published_at < ?4 THEN 'ad_new_creative'
    WHEN s.kind = 'hiring' THEN 'hiring_new_role'
  END AS bucket
FROM ${SHOWN_SIGNALS} s
JOIN source src ON src.id = s.source_id
LEFT JOIN jev_verdict v ON v.id = (
  SELECT v2.id FROM jev_verdict v2
  WHERE v2.signal_id = s.id AND v2.workspace_id = s.workspace_id
    AND v2.question_id = CASE s.kind WHEN 'mention' THEN ?5 WHEN 'change' THEN ?6 END
  ORDER BY v2.decided_at DESC
  LIMIT 1
)
WHERE s.workspace_id = ?1 AND s.entity_id IN (SELECT value FROM json_each(?2))
  AND s.observed_at >= ?3 AND s.observed_at < ?4 AND s.is_tombstoned = 0 AND s.duplicate_of IS NULL)
WHERE bucket IS NOT NULL
ORDER BY observed_at DESC, id DESC`;

const signalText = z.object({
  title: z.string().nullable(),
  summary: z.string().nullable(),
  url: z.string().nullable(),
});

const scoredSignalRows = z.array(
  signalText.extend({
    id: z.string(),
    entity_id: z.string(),
    kind: z.string(),
    observed_at: z.string(),
    platform: z.string(),
    reliability: reliabilitySchema,
    bucket: scoreBucketSchema,
  }),
);

export async function readScoredSignalsByEntity(input: {
  workspaceId: string;
  entityIds: readonly string[];
  since: string;
  until: string;
}): Promise<Map<string, ScoredSignal[]>> {
  const { results } = await env.DB.prepare(SELECT_SCORED_SIGNALS_BY_ENTITY)
    .bind(input.workspaceId, JSON.stringify(input.entityIds), input.since, input.until, D6_QUESTION_ID, D3_QUESTION_ID)
    .all();
  const byEntity = new Map<string, ScoredSignal[]>();
  for (const row of scoredSignalRows.parse(results)) {
    if (!isFeedKind(row.kind)) continue;
    const signal: ScoredSignal = {
      id: row.id,
      kind: row.kind,
      bucket: row.bucket,
      reliability: row.reliability,
      platform: row.platform,
      title: row.title,
      summary: row.summary,
      url: row.url,
      observedAt: row.observed_at,
    };
    byEntity.set(row.entity_id, [...(byEntity.get(row.entity_id) ?? []), signal]);
  }
  return byEntity;
}
