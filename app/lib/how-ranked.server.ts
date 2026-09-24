import type { BucketCount, WeightRow } from "./standing-score";
import { D3_QUESTION_ID, D6_QUESTION_ID } from "./standing-score";
import {
  ALL_WEIGHTS,
  COUNT_BUCKETS,
  bucketCountRows,
  weightRows,
} from "./standing-score.server";

export interface HowRankedInputs {
  weightRows: readonly WeightRow[];
  counts: readonly BucketCount[];
}

export async function readHowRankedInputs(
  db: D1Database,
  workspaceId: string,
  weekStartAt: string,
  weekEndAt: string,
): Promise<HowRankedInputs> {
  const reads = await db.batch([
    db.prepare(ALL_WEIGHTS),
    db.prepare(COUNT_BUCKETS).bind(workspaceId, weekStartAt, weekEndAt, D6_QUESTION_ID, D3_QUESTION_ID),
  ]);
  return {
    weightRows: weightRows.parse(reads[0].results),
    counts: bucketCountRows.parse(reads[1].results),
  };
}
