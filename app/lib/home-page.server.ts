import { env } from "cloudflare:workers";

import type { BriefPayload } from "./brief-payload";
import { readSelfSiteFill } from "./data/entity.server";
import { readFirstLook } from "./data/first_look.server";
import { readRivalFacts } from "./data/rival_baseline.server";
import { readWeekEvidence } from "./data/signal.server";
import { readWorkspaceMentionSources } from "./data/source.server";
import { firstLookRows } from "./first-look";
import { readHowRanked } from "./how-ranked.server";
import { readBiggestSiteChanges } from "./site-changes.server";

export function resolveOpenId(
  open: string | null,
  payload: BriefPayload | null,
  entities: readonly { id: string }[],
): string | null {
  if (open === null || payload === null) return null;
  return entities.some((entity) => entity.id === open) ? open : null;
}

async function readFirstLookRows(workspaceId: string) {
  const now = new Date();
  const [rivals, facts] = await Promise.all([
    readFirstLook(workspaceId),
    readRivalFacts(env.DB, workspaceId, now).catch((error: unknown) => {
      console.error(JSON.stringify({ event: "home.baseline_failed", error: String(error).slice(0, 300) }));
      return new Map();
    }),
  ]);
  return firstLookRows(rivals, now, facts);
}

async function readWorkspaceReads(workspaceId: string, payload: BriefPayload | null, openId: string | null) {
  const [sources, siteFill, howRanked, moves, evidence, firstLook] = await Promise.all([
    readWorkspaceMentionSources(workspaceId),
    readSelfSiteFill(workspaceId),
    readHowRanked(env.DB, payload),
    payload === null ? [] : readBiggestSiteChanges(workspaceId, payload.period_start),
    openId !== null && payload !== null
      ? readWeekEvidence({ workspaceId, entityId: openId, since: payload.period_start })
      : null,
    payload === null ? readFirstLookRows(workspaceId) : [],
  ]);
  return { sources, siteFill, howRanked, moves, evidence, firstLook };
}

export async function readHomeReads(workspaceId: string | null, payload: BriefPayload | null, openId: string | null) {
  if (workspaceId !== null) return readWorkspaceReads(workspaceId, payload, openId);
  const howRanked = await readHowRanked(env.DB, payload);
  return { sources: [], siteFill: null, howRanked, moves: [], evidence: null, firstLook: [] };
}
