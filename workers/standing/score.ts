export const D3_QUESTION_ID = "noteworthy_change";
export const D6_QUESTION_ID = "mention_matters";

export type Reliability = "official_api" | "rss" | "scraped_page" | "best_effort";

export type ScoreBucket =
  | "mention_matters"
  | "mention_normal"
  | "site_change_noteworthy"
  | "ad_new_creative"
  | "ad_copy_change"
  | "hiring_new_role";

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
