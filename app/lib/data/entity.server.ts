import { env } from "cloudflare:workers";

export type CompetitorState = "on" | "off";

export interface CompetitorEntity {
  id: string;
  name: string;
  domain: string;
  state: CompetitorState;
  stateChangedAt: string | null;
}

interface Row {
  id: string;
  name: string | null;
  domain: string;
  state: CompetitorState;
  state_changed_at: string | null;
}

const SELECT_COMPETITOR =
  "SELECT id, name, domain, state, state_changed_at FROM entity WHERE id = ? AND workspace_id = ? AND role = 'competitor' AND state IN ('on', 'off')";

const SET_COMPETITOR_STATE =
  "UPDATE entity SET state = ?, state_changed_at = ?, state_changed_by = 'user', state_reason = NULL WHERE id = ? AND workspace_id = ? AND role = 'competitor' AND state IN ('on', 'off') AND state <> ?";

export async function readCompetitor(
  workspaceId: string,
  entityId: string,
): Promise<CompetitorEntity | null> {
  const row = await env.DB.prepare(SELECT_COMPETITOR).bind(entityId, workspaceId).first<Row>();
  if (row === null) return null;
  return {
    id: row.id,
    name: row.name ?? row.domain,
    domain: row.domain,
    state: row.state,
    stateChangedAt: row.state_changed_at,
  };
}

export async function setCompetitorState(
  workspaceId: string,
  entityId: string,
  state: CompetitorState,
  now: string,
): Promise<boolean> {
  const result = await env.DB.prepare(SET_COMPETITOR_STATE)
    .bind(state, now, entityId, workspaceId, state)
    .run();
  return result.meta.changes === 1;
}
