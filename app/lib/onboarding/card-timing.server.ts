import type { startCard } from "../identity/card.server";

import { markCardReady } from "../data/onboarding_run.server";

export function timeCard(
  workspaceId: string,
  card: ReturnType<typeof startCard>,
): ReturnType<typeof startCard> {
  return {
    site: card.site,
    logo: card.logo.then(async (logo) => {
      await Promise.allSettled([card.site]);
      await markCardReady(workspaceId, new Date().toISOString()).catch((error: unknown) => {
        console.error(
          JSON.stringify({
            event: "onboarding.card_ready_mark_failed",
            message: String(error),
          }),
        );
      });
      return logo;
    }),
  };
}
