import { env } from "cloudflare:workers";

import type { Candidate, Evidence } from "../discovery/types";

const READ_BACKLOG =
  "SELECT name, domain, evidence_json FROM discovery_backlog WHERE workspace_id = ?1 AND promoted_at IS NULL ORDER BY first_seen_at, name_key";

const UPSERT_ROW =
  "INSERT INTO discovery_backlog (workspace_id, name_key, name, domain, evidence_json, evidence_count, first_seen_at, updated_at, promoted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, NULL) ON CONFLICT (workspace_id, name_key) DO UPDATE SET name = excluded.name, domain = COALESCE(excluded.domain, discovery_backlog.domain), evidence_json = excluded.evidence_json, evidence_count = excluded.evidence_count, updated_at = excluded.updated_at, promoted_at = NULL";

const PROMOTE_ROW =
  "UPDATE discovery_backlog SET promoted_at = ?1, updated_at = ?1 WHERE workspace_id = ?2 AND name_key = ?3 AND promoted_at IS NULL";

export interface BacklogRow {
  nameKey: string;
  name: string;
  domain: string | null;
  evidence: Evidence[];
}

export async function readBacklog(workspaceId: string): Promise<Candidate[]> {
  const { results } = await env.DB.prepare(READ_BACKLOG).bind(workspaceId).all<{
    name: string;
    domain: string | null;
    evidence_json: string;
  }>();
  return (results ?? []).map((row) => {
    const parsed = JSON.parse(row.evidence_json) as { evidence: Evidence[] };
    const candidate: Candidate = { name: row.name, evidence: parsed.evidence };
    if (row.domain !== null) candidate.domain = row.domain;
    return candidate;
  });
}

export async function writeBacklog(
  workspaceId: string,
  rows: readonly BacklogRow[],
  promotedKeys: readonly string[],
  now: string,
): Promise<void> {
  if (rows.length === 0 && promotedKeys.length === 0) return;
  const statements = [
    ...rows.map((row) =>
      env.DB.prepare(UPSERT_ROW).bind(
        workspaceId,
        row.nameKey,
        row.name,
        row.domain,
        JSON.stringify({ evidence: row.evidence }),
        row.evidence.length,
        now,
      ),
    ),
    ...promotedKeys.map((key) => env.DB.prepare(PROMOTE_ROW).bind(now, workspaceId, key)),
  ];
  await env.DB.batch(statements);
}
