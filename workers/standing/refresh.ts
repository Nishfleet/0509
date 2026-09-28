import { z } from "zod";

import type { StandingScore } from "../../app/lib/data/standing.server";
import { upsertStandingScores } from "../../app/lib/data/standing.server";
import { D3_QUESTION_ID, D6_QUESTION_ID, scoreByEntity, weightsAsOf } from "../../app/lib/standing-score";
import {
  ALL_WEIGHTS,
  COUNT_BUCKETS,
  bucketCountRows,
  weightRows,
} from "../../app/lib/standing-score.server";

const ON_ENTITY_IDS = `SELECT id FROM entity WHERE workspace_id = ?1 AND state = 'on' ORDER BY id`;

export interface RefreshInput {
  workspaceId: string;
  weekStartAt: string;
  windowStartAt: string;
  windowEndAt: string;
  computedAt: string;
}

const entityIdRows = z.array(z.object({ id: z.string() }));

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
