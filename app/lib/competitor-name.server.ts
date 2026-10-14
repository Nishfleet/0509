import { parseCompetitorName } from "./competitor-name";
import { renameCompetitor } from "./data/entity.server";
import { retargetNameWatches } from "./data/watch.server";

export async function saveCompetitorName(
  workspaceId: string,
  entityId: string,
  raw: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const parsed = parseCompetitorName(raw);
  if (!parsed.ok) return parsed;
  if (!(await renameCompetitor(workspaceId, entityId, parsed.name))) {
    throw new Response("We don't track that competitor.", { status: 404 });
  }
  await retargetNameWatches(entityId, parsed.name);
  return { ok: true };
}
