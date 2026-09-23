import { env } from "cloudflare:workers";

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
  p: number | null;
}

const SELECT_ON =
  "SELECT e.id AS entity_id, e.name, e.domain, s.verdict_reason AS reason FROM entity e LEFT JOIN suggestion s ON s.entity_id = e.id AND s.workspace_id = e.workspace_id WHERE e.workspace_id = ? AND e.role = 'competitor' AND e.state = 'on' ORDER BY e.created_at ASC, e.id ASC";

const SELECT_MAYBE =
  "SELECT id AS suggestion_id, candidate_name AS name, candidate_domain AS domain, verdict_reason AS reason, verdict_p AS p FROM suggestion WHERE workspace_id = ? AND kind = 'add' AND status = 'pending' ORDER BY verdict_p IS NULL, verdict_p DESC, created_at ASC";

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
  p: number | null;
}

function displayName(name: string | null, domain: string): string {
  if (name !== null && name !== "") return name;
  return domain;
}

export async function readOnboardingCompetitors(
  workspaceId: string,
): Promise<{ on: OnCompetitor[]; maybes: MaybeCompetitor[] }> {
  const [onResult, maybeResult] = await Promise.all([
    env.DB.prepare(SELECT_ON).bind(workspaceId).all<OnRow>(),
    env.DB.prepare(SELECT_MAYBE).bind(workspaceId).all<MaybeRow>(),
  ]);

  const on = (onResult.results ?? []).map((row) => ({
    entityId: row.entity_id,
    name: displayName(row.name, row.domain),
    domain: row.domain,
    reason: row.reason,
  }));

  const maybes = (maybeResult.results ?? []).map((row) => ({
    suggestionId: row.suggestion_id,
    name: displayName(row.name, row.domain),
    domain: row.domain,
    reason: row.reason,
    p: row.p,
  }));

  return { on, maybes };
}
