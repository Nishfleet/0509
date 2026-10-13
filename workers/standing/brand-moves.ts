import { pickBiggestMove } from "../../app/lib/biggest-move";
import { readScoredSignals } from "../../app/lib/data/signal.server";
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
  const moves = new Map<string, string>();
  for (const entityId of input.entityIds) {
    const scored = await readScoredSignals({
      workspaceId: input.workspaceId,
      entityId,
      since: input.since,
      until: input.until,
    });
    const signal = pickBiggestMove(scored, weights)?.signal;
    const text = signal === undefined ? null : (signal.title ?? signal.summary);
    if (text !== null && text.trim() !== "") moves.set(entityId, shorten(text));
  }
  return moves;
}
