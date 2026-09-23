import { env } from "cloudflare:workers";

import { insertCompetitorFromSuggestion } from "./entity.server";

const ACCEPT_SUGGESTION =
  "UPDATE suggestion SET status = 'accepted', decided_by = 'user', decided_at = ?1, entity_id = (SELECT e.id FROM entity e WHERE e.workspace_id = suggestion.workspace_id AND e.domain = suggestion.candidate_domain) WHERE id = ?2 AND workspace_id = ?3 AND status = 'pending'";

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
