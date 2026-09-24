import { env } from "cloudflare:workers";

import type { NoulVerdict } from "../jev/client.server";
import { noulAction } from "../jev/thresholds";
import type { Evidence } from "../discovery/types";
import { insertAutoCompetitor, insertCompetitorFromSuggestion, turnOffFromRetireSuggestion } from "./entity.server";
import { insertVerdict } from "./jev_verdict.server";

const ACCEPT_SUGGESTION =
  "UPDATE suggestion SET status = 'accepted', decided_by = 'user', decided_at = ?1, entity_id = (SELECT e.id FROM entity e WHERE e.workspace_id = suggestion.workspace_id AND e.domain = suggestion.candidate_domain) WHERE id = ?2 AND workspace_id = ?3 AND status = 'pending'";

const DISMISS_SUGGESTION =
  "UPDATE suggestion SET status = 'dismissed', decided_by = 'user', decided_at = ?1 WHERE id = ?2 AND workspace_id = ?3 AND status = 'pending'";

const UPSERT_DISCOVERED =
  "INSERT INTO suggestion (id, workspace_id, kind, candidate_domain, candidate_name, evidence_json, verdict_p, verdict_reason, status, decided_by, decided_at, created_at) VALUES (?1, ?2, 'add', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) ON CONFLICT (workspace_id, candidate_domain) DO UPDATE SET evidence_json = excluded.evidence_json, verdict_p = excluded.verdict_p, verdict_reason = excluded.verdict_reason, status = excluded.status, decided_by = excluded.decided_by, decided_at = excluded.decided_at WHERE suggestion.status = 'pending'";

const LINK_AUTO_COMPETITOR =
  "UPDATE suggestion SET entity_id = (SELECT e.id FROM entity e WHERE e.workspace_id = ?1 AND e.domain = ?2) WHERE workspace_id = ?1 AND candidate_domain = ?2 AND status = 'auto_on' AND entity_id IS NULL";

export interface DiscoveryResult {
  name: string;
  domain: string;
  evidence: Evidence[];
  line: string;
  verdict: NoulVerdict | null;
}

type SuggestionStatus = "auto_on" | "pending" | "dismissed";

function statusOf(verdict: NoulVerdict | null): SuggestionStatus {
  if (verdict === null) return "pending";
  const action = noulAction(verdict.p);
  if (action === "act") return "auto_on";
  if (action === "reject") return "dismissed";
  return "pending";
}

function statementsFor(workspaceId: string, result: DiscoveryResult, now: string): D1PreparedStatement[] {
  const status = statusOf(result.verdict);
  const decided = status === "pending" ? null : now;
  const upsert = env.DB.prepare(UPSERT_DISCOVERED).bind(
    crypto.randomUUID(),
    workspaceId,
    result.domain,
    result.name,
    JSON.stringify({ evidence: result.evidence }),
    result.verdict?.p ?? null,
    result.line,
    status,
    decided === null ? null : "jev",
    decided,
    now,
  );
  const verdict =
    result.verdict === null || result.verdict.cached
      ? []
      : [
          insertVerdict({
            workspaceId,
            questionId: result.verdict.questionId,
            inputHash: result.verdict.inputHash,
            signalId: null,
            entityId: null,
            p: result.verdict.p,
            choice: null,
            reason: result.line,
            decidedAt: now,
          }),
        ];
  const added =
    status === "auto_on"
      ? [
          insertAutoCompetitor({ entityId: crypto.randomUUID(), workspaceId, domain: result.domain, name: result.name, now }),
          env.DB.prepare(LINK_AUTO_COMPETITOR).bind(workspaceId, result.domain),
        ]
      : [];
  return [upsert, ...added, ...verdict];
}

export async function writeDiscoveryResults(
  workspaceId: string,
  results: readonly DiscoveryResult[],
  now: string,
): Promise<void> {
  const statements = results.flatMap((result) => statementsFor(workspaceId, result, now));
  if (statements.length === 0) return;
  await env.DB.batch(statements);
}

export async function acceptSuggestion(input: {
  workspaceId: string;
  suggestionId: string;
  now: string;
}): Promise<void> {
  await env.DB.batch([
    insertCompetitorFromSuggestion({
      entityId: crypto.randomUUID(),
      now: input.now,
      suggestionId: input.suggestionId,
      workspaceId: input.workspaceId,
    }),
    env.DB.prepare(ACCEPT_SUGGESTION).bind(input.now, input.suggestionId, input.workspaceId),
  ]);
}

const ACCEPT_RETIRE_SUGGESTION =
  "UPDATE suggestion SET status = 'accepted', decided_by = 'user', decided_at = ?1 WHERE id = ?2 AND workspace_id = ?3 AND kind = 'retire' AND status = 'pending'";

const DISMISS_RETIRE_SUGGESTION =
  "UPDATE suggestion SET status = 'dismissed', decided_by = 'user', decided_at = ?1 WHERE id = ?2 AND workspace_id = ?3 AND kind = 'retire' AND status = 'pending'";

export async function confirmRetireSuggestion(input: {
  workspaceId: string;
  suggestionId: string;
  now: string;
}): Promise<void> {
  await env.DB.batch([
    turnOffFromRetireSuggestion(input),
    env.DB.prepare(ACCEPT_RETIRE_SUGGESTION).bind(input.now, input.suggestionId, input.workspaceId),
  ]);
}

export async function keepFromRetireSuggestion(input: {
  workspaceId: string;
  suggestionId: string;
  now: string;
}): Promise<void> {
  await env.DB.prepare(DISMISS_RETIRE_SUGGESTION).bind(input.now, input.suggestionId, input.workspaceId).run();
}

export async function dismissSuggestion(input: {
  workspaceId: string;
  suggestionId: string;
  now: string;
}): Promise<void> {
  await env.DB.prepare(DISMISS_SUGGESTION).bind(input.now, input.suggestionId, input.workspaceId).run();
}
