import type { StandingScore } from "../../app/lib/data/standing.server";
import { upsertStandingScores } from "../../app/lib/data/standing.server";
import type { BucketCount, Reliability, ScoreBucket, WeightRow } from "./score";
import { D3_QUESTION_ID, D6_QUESTION_ID, scoreByEntity, weightsAsOf } from "./score";

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

const RELIABILITY_VALUES: readonly string[] = [
  "official_api",
  "rss",
  "scraped_page",
  "best_effort",
];

const SCORE_BUCKET_VALUES: readonly string[] = [
  "mention_matters",
  "mention_normal",
  "site_change_noteworthy",
  "ad_new_creative",
  "ad_copy_change",
  "hiring_new_role",
];

export interface RefreshInput {
  workspaceId: string;
  weekStartAt: string;
  windowStartAt: string;
  windowEndAt: string;
  computedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fieldAt(row: unknown, field: string, index: number): unknown {
  if (!isRecord(row)) {
    throw new Error(`standing refresh: batch row ${String(index)} is not an object`);
  }
  return row[field];
}

function stringField(row: unknown, field: string, index: number): string {
  const value = fieldAt(row, field, index);
  if (typeof value !== "string") {
    throw new Error(`standing refresh: batch row ${String(index)}.${field} is not a string`);
  }
  return value;
}

function numberField(row: unknown, field: string, index: number): number {
  const value = fieldAt(row, field, index);
  if (typeof value !== "number") {
    throw new Error(`standing refresh: batch row ${String(index)}.${field} is not a number`);
  }
  return value;
}

function isReliability(value: string): value is Reliability {
  return RELIABILITY_VALUES.includes(value);
}

function isScoreBucket(value: string): value is ScoreBucket {
  return SCORE_BUCKET_VALUES.includes(value);
}

function bucketCountRows(rows: readonly unknown[]): readonly BucketCount[] {
  return rows.map((row, index) => {
    const bucket = stringField(row, "bucket", index);
    const reliability = stringField(row, "reliability", index);
    if (!isScoreBucket(bucket)) {
      throw new Error(`standing refresh: batch row ${String(index)}.bucket is not a score bucket`);
    }
    if (!isReliability(reliability)) {
      throw new Error(`standing refresh: batch row ${String(index)}.reliability is not a source reliability`);
    }
    return {
      entity_id: stringField(row, "entity_id", index),
      bucket,
      reliability,
      n: numberField(row, "n", index),
    };
  });
}

function weightRows(rows: readonly unknown[]): readonly WeightRow[] {
  return rows.map((row, index) => ({
    key: stringField(row, "key", index),
    weight: numberField(row, "weight", index),
    effective_from: stringField(row, "effective_from", index),
  }));
}

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
  const entityIds = reads[0].results.map((row, index) => stringField(row, "id", index));
  const weights = weightsAsOf(weightRows(reads[1].results), input.weekStartAt);
  const counts = bucketCountRows(reads[2].results);
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
