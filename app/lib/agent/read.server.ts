import { env } from "cloudflare:workers";

import type { BriefPayload } from "../brief-payload";
import { readBriefPayload } from "../brief-payload";
import { readCompetitorPage } from "../competitor-page.server";
import { readDeliveryFailures, readTakedownNotes } from "../data/alert.server";
import { readOnboardingCompetitors } from "../data/entity.server";
import { readMentionFeed } from "../data/mention.server";
import { PENDING_LINE, POSSIBLY_LINE, showInFeed, UNREVIEWED_LINE, type MentionRowModel } from "../mention-feed";
import type { SiteChangeView } from "../site-change";
import { daysBefore, readSiteChangeViews } from "../site-changes.server";
import type { AlertsResult, BriefResult, CompetitorResult, CompetitorsResult, StandingResult } from "./schemas";

const SELECT_LATEST_BRIEF = `SELECT payload_json FROM digest
WHERE workspace_id = ? AND kind = 'weekly'
ORDER BY period_end DESC
LIMIT 1`;

const SELECT_OFF_ENTITIES = `SELECT id FROM entity WHERE workspace_id = ? AND state = 'off'`;

async function offEntityIds(workspaceId: string): Promise<Set<string>> {
  const off = await env.DB.prepare(SELECT_OFF_ENTITIES).bind(workspaceId).all<{ id: string }>();
  return new Set(off.results.map((row) => row.id));
}

function hideOffBrands(payload: BriefPayload, hidden: Set<string>): BriefPayload {
  return {
    ...payload,
    brands: payload.brands.filter((line) => !hidden.has(line.entity_id)),
    read_this_first: payload.read_this_first.filter((mark) => !hidden.has(mark.entity_id)),
  };
}

function briefReadFirst(payload: BriefPayload): NonNullable<BriefResult["brief"]>["readThisFirst"] {
  return payload.read_this_first.map((mark) => ({
    competitor: mark.entity_name,
    title: mark.title,
    source: mark.source,
    observedAt: mark.observed_at,
    url: mark.url,
    before: mark.before,
    after: mark.after,
    why: mark.jev_reason,
  }));
}

function briefStanding(payload: BriefPayload): NonNullable<BriefResult["brief"]>["standing"] {
  return payload.brands.map((line) => ({
    competitorId: line.entity_id,
    name: line.name,
    rank: line.rank,
    movement: line.movement,
    isNew: line.is_new,
    biggestMove: line.biggest_move,
    newAds: line.ad_delta,
    newMentions: line.mention_delta,
    siteChanges: line.site_change_count,
  }));
}

function toBrief(payload: BriefPayload, hidden: Set<string>): NonNullable<BriefResult["brief"]> {
  const visible = hideOffBrands(payload, hidden);
  return {
    periodStart: visible.period_start,
    periodEnd: visible.period_end,
    timezone: visible.timezone,
    headline: {
      rank: visible.headline_rank,
      of: visible.headline_total,
      movement: visible.headline_movement,
      isNew: visible.headline_is_new,
      why: visible.why_line,
    },
    quietWeek: visible.is_quiet_week,
    readThisFirst: briefReadFirst(visible),
    standing: briefStanding(visible),
    ownSite: {
      status: visible.own_site.status,
      incidents: visible.own_site.incidents.map((incident) => ({
        pageUrl: incident.page_url,
        kind: incident.kind,
        observedAt: incident.observed_at,
        open: incident.is_open,
      })),
    },
    checked: {
      mentions: visible.checked.mention_count,
      siteChanges: visible.checked.site_change_count,
      newAds: visible.checked.new_ad_count,
      sourcesDown: visible.checked.degraded_sources.map((source) => ({
        name: source.name ?? source.key,
        lastLandedAt: source.last_landed_at,
      })),
    },
    nextBriefAt: visible.next_brief_at,
  };
}

export async function readAgentBrief(workspaceId: string): Promise<BriefResult> {
  const [row, hidden] = await Promise.all([
    env.DB.prepare(SELECT_LATEST_BRIEF).bind(workspaceId).first<{ payload_json: string }>(),
    offEntityIds(workspaceId),
  ]);
  const payload = row === null ? null : readBriefPayload(row.payload_json);
  return { brief: payload === null ? null : toBrief(payload, hidden) };
}

export async function readAgentCompetitors(workspaceId: string): Promise<CompetitorsResult> {
  const { on, maybes } = await readOnboardingCompetitors(workspaceId);
  return {
    tracked: on.map((row) => ({ id: row.entityId, name: row.name, domain: row.domain, reason: row.reason })),
    suggested: maybes.map((row) => ({ id: row.suggestionId, name: row.name, domain: row.domain, reason: row.reason })),
  };
}

export async function readAgentStanding(workspaceId: string): Promise<StandingResult> {
  const { brief } = await readAgentBrief(workspaceId);
  if (brief === null) return { standing: null };
  return { standing: { ...brief.headline, lines: brief.standing } };
}

function changeBody(change: SiteChangeView): string {
  const { removed, added } = change.mark ?? { removed: null, added: null };
  const detail = [removed === null ? null : `Was: "${removed}"`, added === null ? null : `Now: "${added}"`]
    .filter((line) => line !== null)
    .join(" ");
  return [change.sentence, detail, change.url].filter((line) => line !== "").join(" ");
}

export async function readAgentCompetitor(
  workspaceId: string,
  competitorId: string,
  now: Date,
): Promise<CompetitorResult> {
  const [page, hidden] = await Promise.all([
    readCompetitorPage(workspaceId, competitorId, now),
    offEntityIds(workspaceId),
  ]);
  if (page === null || hidden.has(competitorId)) return { competitor: null };
  return {
    competitor: {
      id: page.competitor.id,
      name: page.competitor.name,
      domain: page.competitor.domain,
      state: page.competitor.state,
      stateChangedAt: page.competitor.stateChangedAt,
      pagesWatched: page.watch.pages,
      lastCheckedAt: page.watch.lastPolledAt,
      changesThisWeek: page.weekCount,
      changes: page.changes.map((change) => ({
        id: change.id,
        headline: change.headline,
        page: change.page,
        url: change.url,
        observedAt: change.observedAt,
        summary: changeBody(change),
      })),
    },
  };
}

const MENTION_LINES: Partial<Record<MentionRowModel["treatment"], string>> = {
  possibly: POSSIBLY_LINE,
  unreviewed: UNREVIEWED_LINE,
  pending: PENDING_LINE,
};

function mentionBody(mention: MentionRowModel): string {
  return [MENTION_LINES[mention.treatment], mention.sourceName, mention.url]
    .filter((part) => part !== undefined && part !== "")
    .join(" ");
}

export async function readAgentAlerts(workspaceId: string): Promise<AlertsResult> {
  const now = new Date();
  const [failures, notes, changes, mentions] = await Promise.all([
    readDeliveryFailures(env.DB, workspaceId),
    readTakedownNotes(env.DB, workspaceId),
    readSiteChangeViews({ workspaceId, entityId: null, since: daysBefore(now, 30), limit: 30 }),
    readMentionFeed(workspaceId, now),
  ]);
  const alerts = [
    ...failures.map((row) => ({
      id: row.id,
      kind: "delivery_failed" as const,
      title: row.title,
      body: row.body,
      createdAt: row.created_at,
    })),
    ...notes.map((row) => ({
      id: row.id,
      kind: "takedown" as const,
      title: row.title,
      body: null,
      createdAt: row.created_at,
    })),
    ...changes.map((change) => ({
      id: change.id,
      kind: "site_change" as const,
      title: change.headline,
      body: changeBody(change),
      createdAt: change.observedAt,
    })),
    ...mentions
      .filter((mention) => showInFeed({ kind: "mention", mention }, false))
      .map((mention) => ({
        id: mention.id,
        kind: "mention" as const,
        title: mention.title,
        body: mentionBody(mention),
        createdAt: mention.publishedAt ?? mention.observedAt,
      })),
  ];
  return { alerts: [...alerts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
}
