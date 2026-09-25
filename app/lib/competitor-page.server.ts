import { env } from "cloudflare:workers";

import type { CompetitorEntity } from "./data/entity.server";
import { readCompetitor } from "./data/entity.server";
import type { PeerRow } from "./data/standing.server";
import { readLatestPeers } from "./data/standing.server";
import type { SignalCount } from "./data/signal.server";
import { readSignalCounts } from "./data/signal.server";
import type { EntitySource } from "./data/source.server";
import { readEntitySources } from "./data/source.server";
import type { StillCompetitorVerdict } from "./data/jev_verdict.server";
import { readLastStillCompetitor } from "./data/jev_verdict.server";
import type { SiteWatchSummary } from "./data/watch.server";
import { readSiteWatchSummary } from "./data/watch.server";
import type { SiteChangeView } from "./site-change";
import { daysBefore, readSiteChangeViews } from "./site-changes.server";
import { historyAnchor } from "./competitor-history";

export interface CompetitorPage {
  competitor: CompetitorEntity;
  watch: SiteWatchSummary;
  changes: SiteChangeView[];
  weekCount: number;
  biggestId: string | null;
  rail: {
    peers: readonly PeerRow[];
    facts: readonly SignalCount[];
    sources: readonly EntitySource[];
    verdict: StillCompetitorVerdict | null;
  };
}

const HISTORY_DAYS = 90;
const HISTORY_LIMIT = 30;
const FACT_DAYS = 30;

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
  const anchor = historyAnchor(competitor.state, competitor.stateChangedAt, now);
  const [watch, changes, peers, facts, sources, verdict] = await Promise.all([
    readSiteWatchSummary(workspaceId, entityId),
    readSiteChangeViews({ workspaceId, entityId, since: daysBefore(anchor, HISTORY_DAYS), limit: HISTORY_LIMIT }),
    readLatestPeers(env.DB, workspaceId),
    readSignalCounts(workspaceId, entityId, daysBefore(now, FACT_DAYS)),
    readEntitySources(workspaceId, entityId),
    readLastStillCompetitor(workspaceId, entityId),
  ]);
  const weekStart = daysBefore(anchor, 7);
  return {
    competitor,
    watch,
    changes,
    weekCount: changes.filter((change) => change.observedAt >= weekStart).length,
    biggestId: biggest(changes, weekStart)?.id ?? null,
    rail: { peers, facts, sources, verdict },
  };
}
