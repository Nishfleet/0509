import type { CompetitorEntity } from "./data/entity.server";
import { readCompetitor } from "./data/entity.server";
import type { SiteWatchSummary } from "./data/watch.server";
import { readSiteWatchSummary } from "./data/watch.server";
import type { SiteChangeView } from "./site-change";
import { daysBefore, readSiteChangeViews } from "./site-changes.server";

export interface CompetitorPage {
  competitor: CompetitorEntity;
  watch: SiteWatchSummary;
  changes: SiteChangeView[];
  weekCount: number;
  biggestId: string | null;
}

const HISTORY_DAYS = 90;
const HISTORY_LIMIT = 30;

function biggest(changes: readonly SiteChangeView[], since: string): SiteChangeView | null {
  return changes
    .filter((change) => change.observedAt >= since)
    .reduce<SiteChangeView | null>(
      (best, change) => (best === null || change.wordsChanged > best.wordsChanged ? change : best),
      null,
    );
}

export async function readCompetitorPage(
  workspaceId: string,
  entityId: string,
  now: Date,
): Promise<CompetitorPage | null> {
  const competitor = await readCompetitor(workspaceId, entityId);
  if (competitor === null) return null;
  const [watch, changes] = await Promise.all([
    readSiteWatchSummary(workspaceId, entityId),
    readSiteChangeViews({ workspaceId, entityId, since: daysBefore(now, HISTORY_DAYS), limit: HISTORY_LIMIT }),
  ]);
  const weekStart = daysBefore(now, 7);
  return {
    competitor,
    watch,
    changes,
    weekCount: changes.filter((change) => change.observedAt >= weekStart).length,
    biggestId: biggest(changes, weekStart)?.id ?? null,
  };
}
