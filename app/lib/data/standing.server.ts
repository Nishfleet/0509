export interface StandingScore {
  workspace_id: string;
  entity_id: string;
  week_start_at: string;
  score: number;
  computed_at: string;
}

export interface StandingRank {
  workspace_id: string;
  entity_id: string;
  week_start_at: string;
  rank: number;
  movement: number | null;
}

const UPSERT_STANDING_SCORE = `INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, computed_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6)
ON CONFLICT (workspace_id, entity_id, week_start_at)
DO UPDATE SET score = excluded.score, computed_at = excluded.computed_at
WHERE standing.rank IS NULL`;

const FREEZE_STANDING_RANK = `UPDATE standing SET rank = ?4, movement = ?5
WHERE workspace_id = ?1 AND entity_id = ?2 AND week_start_at = ?3`;

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

export async function freezeStandingRanks(
  db: D1Database,
  rows: readonly StandingRank[],
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  await db.batch(
    rows.map((row) =>
      db
        .prepare(FREEZE_STANDING_RANK)
        .bind(row.workspace_id, row.entity_id, row.week_start_at, row.rank, row.movement),
    ),
  );
}

export interface PeerRow {
  entityId: string;
  name: string;
  role: "self" | "competitor";
  state: string;
  rank: number;
}

const SELECT_LATEST_PEERS = `SELECT s.entity_id, COALESCE(e.name, e.domain) AS name, e.role, e.state, s.rank FROM standing s JOIN entity e ON e.id = s.entity_id AND e.workspace_id = s.workspace_id WHERE s.workspace_id = ?1 AND s.rank IS NOT NULL AND s.week_start_at = (SELECT MAX(week_start_at) FROM standing WHERE workspace_id = ?1 AND rank IS NOT NULL) ORDER BY s.rank ASC, s.entity_id ASC`;

export async function readLatestPeers(
  db: D1Database,
  workspaceId: string,
): Promise<readonly PeerRow[]> {
  const { results } = await db.prepare(SELECT_LATEST_PEERS).bind(workspaceId).all<{
    entity_id: string;
    name: string;
    role: "self" | "competitor";
    state: string;
    rank: number;
  }>();
  return results.map((row) => ({
    entityId: row.entity_id,
    name: row.name,
    role: row.role,
    state: row.state,
    rank: row.rank,
  }));
}
