import { env } from "cloudflare:workers";

import { fillSelfSiteFields, markSelfSiteFill } from "../data/entity.server";
import type { SiteFillState } from "../data/entity.server";
import { readEditedFields } from "../data/user_decision.server";
import { readSiteCard } from "./card.server";
import { normaliseSubject } from "./normalise";
import { probeKey } from "./probe-cache.server";

export async function siteWasReached(homepageUrl: string): Promise<boolean> {
  const normalised = normaliseSubject(homepageUrl);
  if (!normalised.ok) return true;
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
  const edited = await readEditedFields(entityId);
  await fillSelfSiteFields({
    workspaceId,
    entityId,
    description: edited.includes("description") ? null : card.description,
    socialsJson: JSON.stringify(card.socials),
  });
  return "filled";
}

export async function markSiteFill(workspaceId: string, entityId: string, state: SiteFillState): Promise<void> {
  await markSelfSiteFill(workspaceId, entityId, state);
}
