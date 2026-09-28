import { z } from "zod";

import { freezeStandingRanks } from "../../app/lib/data/standing.server";
import type { RankedEntity } from "../../app/lib/standing-score";
import { rankWeek } from "../../app/lib/standing-score";

const WEEK_SCORES = `SELECT s.entity_id AS entity_id, s.score AS score
FROM standing s
JOIN entity e ON e.id = s.entity_id AND e.workspace_id = s.workspace_id AND e.state = 'on'
WHERE s.workspace_id = ?1 AND s.week_start_at = ?2`;

const PREVIOUS_RANKS = `SELECT entity_id, rank
FROM standing
WHERE workspace_id = ?1
  AND rank IS NOT NULL
  AND week_start_at = (
    SELECT MAX(week_start_at) FROM standing
    WHERE workspace_id = ?1 AND rank IS NOT NULL AND week_start_at < ?2
  )`;

const weekScoreRows = z.array(z.object({ entity_id: z.string(), score: z.number() }));
const previousRankRows = z.array(z.object({ entity_id: z.string(), rank: z.number().int() }));

export async function freezeWeek(
  db: D1Database,
  workspaceId: string,
  weekStartAt: string,
): Promise<readonly RankedEntity[]> {
  const [scores, previous] = await db.batch([
    db.prepare(WEEK_SCORES).bind(workspaceId, weekStartAt),
    db.prepare(PREVIOUS_RANKS).bind(workspaceId, weekStartAt),
  ]);
  const previousRanks = new Map(
    previousRankRows.parse(previous.results).map((row) => [row.entity_id, row.rank]),
  );
  const ranked = rankWeek(weekScoreRows.parse(scores.results), previousRanks);
  await freezeStandingRanks(
    db,
    ranked.map((row) => ({
      workspace_id: workspaceId,
      entity_id: row.entity_id,
      week_start_at: weekStartAt,
      rank: row.rank,
      movement: row.movement,
    })),
  );
  return ranked;
}
