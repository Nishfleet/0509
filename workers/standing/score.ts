import { z } from "zod";

export const D3_QUESTION_ID = "noteworthy_change";
export const D6_QUESTION_ID = "mention_matters";

export const reliabilitySchema = z.enum(["official_api", "rss", "scraped_page", "best_effort"]);

export type Reliability = z.infer<typeof reliabilitySchema>;

export const scoreBucketSchema = z.enum([
  "mention_matters",
  "mention_normal",
  "site_change_noteworthy",
  "ad_new_creative",
  "ad_copy_change",
  "hiring_new_role",
]);

export type ScoreBucket = z.infer<typeof scoreBucketSchema>;

export interface WeightRow {
  key: string;
  weight: number;
  effective_from: string;
}

export interface BucketCount {
  entity_id: string;
  bucket: ScoreBucket;
  reliability: Reliability;
  n: number;
}

export function weightsAsOf(
  rows: readonly WeightRow[],
  weekStartAt: string,
): ReadonlyMap<string, number> {
  const eligible = rows.filter((row) => row.effective_from <= weekStartAt);
  const sorted = [...eligible].sort((left, right) =>
    left.effective_from < right.effective_from
      ? -1
      : left.effective_from > right.effective_from
        ? 1
        : 0,
  );
  return new Map(sorted.map((row) => [row.key, row.weight]));
}

function weightOf(weights: ReadonlyMap<string, number>, key: string): number {
  const weight = weights.get(key);
  if (weight === undefined) {
    throw new Error(`scoring_weight has no row for ${key}`);
  }
  return weight;
}

export function scoreByEntity(
  counts: readonly BucketCount[],
  weights: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> {
  const entityIds = [...new Set(counts.map((count) => count.entity_id))];
  return new Map(
    entityIds.map((entityId) => [
      entityId,
      counts
        .filter((count) => count.entity_id === entityId)
        .reduce(
          (total, count) =>
            total +
            count.n *
              weightOf(weights, count.bucket) *
              weightOf(weights, `reliability_${count.reliability}`),
          0,
        ),
    ]),
  );
}

export interface WeekScore {
  entity_id: string;
  score: number;
}

export interface RankedEntity {
  entity_id: string;
  rank: number;
  movement: number | null;
}

function previousRankOrder(
  previousRanks: ReadonlyMap<string, number>,
  left: string,
  right: string,
): number {
  const leftRank = previousRanks.get(left);
  const rightRank = previousRanks.get(right);
  if (leftRank === rightRank) return 0;
  if (leftRank === undefined) return 1;
  if (rightRank === undefined) return -1;
  return leftRank - rightRank;
}

export function rankWeek(
  scores: readonly WeekScore[],
  previousRanks: ReadonlyMap<string, number>,
): readonly RankedEntity[] {
  const sorted = [...scores].sort(
    (left, right) =>
      right.score - left.score ||
      previousRankOrder(previousRanks, left.entity_id, right.entity_id) ||
      left.entity_id.localeCompare(right.entity_id),
  );
  return sorted.map((row, index) => {
    const previous = previousRanks.get(row.entity_id);
    const rank = index + 1;
    return {
      entity_id: row.entity_id,
      rank,
      movement: previous === undefined ? null : previous - rank,
    };
  });
}
