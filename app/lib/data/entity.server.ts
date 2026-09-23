import { env } from "cloudflare:workers";

export interface OnCompetitor {
  id: string;
  domain: string;
  name: string;
  reason: string | null;
}

const SELECT_ON_COMPETITORS = `SELECT e.id, e.domain, COALESCE(e.name, e.domain) AS name,
  COALESCE(s.verdict_reason, e.state_reason) AS reason
FROM entity e
LEFT JOIN suggestion s ON s.id = (
  SELECT s2.id FROM suggestion s2
  WHERE s2.entity_id = e.id AND s2.kind = 'add' AND s2.status = 'accepted'
  ORDER BY s2.decided_at DESC, s2.created_at DESC, s2.id DESC
  LIMIT 1
)
WHERE e.workspace_id = ? AND e.role = 'competitor' AND e.state = 'on'
ORDER BY e.created_at ASC, e.id ASC`;

const UPSERT_ON_COMPETITOR = `INSERT INTO entity
  (id, workspace_id, role, domain, name, origin, confirmed_at, state, state_changed_at, state_changed_by, state_reason, created_at)
VALUES (?, ?, 'competitor', ?, ?, ?, ?, 'on', ?, 'user', ?, ?)
ON CONFLICT(workspace_id, domain) DO UPDATE SET
  state = 'on',
  state_changed_at = excluded.state_changed_at,
  state_changed_by = 'user',
  state_reason = excluded.state_reason
RETURNING id`;

const TURN_ON_EXISTING = `UPDATE entity
SET state = 'on', state_changed_at = ?, state_changed_by = 'user', state_reason = ?
WHERE id = ? AND workspace_id = ?`;

const ACCEPT_SUGGESTION_FOR_DOMAIN = `UPDATE suggestion
SET status = 'accepted', decided_by = 'user', decided_at = ?, entity_id = ?
WHERE workspace_id = ? AND candidate_domain = ? AND status = 'pending'`;

export async function listOnCompetitors(workspaceId: string): Promise<OnCompetitor[]> {
  const rows = await env.DB.prepare(SELECT_ON_COMPETITORS).bind(workspaceId).all<OnCompetitor>();
  return rows.results;
}

export async function setCompetitorOn(
  workspaceId: string,
  input: {
    domain: string;
    name: string | null;
    origin: "manual" | "auto";
    reason: string | null;
    entityId?: string | null;
    now?: string;
  },
): Promise<string> {
  const at = input.now ?? new Date().toISOString();
  if (input.entityId) {
    const turned = await env.DB.prepare(TURN_ON_EXISTING)
      .bind(at, input.reason, input.entityId, workspaceId)
      .run();
    if (turned.meta.changes === 0) {
      throw new Error(
        `suggestion points at entity ${input.entityId}, which is not a row in workspace ${workspaceId}`,
      );
    }
    return input.entityId;
  }
  const row = await env.DB.prepare(UPSERT_ON_COMPETITOR)
    .bind(crypto.randomUUID(), workspaceId, input.domain, input.name, input.origin, at, at, input.reason, at)
    .first<{ id: string }>();
  if (!row) throw new Error("entity upsert returned no id");
  return row.id;
}

export async function addUserCompetitor(
  workspaceId: string,
  input: { domain: string; name: string | null; now?: string },
): Promise<string> {
  const entityId = await setCompetitorOn(workspaceId, {
    domain: input.domain,
    name: input.name,
    origin: "manual",
    reason: "added by you",
    now: input.now,
  });
  await env.DB.prepare(ACCEPT_SUGGESTION_FOR_DOMAIN)
    .bind(input.now ?? new Date().toISOString(), entityId, workspaceId, input.domain)
    .run();
  return entityId;
}
