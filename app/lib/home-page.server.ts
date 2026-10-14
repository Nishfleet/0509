import { env } from "cloudflare:workers";

import type { BriefPayload } from "./brief-payload";
import { readSelfSiteFill } from "./data/entity.server";
import { readFirstLook } from "./data/first_look.server";
import { readFewRivals } from "./data/rival_nudge.server";
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

async function readWorkspaceReads(workspaceId: string, payload: BriefPayload | null, openId: string | null) {
  const [sources, siteFill, howRanked, moves, evidence, firstLook, fewRivals] = await Promise.all([
    readWorkspaceMentionSources(workspaceId),
    readSelfSiteFill(workspaceId),
    readHowRanked(env.DB, payload),
    payload === null ? [] : readBiggestSiteChanges(workspaceId, payload.period_start),
    openId !== null && payload !== null
      ? readWeekEvidence({ workspaceId, entityId: openId, since: payload.period_start })
      : null,
    payload === null ? readFirstLook(workspaceId).then((rivals) => firstLookRows(rivals, new Date())) : [],
    readFewRivals(env.DB, workspaceId, new Date()),
  ]);
  return { sources, siteFill, howRanked, moves, evidence, firstLook, fewRivals };
}

export async function readHomeReads(workspaceId: string | null, payload: BriefPayload | null, openId: string | null) {
  if (workspaceId !== null) return readWorkspaceReads(workspaceId, payload, openId);
  const howRanked = await readHowRanked(env.DB, payload);
  return { sources: [], siteFill: null, howRanked, moves: [], evidence: null, firstLook: [], fewRivals: null };
}
