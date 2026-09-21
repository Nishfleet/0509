/**
 * The Jev context pack (docs/REBUILD-JEV.md): one JSON object built from the
 * database, same shape for every question — self card, subject, competitor
 * set, the item under judgment, 30 days of history, the user's prior
 * decisions, and the source's reliability.
 */
import {
  listTrackedEntities,
  type DataEnv,
  type EntityRow,
} from "../data/entity.server";
import { listRecentSignalsForEntity } from "../data/signal.server";
import { listUserDecisionsForEntity } from "../data/workspace.server";

function card(entity: EntityRow | null): Record<string, unknown> | null {
  if (!entity) return null;
  let identity: Record<string, unknown>;
  try {
    identity = JSON.parse(entity.identity_json) as Record<string, unknown>;
  } catch {
    identity = {};
  }
  return {
    id: entity.id,
    name: entity.name,
    domain: entity.domain,
    state: entity.state,
    ...identity,
  };
}

export async function buildContextPack(
  env: DataEnv,
  subject: EntityRow,
  item: Record<string, unknown>,
  reliability: string,
): Promise<Record<string, unknown>> {
  const entities = await listTrackedEntities(env, subject.workspace_id);
  const self = entities.find((e) => e.role === "self") ?? null;
  const competitors = entities
    .filter((e) => e.role === "competitor" && e.id !== subject.id)
    .map((e) => ({ name: e.name, domain: e.domain }));
  const [history, memory] = await Promise.all([
    listRecentSignalsForEntity(env, subject.id),
    listUserDecisionsForEntity(env, subject.id),
  ]);
  return {
    self: card(self),
    subject: { ...card(subject), role: subject.role },
    competitor_set: competitors,
    item,
    history_30d: history.map((h) => ({
      kind: h.kind,
      title: h.title,
      summary: h.summary,
      observed_at: h.observed_at,
    })),
    user_memory: memory,
    reliability,
  };
}
