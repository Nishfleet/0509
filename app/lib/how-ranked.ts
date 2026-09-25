import {
  reliabilitySchema,
  scoreBucketSchema,
  weightsAsOf,
  weightOf,
  type BucketCount,
  type Reliability,
  type ScoreBucket,
  type WeightRow,
} from "./standing-score";

const BUCKET_LABELS = {
  mention_matters: "Mentions that matter",
  mention_normal: "Mentions",
  site_change_noteworthy: "Noteworthy site changes",
  ad_new_creative: "New ad creatives",
  ad_copy_change: "Ad copy or offer changes",
  hiring_new_role: "New roles",
} satisfies Record<ScoreBucket, string>;

const RELIABILITY_LABELS = {
  official_api: "Official API",
  rss: "RSS feed",
  scraped_page: "Scraped page",
  best_effort: "Best effort",
} satisfies Record<Reliability, string>;

export interface HowRankedWeight {
  key: ScoreBucket;
  label: string;
  weight: number;
}

export interface HowRankedMultiplier {
  reliability: Reliability;
  label: string;
  value: number;
}

export interface HowRankedLine {
  bucket: ScoreBucket;
  reliability: Reliability;
  n: number;
  weight: number;
  multiplier: number;
  points: number;
}

export interface HowRankedBrand {
  entityId: string;
  name: string;
  lines: readonly HowRankedLine[];
  total: number;
}

export interface HowRanked {
  weekStartAt: string;
  weights: readonly HowRankedWeight[];
  multipliers: readonly HowRankedMultiplier[];
  brands: readonly HowRankedBrand[];
}

const bucketIndex = new Map(scoreBucketSchema.options.map((bucket, index) => [bucket, index]));
const reliabilityIndex = new Map(
  reliabilitySchema.options.map((reliability, index) => [reliability, index]),
);

const orderOf = (index: ReadonlyMap<string, number>, key: string): number => index.get(key) ?? 0;

export function howRanked(input: {
  weekStartAt: string;
  weightRows: readonly WeightRow[];
  counts: readonly BucketCount[];
  brands: readonly { entity_id: string; name: string }[];
}): HowRanked {
  const weights = weightsAsOf(input.weightRows, input.weekStartAt);

  const weightEntries: readonly HowRankedWeight[] = scoreBucketSchema.options.map((key) => ({
    key,
    label: BUCKET_LABELS[key],
    weight: weightOf(weights, key),
  }));

  const multiplierEntries: readonly HowRankedMultiplier[] = reliabilitySchema.options.map(
    (reliability) => ({
      reliability,
      label: RELIABILITY_LABELS[reliability],
      value: weightOf(weights, `reliability_${reliability}`),
    }),
  );

  const countsByEntity = new Map(
    [...new Set(input.counts.map((count) => count.entity_id))].map((entityId) => [
      entityId,
      input.counts.filter((count) => count.entity_id === entityId),
    ]),
  );

  const brands: readonly HowRankedBrand[] = input.brands.map((brand) => {
    const brandCounts = countsByEntity.get(brand.entity_id) ?? [];
    const lines: readonly HowRankedLine[] = [...brandCounts]
      .sort(
        (left, right) =>
          orderOf(bucketIndex, left.bucket) - orderOf(bucketIndex, right.bucket) ||
          orderOf(reliabilityIndex, left.reliability) - orderOf(reliabilityIndex, right.reliability),
      )
      .map((count) => {
        const weight = weightOf(weights, count.bucket);
        const multiplier = weightOf(weights, `reliability_${count.reliability}`);
        return {
          bucket: count.bucket,
          reliability: count.reliability,
          n: count.n,
          weight,
          multiplier,
          points: count.n * weight * multiplier,
        };
      });

    return {
      entityId: brand.entity_id,
      name: brand.name,
      lines,
      total: lines.reduce((sum, line) => sum + line.points, 0),
    };
  });

  return {
    weekStartAt: input.weekStartAt,
    weights: weightEntries,
    multipliers: multiplierEntries,
    brands,
  };
}
