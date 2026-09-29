import type { BriefPayload } from "./brief-payload";
import type { HowRanked } from "./how-ranked";
import { howRanked } from "./how-ranked";
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

export async function readHowRanked(
  db: D1Database,
  payload: BriefPayload | null,
): Promise<HowRanked | null> {
  if (payload === null) return null;
  if (payload.headline_rank === null) return null;
  const { weightRows: rows, counts } = await readHowRankedInputs(
    db,
    payload.workspace_id,
    payload.period_start,
    payload.period_end,
  );
  return howRanked({
    weekStartAt: payload.period_start,
    weightRows: rows,
    counts,
    brands: payload.brands,
  });
}
