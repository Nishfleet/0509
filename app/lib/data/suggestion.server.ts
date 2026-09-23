import { env } from "cloudflare:workers";

import { setCompetitorOn } from "./entity.server";

export interface MaybeCompetitor {
  id: string;
  domain: string;
  name: string;
  reason: string | null;
  p: number | null;
}

interface PendingSuggestionRow {
  id: string;
  entity_id: string | null;
  candidate_domain: string;
  candidate_name: string | null;
  verdict_reason: string | null;
}

const SELECT_MAYBES = `SELECT id, candidate_domain AS domain,
  COALESCE(candidate_name, candidate_domain) AS name,
  verdict_reason AS reason, verdict_p AS p
FROM suggestion
WHERE workspace_id = ? AND kind = 'add' AND status = 'pending'
ORDER BY created_at ASC, id ASC`;

const SELECT_PENDING_BY_ID = `SELECT id, entity_id, candidate_domain, candidate_name, verdict_reason
FROM suggestion
WHERE id = ? AND workspace_id = ? AND kind = 'add' AND status = 'pending'`;

const MARK_ACCEPTED = `UPDATE suggestion
SET status = 'accepted', decided_by = 'user', decided_at = ?, entity_id = ?
WHERE id = ? AND workspace_id = ?`;

export async function listMaybeCompetitors(workspaceId: string): Promise<MaybeCompetitor[]> {
  const rows = await env.DB.prepare(SELECT_MAYBES).bind(workspaceId).all<MaybeCompetitor>();
  return rows.results;
}

export async function acceptSuggestion(workspaceId: string, suggestionId: string): Promise<boolean> {
  const pending = await env.DB.prepare(SELECT_PENDING_BY_ID).bind(suggestionId, workspaceId).first<PendingSuggestionRow>();
  if (!pending) return false;

  const entityId = await setCompetitorOn(workspaceId, {
    domain: pending.candidate_domain,
    name: pending.candidate_name,
    origin: "auto",
    reason: pending.verdict_reason,
    entityId: pending.entity_id,
  });

  const at = new Date().toISOString();
  await env.DB.prepare(MARK_ACCEPTED).bind(at, entityId, suggestionId, workspaceId).run();
  return true;
}
