import { D1_QUESTION, D2_QUESTION, excludedDomains } from "./judge";
import type { D2Outcome, JudgedCandidate } from "./judge";
import type { ScoredCandidate } from "./shortlist";
import { normaliseName } from "./types";

export interface PersistEnv {
  DB: D1Database;
}

export interface PersistResult {
  accepted: string[];
  maybe: number;
  dropped: number;
  unjudged: number;
}

async function idHash(...parts: string[]): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(parts.join(":")),
  );
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function discoveryEntityId(workspaceId: string, domain: string): Promise<string> {
  return `ent_${await idHash(workspaceId, domain)}`;
}

function evidenceJson(scored: ScoredCandidate): string {
  return JSON.stringify({
    generator_count: scored.generatorCount,
    publisher_count: scored.publisherCount,
    guaranteed_via: scored.guaranteedVia,
    lines: scored.candidate.evidence.map((e) => ({
      generator: e.generator,
      source_url: e.sourceUrl,
      excerpt: e.excerpt.slice(0, 200),
      publisher_domain: e.publisherDomain ?? null,
    })),
  });
}

export async function watchStatements(
  db: D1Database,
  entityId: string,
  targetKey: string,
): Promise<D1PreparedStatement[]> {
  const sources = await db
    .prepare("SELECT id FROM source WHERE is_enabled = 1 AND key NOT LIKE 'discovery.%'")
    .all<{ id: string }>();
  const stmts: D1PreparedStatement[] = [];
  for (const source of sources.results) {
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO watch (id, entity_id, source_id, target_key)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(`wat_${await idHash(entityId, source.id, targetKey)}`, entityId, source.id, targetKey),
    );
  }
  return stmts;
}

export async function persistDiscovery(
  env: PersistEnv,
  workspaceId: string,
  judged: JudgedCandidate[],
  allRows: ScoredCandidate[],
): Promise<PersistResult> {
  const now = new Date().toISOString();
  const judgedKeys = new Set(judged.map((j) => j.scored.key));
  const stmts: D1PreparedStatement[] = [];
  const result: PersistResult = { accepted: [], maybe: 0, dropped: 0, unjudged: 0 };

  for (const j of judged) {
    const candidateDomain = j.domain ?? `name:${normaliseName(j.scored.candidate.name)}`;
    const entityId = j.domain ? await discoveryEntityId(workspaceId, j.domain) : null;
    if (j.decision === "accept" && j.domain && entityId) {
      result.accepted.push(j.domain);
      stmts.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO entity
             (id, workspace_id, role, domain, name, origin, state, created_at)
           VALUES (?, ?, 'competitor', ?, ?, 'auto', 'on', ?)`,
        ).bind(entityId, workspaceId, j.domain, j.scored.candidate.name, now),
      );
      stmts.push(...(await watchStatements(env.DB, entityId, j.domain)));
      stmts.push(
        env.DB.prepare(
          `INSERT INTO suggestion
             (id, workspace_id, entity_id, kind, candidate_domain, candidate_name,
              evidence_json, verdict_p, verdict_reason, status, decided_by, decided_at, created_at)
           VALUES (?, ?, ?, 'add', ?, ?, ?, ?, ?, 'auto_on', 'jev', ?, ?)
           ON CONFLICT(workspace_id, candidate_domain) DO UPDATE SET
             entity_id = COALESCE(suggestion.entity_id, excluded.entity_id),
             verdict_p = excluded.verdict_p,
             verdict_reason = excluded.verdict_reason,
             evidence_json = excluded.evidence_json,
             status = CASE WHEN suggestion.status = 'pending' THEN 'auto_on' ELSE suggestion.status END,
             decided_by = CASE WHEN suggestion.status = 'pending' THEN 'jev' ELSE suggestion.decided_by END,
             decided_at = CASE WHEN suggestion.status = 'pending' THEN excluded.decided_at ELSE suggestion.decided_at END`,
        ).bind(
          `sug_${await idHash(workspaceId, candidateDomain)}`,
          workspaceId,
          entityId,
          candidateDomain,
          j.scored.candidate.name,
          evidenceJson(j.scored),
          j.p,
          j.verdictReason,
          now,
          now,
        ),
      );
    } else if (j.decision === "drop") {
      result.dropped += 1;
      stmts.push(
        env.DB.prepare(
          `INSERT INTO suggestion
             (id, workspace_id, entity_id, kind, candidate_domain, candidate_name,
              evidence_json, verdict_p, verdict_reason, status, decided_by, decided_at, created_at)
           VALUES (?, ?, NULL, 'add', ?, ?, ?, ?, ?, 'dismissed', 'jev', ?, ?)
           ON CONFLICT(workspace_id, candidate_domain) DO UPDATE SET
             verdict_p = excluded.verdict_p,
             verdict_reason = excluded.verdict_reason,
             evidence_json = excluded.evidence_json,
             status = CASE WHEN suggestion.status = 'pending' THEN 'dismissed' ELSE suggestion.status END,
             decided_by = CASE WHEN suggestion.status = 'pending' THEN 'jev' ELSE suggestion.decided_by END,
             decided_at = CASE WHEN suggestion.status = 'pending' THEN excluded.decided_at ELSE suggestion.decided_at END`,
        ).bind(
          `sug_${await idHash(workspaceId, candidateDomain)}`,
          workspaceId,
          candidateDomain,
          j.scored.candidate.name,
          evidenceJson(j.scored),
          j.p,
          j.verdictReason ?? "below the drop threshold",
          now,
          now,
        ),
      );
    } else {
      result.maybe += 1;
      stmts.push(
        env.DB.prepare(
          `INSERT INTO suggestion
             (id, workspace_id, entity_id, kind, candidate_domain, candidate_name,
              evidence_json, verdict_p, verdict_reason, status, decided_by, decided_at, created_at)
           VALUES (?, ?, ?, 'add', ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
           ON CONFLICT(workspace_id, candidate_domain) DO UPDATE SET
             verdict_p = excluded.verdict_p,
             verdict_reason = excluded.verdict_reason,
             evidence_json = excluded.evidence_json,
             status = CASE WHEN suggestion.status = 'pending' THEN excluded.status ELSE suggestion.status END`,
        ).bind(
          `sug_${await idHash(workspaceId, candidateDomain)}`,
          workspaceId,
          null,
          candidateDomain,
          j.scored.candidate.name,
          evidenceJson(j.scored),
          j.p,
          j.verdictReason,
          j.judged ? "jev" : null,
          j.judged ? now : null,
          now,
        ),
      );
    }
    if (j.judged) {
      const verdictEntityId = j.decision === "accept" ? entityId : null;
      stmts.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO jev_verdict
             (id, workspace_id, question_id, input_hash, entity_id, p, choice, reason, decided_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        ).bind(
          `jev_${await idHash(D1_QUESTION, j.inputHash)}`,
          workspaceId,
          D1_QUESTION,
          j.inputHash,
          verdictEntityId,
          j.p,
          j.verdictReason,
          now,
        ),
      );
    }
  }

  const excluded = await excludedDomains({ DB: env.DB }, workspaceId);
  for (const row of allRows) {
    if (judgedKeys.has(row.key)) continue;
    const candidateDomain = row.domain ?? `name:${normaliseName(row.candidate.name)}`;
    if (excluded.has(candidateDomain)) continue;
    result.unjudged += 1;
    stmts.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO suggestion
           (id, workspace_id, kind, candidate_domain, candidate_name,
            evidence_json, status, created_at)
         VALUES (?, ?, 'add', ?, ?, ?, 'pending', ?)`,
      ).bind(
        `sug_${await idHash(workspaceId, candidateDomain)}`,
        workspaceId,
        candidateDomain,
        row.candidate.name,
        evidenceJson(row),
        now,
      ),
    );
  }

  if (stmts.length > 0) await env.DB.batch(stmts);
  return result;
}

export async function persistRefresh(
  env: PersistEnv,
  workspaceId: string,
  outcomes: D2Outcome[],
): Promise<void> {
  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  for (const o of outcomes) {
    if (o.action === "unjudged") continue;
    stmts.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO jev_verdict
           (id, workspace_id, question_id, input_hash, entity_id, p, choice, reason, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        `jev_${await idHash(D2_QUESTION, o.inputHash)}`,
        workspaceId,
        D2_QUESTION,
        o.inputHash,
        o.entityId,
        o.p,
        o.action === "retire" ? o.reason : o.action === "ask" ? o.reason : null,
        o.action === "retire" || o.action === "ask" ? o.reason : null,
        now,
      ),
    );
    if (o.action === "retire") {
      stmts.push(
        env.DB.prepare(
          `UPDATE entity SET state = 'off', state_reason = ?, state_changed_by = 'jev',
             state_changed_at = ?
           WHERE id = ? AND workspace_id = ? AND state = 'on'`,
        ).bind(o.reason, now, o.entityId, workspaceId),
      );
    }
    if (o.action === "ask") {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO suggestion
             (id, workspace_id, entity_id, kind, candidate_domain,
              verdict_p, verdict_reason, status, decided_by, decided_at, created_at)
           VALUES (?, ?, ?, 'retire', ?, ?, ?, 'pending', 'jev', ?, ?)
           ON CONFLICT(workspace_id, candidate_domain) DO UPDATE SET
             verdict_p = excluded.verdict_p,
             verdict_reason = excluded.verdict_reason,
             status = CASE WHEN suggestion.status = 'pending' THEN 'pending' ELSE suggestion.status END`,
        ).bind(
          `sug_${await idHash(workspaceId, `retire:${o.domain}`)}`,
          workspaceId,
          o.entityId,
          o.domain,
          o.p,
          o.reason,
          now,
          now,
        ),
      );
    }
  }
  if (stmts.length > 0) await env.DB.batch(stmts);
}

export async function recordGeneratorSnapshot(
  env: PersistEnv,
  workspaceId: string,
  selfEntityId: string,
  selfDomain: string,
  generator: string,
  itemCount: number,
  payloadR2Key: string | null,
  payloadHash: string,
): Promise<void> {
  const now = new Date().toISOString();
  const source = await env.DB.prepare(
    "SELECT id FROM source WHERE plugin_key = ?",
  )
    .bind(generator)
    .first<{ id: string }>();
  if (!source) return;
  const watchId = `wat_${await idHash(selfEntityId, source.id, selfDomain)}`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO watch (id, entity_id, source_id, target_key)
       VALUES (?, ?, ?, ?)`,
    ).bind(watchId, selfEntityId, source.id, selfDomain),
    env.DB.prepare(
      `INSERT INTO snapshot (id, watch_id, fetched_at, payload_r2_key, payload_hash, item_count)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      `snp_${await idHash(watchId, now, generator)}`,
      watchId,
      now,
      payloadR2Key,
      payloadHash,
      itemCount,
    ),
  ]);
}
