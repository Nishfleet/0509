import { env } from "cloudflare:workers";

import { fillSelfSiteFields, markSelfSiteFill } from "../data/entity.server";
import type { SiteFillState } from "../data/entity.server";
import { readSiteCard } from "./card.server";
import { normaliseSubject } from "./normalise";
import { probeKey } from "./probe-cache.server";

export async function siteWasReached(homepageUrl: string): Promise<boolean> {
  const normalised = normaliseSubject(homepageUrl);
  if (!normalised.ok) return true;
  return (await env.IDENTITY_CACHE.get(probeKey(normalised.subject, "homepage"))) !== null;
}

export async function attemptSiteFill(entityId: string, homepageUrl: string): Promise<"filled" | "pending"> {
  const normalised = normaliseSubject(homepageUrl);
  if (!normalised.ok) return "pending";
  const { card, reached } = await readSiteCard(normalised.subject);
  if (!reached) return "pending";
  await fillSelfSiteFields({ entityId, description: card.description, socialsJson: JSON.stringify(card.socials) });
  return "filled";
}

export async function markSiteFill(entityId: string, state: SiteFillState): Promise<void> {
  await markSelfSiteFill(entityId, state);
}
