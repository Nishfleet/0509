import type { BriefPayload } from "./brief-payload";
import type { HowRanked } from "./how-ranked";
import { howRanked } from "./how-ranked";
import type { BucketCount, WeightRow } from "./standing-score";
import { D3_QUESTION_ID, D6_QUESTION_ID } from "./standing-score";
import { ALL_WEIGHTS, COUNT_BUCKETS, bucketCountRows, weightRows } from "./standing-score.server";
import { required } from "./required";

export interface HowRankedInputs {
  weightRows: readonly WeightRow[];
  counts: readonly BucketCount[];
}

export async function readHowRankedInputs(
  db: D1Database,
  workspaceId: string,
  week: { weekStartAt: string; weekEndAt: string },
): Promise<HowRankedInputs> {
  const reads = await db.batch([
    db.prepare(ALL_WEIGHTS),
    db.prepare(COUNT_BUCKETS).bind(workspaceId, week.weekStartAt, week.weekEndAt, D6_QUESTION_ID, D3_QUESTION_ID),
  ]);
  return {
    weightRows: weightRows.parse(required(reads[0], "how-ranked.weights").results),
    counts: bucketCountRows.parse(required(reads[1], "how-ranked.counts").results),
  };
}

export async function readHowRanked(db: D1Database, payload: BriefPayload | null): Promise<HowRanked | null> {
  if (payload === null) return null;
  if (payload.headline_rank === null) return null;
  const { weightRows: rows, counts } = await readHowRankedInputs(db, payload.workspace_id, {
    weekStartAt: payload.period_start,
    weekEndAt: payload.period_end,
  });
  return howRanked({
    weekStartAt: payload.period_start,
    weightRows: rows,
    counts,
    brands: payload.brands,
  });
}
