import { markPageDeferred, readCompetitorsToClassify } from "../data/page.server";
import { classifyTailPages } from "../identity/tail.server";
import { ensureHomePages } from "./sweep.server";

const CLASSIFY_PER_SWEEP = 10;

export async function classifyCompetitorSites(now: string): Promise<number> {
  await ensureHomePages(now);
  const competitors = await readCompetitorsToClassify(CLASSIFY_PER_SWEEP, now);
  for (const competitor of competitors) {
    const read = await classifyTailPages(
      {
        workspaceId: competitor.workspaceId,
        entityId: competitor.entityId,
        name: competitor.name,
        domain: competitor.domain,
        homepageUrl: competitor.homepageUrl,
      },
      now,
    );
    if (!read) await markPageDeferred(competitor.homePageId, now);
  }
  return competitors.length;
}
