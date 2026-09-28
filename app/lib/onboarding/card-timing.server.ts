import type { startCard } from "../identity/card.server";

import { markCardReady } from "../data/onboarding_run.server";

export function timeCard(
  workspaceId: string,
  card: ReturnType<typeof startCard>,
): ReturnType<typeof startCard> {
  return {
    site: card.site,
    logo: Promise.all([card.site, card.logo]).then(async ([, logo]) => {
      await markCardReady(workspaceId, new Date().toISOString());
      return logo;
    }),
  };
}
