import { env } from "cloudflare:workers";

import type { BriefPayload } from "../brief-payload";
import { readBriefPayload } from "../brief-payload";
import { readDeliveryFailures, readTakedownNotes } from "../data/alert.server";
import { readOnboardingCompetitors } from "../data/entity.server";
import type { SiteChangeView } from "../site-change";
import { daysBefore, readSiteChangeViews } from "../site-changes.server";
import type { AlertsResult, BriefResult, CompetitorsResult, StandingResult } from "./schemas";

const SELECT_LATEST_BRIEF = `SELECT payload_json FROM digest
WHERE workspace_id = ? AND kind = 'weekly'
ORDER BY period_end DESC
LIMIT 1`;

const SELECT_OFF_ENTITIES = `SELECT id FROM entity WHERE workspace_id = ? AND state = 'off'`;

function toBrief(payload: BriefPayload): NonNullable<BriefResult["brief"]> {
  return {
    periodStart: payload.period_start,
    periodEnd: payload.period_end,
    timezone: payload.timezone,
    headline: {
      rank: payload.headline_rank,
      of: payload.headline_total,
      movement: payload.headline_movement,
      isNew: payload.headline_is_new,
      why: payload.why_line,
    },
    quietWeek: payload.is_quiet_week,
    readThisFirst: payload.read_this_first.map((mark) => ({
      competitor: mark.entity_name,
      title: mark.title,
      source: mark.source,
      observedAt: mark.observed_at,
      url: mark.url,
      before: mark.before,
      after: mark.after,
      why: mark.jev_reason,
    })),
    standing: payload.brands.map((line) => ({
      competitorId: line.entity_id,
      name: line.name,
      rank: line.rank,
      movement: line.movement,
      isNew: line.is_new,
      biggestMove: line.biggest_move,
      newAds: line.ad_delta,
      newMentions: line.mention_delta,
      siteChanges: line.site_change_count,
    })),
    ownSite: {
      status: payload.own_site.status,
      incidents: payload.own_site.incidents.map((incident) => ({
        pageUrl: incident.page_url,
        kind: incident.kind,
        observedAt: incident.observed_at,
        open: incident.is_open,
      })),
    },
    checked: {
      mentions: payload.checked.mention_count,
      siteChanges: payload.checked.site_change_count,
      newAds: payload.checked.new_ad_count,
      sourcesDown: payload.checked.degraded_sources.map((source) => ({
        name: source.name ?? source.key,
        lastLandedAt: source.last_landed_at,
      })),
    },
    nextBriefAt: payload.next_brief_at,
  };
}

export async function readAgentBrief(workspaceId: string): Promise<BriefResult> {
  const row = await env.DB.prepare(SELECT_LATEST_BRIEF).bind(workspaceId).first<{ payload_json: string }>();
  const payload = row === null ? null : readBriefPayload(row.payload_json);
  return { brief: payload === null ? null : toBrief(payload) };
}

export async function readAgentCompetitors(workspaceId: string): Promise<CompetitorsResult> {
  const { on, maybes } = await readOnboardingCompetitors(workspaceId);
  return {
    tracked: on.map((row) => ({ id: row.entityId, name: row.name, domain: row.domain, reason: row.reason })),
    suggested: maybes.map((row) => ({ id: row.suggestionId, name: row.name, domain: row.domain, reason: row.reason })),
  };
}

export async function readAgentStanding(workspaceId: string): Promise<StandingResult> {
  const [{ brief }, off] = await Promise.all([
    readAgentBrief(workspaceId),
    env.DB.prepare(SELECT_OFF_ENTITIES).bind(workspaceId).all<{ id: string }>(),
  ]);
  if (brief === null) return { standing: null };
  const hidden = new Set(off.results.map((row) => row.id));
  return { standing: { ...brief.headline, lines: brief.standing.filter((line) => !hidden.has(line.competitorId)) } };
}

function changeBody(change: SiteChangeView): string {
  const { removed, added } = change.mark ?? { removed: null, added: null };
  const detail = [removed === null ? null : `Was: "${removed}"`, added === null ? null : `Now: "${added}"`]
    .filter((line) => line !== null)
    .join(" ");
  return [change.sentence, detail, change.url].filter((line) => line !== "").join(" ");
}

export async function readAgentAlerts(workspaceId: string): Promise<AlertsResult> {
  const [failures, notes, changes] = await Promise.all([
    readDeliveryFailures(env.DB, workspaceId),
    readTakedownNotes(env.DB, workspaceId),
    readSiteChangeViews({ workspaceId, entityId: null, since: daysBefore(new Date(), 30), limit: 30 }),
  ]);
  const alerts = [
    ...failures.map((row) => ({
      id: row.id,
      kind: "delivery_failed" as const,
      title: row.title,
      body: row.body,
      createdAt: row.created_at,
    })),
    ...notes.map((row) => ({ id: row.id, kind: "takedown" as const, title: row.title, body: null, createdAt: row.created_at })),
    ...changes.map((change) => ({
      id: change.id,
      kind: "site_change" as const,
      title: change.headline,
      body: changeBody(change),
      createdAt: change.observedAt,
    })),
  ];
  return { alerts: [...alerts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
}
