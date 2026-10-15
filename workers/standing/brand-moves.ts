import { pickBiggestMove } from "../../app/lib/biggest-move";
import { readScoredSignalsByEntity } from "../../app/lib/data/signal.server";
import { weightsAsOf } from "../../app/lib/standing-score";
import { ALL_WEIGHTS, weightRows } from "../../app/lib/standing-score.server";

const MAX_LENGTH = 140;

interface BrandMovesInput {
  workspaceId: string;
  entityIds: readonly string[];
  since: string;
  until: string;
}

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= MAX_LENGTH ? flat : `${flat.slice(0, MAX_LENGTH - 1).trimEnd()}…`;
}

export async function readBrandMoves(db: D1Database, input: BrandMovesInput): Promise<Map<string, string>> {
  const weights = weightsAsOf(weightRows.parse((await db.prepare(ALL_WEIGHTS).all()).results), input.since);
  const scoredByEntity = await readScoredSignalsByEntity({
    workspaceId: input.workspaceId,
    entityIds: input.entityIds,
    since: input.since,
    until: input.until,
  });
  const moves = new Map<string, string>();
  for (const entityId of input.entityIds) {
    const signal = pickBiggestMove(scoredByEntity.get(entityId) ?? [], weights)?.signal;
    const text = [signal?.title, signal?.summary].find((candidate) => candidate?.trim());
    if (text !== undefined && text !== null) moves.set(entityId, shorten(text));
  }
  return moves;
}
