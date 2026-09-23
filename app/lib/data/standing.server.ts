export interface StandingScore {
  workspace_id: string;
  entity_id: string;
  week_start_at: string;
  score: number;
  computed_at: string;
}

const UPSERT_STANDING_SCORE = `INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, computed_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6)
ON CONFLICT (workspace_id, entity_id, week_start_at)
DO UPDATE SET score = excluded.score, computed_at = excluded.computed_at`;

export async function upsertStandingScores(
  db: D1Database,
  rows: readonly StandingScore[],
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  await db.batch(
    rows.map((row) =>
      db
        .prepare(UPSERT_STANDING_SCORE)
        .bind(
          crypto.randomUUID(),
          row.workspace_id,
          row.entity_id,
          row.week_start_at,
          row.score,
          row.computed_at,
        ),
    ),
  );
}
