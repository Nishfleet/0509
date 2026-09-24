import { env } from "cloudflare:workers";
import { z } from "zod";

import type { Candidate } from "../discovery/types";
import type { GeneratorKey } from "../discovery/types";

const READ_BACKLOG =
  "SELECT name, domain, evidence_json FROM discovery_backlog WHERE workspace_id = ?1 AND promoted_at IS NULL ORDER BY first_seen_at, name_key";

const UPSERT_ROW =
  "INSERT INTO discovery_backlog (workspace_id, name_key, name, domain, evidence_json, evidence_count, first_seen_at, updated_at, promoted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, NULL) ON CONFLICT (workspace_id, name_key) DO UPDATE SET name = excluded.name, domain = COALESCE(excluded.domain, discovery_backlog.domain), evidence_json = excluded.evidence_json, evidence_count = excluded.evidence_count, updated_at = excluded.updated_at, promoted_at = NULL";

const PROMOTE_ROW =
  "UPDATE discovery_backlog SET promoted_at = ?1, updated_at = ?1 WHERE workspace_id = ?2 AND name_key = ?3 AND promoted_at IS NULL";

const backlogRows = z.array(
  z.object({
    name: z.string(),
    domain: z.string().nullable(),
    evidence_json: z.string(),
  }),
);

const evidenceSchema = z.object({
  sourceUrl: z.string(),
  excerpt: z.string(),
  generator: z.enum(["news", "hn", "ads"] satisfies GeneratorKey[]),
});

const evidenceEnvelopeSchema = z.object({ evidence: z.array(evidenceSchema) });

export interface BacklogRow {
  nameKey: string;
  name: string;
  domain: string | null;
  evidence: { sourceUrl: string; excerpt: string; generator: GeneratorKey }[];
}

export async function readBacklog(workspaceId: string): Promise<Candidate[]> {
  const rows = backlogRows.parse((await env.DB.prepare(READ_BACKLOG).bind(workspaceId).all()).results);
  return rows.map((row) => {
    const parsed = evidenceEnvelopeSchema.safeParse(JSON.parse(row.evidence_json));
    if (!parsed.success) throw new Error(`discovery backlog evidence: ${z.prettifyError(parsed.error)}`);
    return row.domain === null
      ? { name: row.name, evidence: parsed.data.evidence }
      : { name: row.name, domain: row.domain, evidence: parsed.data.evidence };
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
