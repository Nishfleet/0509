import { readCompetitorsToClassify } from "../data/page.server";
import { classifyTailPages } from "../identity/tail.server";
import { ensureHomePages } from "./sweep.server";

const CLASSIFY_PER_SWEEP = 10;

export async function classifyCompetitorSites(now: string): Promise<number> {
  await ensureHomePages(now);
  const competitors = await readCompetitorsToClassify(CLASSIFY_PER_SWEEP);
  for (const competitor of competitors) {
    await classifyTailPages(
      {
        workspaceId: competitor.workspaceId,
        entityId: competitor.entityId,
        name: competitor.name,
        domain: competitor.domain,
        homepageUrl: competitor.homepageUrl,
      },
      now,
    );
  }
  return competitors.length;
}
