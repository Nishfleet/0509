import { env } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import { fillSelfSiteFields, markSelfSiteFill } from "../data/entity.server";
import type { SiteFillState } from "../data/entity.server";
import { readEditedFields } from "../data/user_decision.server";
import { readSiteCard } from "./card.server";
import { normaliseSubject } from "./normalise";
import { probeKey } from "./probe-cache.server";

function notInWorkspace(entityId: string, workspaceId: string): NonRetryableError {
  return new NonRetryableError(`self entity ${entityId} is not in workspace ${workspaceId}`);
}

export async function siteWasReached(homepageUrl: string): Promise<boolean> {
  const normalised = normaliseSubject(homepageUrl);
  if (!normalised.ok) return false;
  return (await env.IDENTITY_CACHE.get(probeKey(normalised.subject, "homepage"))) !== null;
}

export async function attemptSiteFill(
  workspaceId: string,
  entityId: string,
  homepageUrl: string,
): Promise<"filled" | "pending"> {
  const normalised = normaliseSubject(homepageUrl);
  if (!normalised.ok) return "pending";
  const { card, reached } = await readSiteCard(normalised.subject);
  if (!reached) return "pending";
  const edited = await readEditedFields(workspaceId, entityId);
  const filled = await fillSelfSiteFields({
    workspaceId,
    entityId,
    description: edited.includes("description") ? null : card.description,
    socialsJson: JSON.stringify(card.socials),
  });
  if (!filled) throw notInWorkspace(entityId, workspaceId);
  return "filled";
}

export async function markSiteFill(workspaceId: string, entityId: string, state: SiteFillState): Promise<void> {
  const marked = await markSelfSiteFill(workspaceId, entityId, state);
  if (!marked) throw notInWorkspace(entityId, workspaceId);
}
