import { env } from "cloudflare:workers";

import type { CompetitorEntity } from "./data/entity.server";
import { readCompetitor, readCompetitorSocials } from "./data/entity.server";
import type { PeerRow } from "./data/standing.server";
import { readLatestPeers } from "./data/standing.server";
import type { SignalCount } from "./data/signal.server";
import { readEntityDevelopments, readScoredSignals, readSignalCounts } from "./data/signal.server";
import type { DevelopmentItem } from "./developments";
import type { EntitySource } from "./data/source.server";
import { readEntitySources } from "./data/source.server";
import type { StillCompetitorVerdict } from "./data/jev_verdict.server";
import { readLastStillCompetitor } from "./data/jev_verdict.server";
import type { SiteWatchSummary } from "./data/watch.server";
import { readSiteWatchSummary } from "./data/watch.server";
import type { SiteChangeView } from "./site-change";
import { daysBefore, readSiteChangeViews } from "./site-changes.server";
import { historyAnchor } from "./competitor-history";
import type { BiggestMoveView } from "./biggest-move";
import { biggestMoveView, pickBiggestMove, quietWeekSentence } from "./biggest-move";
import { captureLabel } from "./site-change";
import { weightsAsOf } from "./standing-score";
import { ALL_WEIGHTS, weightRows } from "./standing-score.server";

export interface CompetitorPage {
  competitor: CompetitorEntity;
  watch: SiteWatchSummary;
  changes: SiteChangeView[];
  developments: DevelopmentItem[];
  weekCount: number;
  biggestMove: BiggestMoveView | null;
  quiet: string;
  youtubeUrl: string | null;
  rail: {
    peers: readonly PeerRow[];
    facts: readonly SignalCount[];
    sources: readonly EntitySource[];
    verdict: StillCompetitorVerdict | null;
  };
}

const HISTORY_DAYS = 90;
const HISTORY_LIMIT = 30;
const FEED_LIMIT = 100;
const FACT_DAYS = 30;

export async function readCompetitorPage(
  workspaceId: string,
  entityId: string,
  now: Date,
): Promise<CompetitorPage | null> {
  const competitor = await readCompetitor(workspaceId, entityId);
  if (competitor === null) return null;
  const anchor = historyAnchor(competitor.state, competitor.stateChangedAt, now);
  const weekStart = daysBefore(anchor, 7);
  const [watch, changes, developments, peers, facts, sources, verdict, scored, weightResult, socials] =
    await Promise.all([
      readSiteWatchSummary(workspaceId, entityId),
      readSiteChangeViews({ workspaceId, entityId, since: daysBefore(anchor, HISTORY_DAYS), limit: HISTORY_LIMIT }),
      readEntityDevelopments({ workspaceId, entityId, since: daysBefore(now, HISTORY_DAYS), limit: FEED_LIMIT }),
      readLatestPeers(env.DB, workspaceId),
      readSignalCounts(workspaceId, entityId, daysBefore(now, FACT_DAYS)),
      readEntitySources(workspaceId, entityId),
      readLastStillCompetitor(workspaceId, entityId),
      readScoredSignals({ workspaceId, entityId, since: weekStart, until: anchor.toISOString() }),
      env.DB.prepare(ALL_WEIGHTS).all(),
      readCompetitorSocials(workspaceId, entityId),
    ]);
  const weights = weightsAsOf(weightRows.parse(weightResult.results), weekStart);
  const move = pickBiggestMove(scored, weights);
  return {
    competitor,
    watch,
    changes,
    developments,
    weekCount: changes.filter((change) => change.observedAt >= weekStart).length,
    biggestMove: move === null ? null : biggestMoveView(move, now),
    quiet: quietWeekSentence(
      [...new Set(sources.map((row) => row.source.platform))],
      watch.lastPolledAt === null ? null : captureLabel(watch.lastPolledAt),
    ),
    youtubeUrl: socials?.find((social) => social.platform === "youtube")?.url ?? null,
    rail: { peers, facts, sources, verdict },
  };
}
