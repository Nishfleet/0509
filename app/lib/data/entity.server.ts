import { env } from "cloudflare:workers";

export type CompetitorState = "on" | "off";

export interface CompetitorEntity {
  id: string;
  name: string;
  domain: string;
  state: CompetitorState;
  stateChangedAt: string | null;
}

export interface OnCompetitor {
  entityId: string;
  name: string;
  domain: string;
  reason: string | null;
}

export interface MaybeCompetitor {
  suggestionId: string;
  name: string;
  domain: string;
  reason: string | null;
}

interface Row {
  id: string;
  name: string | null;
  domain: string;
  state: CompetitorState;
  state_changed_at: string | null;
}

interface OnRow {
  entity_id: string;
  name: string | null;
  domain: string;
  reason: string | null;
}

interface MaybeRow {
  suggestion_id: string;
  name: string | null;
  domain: string;
  reason: string | null;
}

const SELECT_COMPETITOR =
  "SELECT id, name, domain, state, state_changed_at FROM entity WHERE id = ? AND workspace_id = ? AND role = 'competitor' AND state IN ('on', 'off')";

const SET_COMPETITOR_STATE =
  "UPDATE entity SET state = ?, state_changed_at = ?, state_changed_by = 'user', state_reason = NULL WHERE id = ? AND workspace_id = ? AND role = 'competitor' AND state IN ('on', 'off') AND state <> ?";

const INSERT_COMPETITOR_FROM_SUGGESTION =
  "INSERT INTO entity (id, workspace_id, role, domain, name, origin, confirmed_at, state, state_changed_at, state_changed_by, created_at) SELECT ?1, workspace_id, 'competitor', candidate_domain, candidate_name, 'auto', ?2, 'on', ?2, 'user', ?2 FROM suggestion WHERE id = ?3 AND workspace_id = ?4 AND status = 'pending' ON CONFLICT (workspace_id, domain) DO UPDATE SET state = 'on', state_changed_at = excluded.state_changed_at, state_changed_by = 'user', state_reason = NULL WHERE entity.role = 'competitor' AND entity.state IN ('on', 'off')";

const SELECT_ON =
  "SELECT e.id AS entity_id, e.name, e.domain, s.verdict_reason AS reason FROM entity e LEFT JOIN suggestion s ON s.entity_id = e.id AND s.workspace_id = e.workspace_id WHERE e.workspace_id = ? AND e.role = 'competitor' AND e.state = 'on' ORDER BY e.created_at ASC, e.id ASC";

const SELECT_MAYBE =
  "SELECT id AS suggestion_id, candidate_name AS name, candidate_domain AS domain, verdict_reason AS reason FROM suggestion WHERE workspace_id = ? AND kind = 'add' AND status = 'pending' AND NOT EXISTS (SELECT 1 FROM entity e WHERE e.workspace_id = suggestion.workspace_id AND e.domain = suggestion.candidate_domain AND (e.role <> 'competitor' OR e.state NOT IN ('on', 'off'))) ORDER BY verdict_p IS NULL, verdict_p DESC, created_at ASC";

function displayName(name: string | null, domain: string): string {
  if (name !== null && name !== "") return name;
  return domain;
}

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

export async function readOnboardingCompetitors(
  workspaceId: string,
): Promise<{ on: OnCompetitor[]; maybes: MaybeCompetitor[] }> {
  const [onResult, maybeResult] = await Promise.all([
    env.DB.prepare(SELECT_ON).bind(workspaceId).all<OnRow>(),
    env.DB.prepare(SELECT_MAYBE).bind(workspaceId).all<MaybeRow>(),
  ]);

  const on = onResult.results.map((row) => ({
    entityId: row.entity_id,
    name: displayName(row.name, row.domain),
    domain: row.domain,
    reason: row.reason,
  }));

  const maybes = maybeResult.results.map((row) => ({
    suggestionId: row.suggestion_id,
    name: displayName(row.name, row.domain),
    domain: row.domain,
    reason: row.reason,
  }));

  return { on, maybes };
}

export function insertCompetitorFromSuggestion(input: {
  entityId: string;
  now: string;
  suggestionId: string;
  workspaceId: string;
}): D1PreparedStatement {
  return env.DB
    .prepare(INSERT_COMPETITOR_FROM_SUGGESTION)
    .bind(input.entityId, input.now, input.suggestionId, input.workspaceId);
}
