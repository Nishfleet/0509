import { z } from "zod";

import type { BriefPayload } from "../../app/lib/brief-payload";
import type { BriefSchedule, BriefWeek } from "../../app/lib/brief-schedule";
import { nextBriefAt } from "../../app/lib/brief-schedule";
import { sourceName } from "../../app/lib/source-name";
import { countPhrase } from "../delivery/brief-template";

const RANKED_BRANDS = `SELECT s.entity_id AS entity_id,
       COALESCE(e.name, e.domain) AS name,
       e.role AS role,
       s.rank AS rank,
       s.movement AS movement
FROM standing s
JOIN entity e ON e.id = s.entity_id AND e.workspace_id = s.workspace_id AND e.state = 'on'
WHERE s.workspace_id = ?1 AND s.week_start_at = ?2 AND s.rank IS NOT NULL
ORDER BY s.rank ASC, s.entity_id ASC`;

const PREVIOUS_FROZEN_WEEKS = `SELECT COUNT(*) AS weeks
FROM standing
WHERE workspace_id = ?1 AND rank IS NOT NULL AND week_start_at < ?2`;

const SIGNAL_COUNTS = `SELECT s.entity_id AS entity_id,
       SUM(CASE WHEN s.kind = 'ad' AND s.published_at >= ?2 AND s.published_at < ?3 THEN 1 ELSE 0 END) AS new_ads,
       SUM(CASE WHEN s.kind = 'mention' THEN 1 ELSE 0 END) AS mentions,
       SUM(CASE WHEN s.kind = 'change' THEN 1 ELSE 0 END) AS site_changes,
       SUM(CASE WHEN s.kind = 'hiring' THEN 1 ELSE 0 END) AS new_roles
FROM signal s
JOIN entity e ON e.id = s.entity_id AND e.workspace_id = ?1 AND e.state = 'on'
WHERE s.workspace_id = ?1 AND s.observed_at >= ?2 AND s.observed_at < ?3 AND s.is_tombstoned = 0
GROUP BY s.entity_id`;

const SOURCE_COVERAGE = `SELECT src.key AS key,
       src.kind AS kind,
       src.platform AS platform,
       MAX(sn.fetched_at) AS last_landed_at,
       MAX(CASE WHEN sn.fetched_at >= ?2 AND sn.fetched_at < ?3 THEN 1 ELSE 0 END) AS answered
FROM watch w
JOIN entity e ON e.id = w.entity_id AND e.workspace_id = ?1 AND e.state = 'on'
JOIN source src ON src.id = w.source_id AND src.is_enabled = 1
LEFT JOIN snapshot sn ON sn.watch_id = w.id
WHERE w.is_active = 1
GROUP BY src.key, src.kind, src.platform
ORDER BY src.key`;

const OWN_SITE_INCIDENTS = `SELECT p.url AS page_url, i.kind AS kind, i.opened_at AS opened_at, i.closed_at AS closed_at
FROM incident i
JOIN entity e ON e.id = i.entity_id AND e.role = 'self'
JOIN page p ON p.id = i.page_id
WHERE i.workspace_id = ?1 AND i.opened_at < ?3 AND (i.closed_at IS NULL OR i.closed_at >= ?2)
ORDER BY i.opened_at ASC`;

const PAUSED_COMPETITORS = `SELECT COALESCE(NULLIF(name, ''), domain) AS name
FROM entity
WHERE workspace_id = ?1 AND role = 'competitor' AND state = 'off' AND state_changed_at >= ?2 AND state_changed_at < ?3
ORDER BY state_changed_at ASC`;

const rankedBrandRows = z.array(
  z.object({
    entity_id: z.string(),
    name: z.string(),
    role: z.enum(["self", "competitor"]),
    rank: z.number().int(),
    movement: z.number().int().nullable(),
  }),
);

const frozenWeekRows = z.array(z.object({ weeks: z.number().int() }));

const signalCountRows = z.array(
  z.object({
    entity_id: z.string(),
    new_ads: z.number().int(),
    mentions: z.number().int(),
    site_changes: z.number().int(),
    new_roles: z.number().int(),
  }),
);

const sourceCoverageRows = z.array(
  z.object({
    key: z.string(),
    kind: z.string(),
    platform: z.string(),
    last_landed_at: z.string().nullable(),
    answered: z.number().int(),
  }),
);

const incidentRows = z.array(
  z.object({
    page_url: z.string(),
    kind: z.string(),
    opened_at: z.string(),
    closed_at: z.string().nullable(),
  }),
);

const pausedCompetitorRows = z.array(z.object({ name: z.string() }));

export interface ComposeInput {
  workspaceId: string;
  schedule: BriefSchedule;
  week: BriefWeek;
}

function quietWeekLine(mentions: number, siteChanges: number, newAds: number): string {
  return `Quiet week: ${countPhrase(mentions, "mention", "mentions")} checked, ${countPhrase(siteChanges, "site change", "site changes")}, ${countPhrase(newAds, "new ad", "new ads")}.`;
}

export function pausedSentence(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} paused, so every brand below it moved up.`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} paused, so every brand below them moved up.`;
}

export async function composeBrief(db: D1Database, input: ComposeInput): Promise<BriefPayload> {
  const startsAt = input.week.startsAt.toISOString();
  const closesAt = input.week.closesAt.toISOString();
  const [ranked, frozen, counts, coverage, incidents, pausedRows] = await db.batch([
    db.prepare(RANKED_BRANDS).bind(input.workspaceId, startsAt),
    db.prepare(PREVIOUS_FROZEN_WEEKS).bind(input.workspaceId, startsAt),
    db.prepare(SIGNAL_COUNTS).bind(input.workspaceId, startsAt, closesAt),
    db.prepare(SOURCE_COVERAGE).bind(input.workspaceId, startsAt, closesAt),
    db.prepare(OWN_SITE_INCIDENTS).bind(input.workspaceId, startsAt, closesAt),
    db.prepare(PAUSED_COMPETITORS).bind(input.workspaceId, startsAt, closesAt),
  ]);

  const brands = rankedBrandRows.parse(ranked.results);
  const hadPreviousWeek = frozenWeekRows.parse(frozen.results).some((row) => row.weeks > 0);
  const countsByEntity = new Map(
    signalCountRows.parse(counts.results).map((row) => [row.entity_id, row]),
  );
  const sources = sourceCoverageRows.parse(coverage.results);
  const ownSite = incidentRows.parse(incidents.results);
  const pausedNames = pausedCompetitorRows.parse(pausedRows.results).map((row) => row.name);

  const lines = brands.map((brand) => {
    const count = countsByEntity.get(brand.entity_id);
    return {
      entity_id: brand.entity_id,
      name: brand.name,
      rank: brand.rank,
      movement: brand.movement,
      is_new: hadPreviousWeek && brand.movement === null,
      biggest_move: null,
      ad_delta: count?.new_ads ?? 0,
      mention_delta: count?.mentions ?? 0,
      site_change_count: count?.site_changes ?? 0,
      new_roles: count?.new_roles ?? 0,
    };
  });
  const mentionCount = lines.reduce((total, line) => total + line.mention_delta, 0);
  const siteChangeCount = lines.reduce((total, line) => total + line.site_change_count, 0);
  const newAdCount = lines.reduce((total, line) => total + line.ad_delta, 0);
  const selfId = brands.find((brand) => brand.role === "self")?.entity_id;
  const self = lines.find((line) => line.entity_id === selfId);
  const degraded = sources.filter((source) => source.answered === 0);

  const pausedLine = pausedSentence(pausedNames);
  const countsLine = quietWeekLine(mentionCount, siteChangeCount, newAdCount);

  return {
    workspace_id: input.workspaceId,
    timezone: input.schedule.timezone,
    period_start: startsAt,
    period_end: closesAt,
    headline_rank: self?.rank ?? null,
    headline_total: lines.length,
    headline_movement: self?.movement ?? null,
    headline_is_new: self?.is_new ?? false,
    why_line: pausedLine === null ? countsLine : `${countsLine} ${pausedLine}`,
    is_quiet_week: true,
    read_this_first: [],
    brands: lines,
    own_site: {
      status: ownSite.length === 0 ? "ok" : "broken",
      incidents: ownSite.map((incident) => {
        const isOpen = incident.closed_at === null || incident.closed_at >= closesAt;
        return {
          page_url: incident.page_url,
          kind: incident.kind,
          observed_at: isOpen || incident.closed_at === null ? closesAt : incident.closed_at,
          is_open: isOpen,
        };
      }),
    },
    checked: {
      mention_count: mentionCount,
      site_change_count: siteChangeCount,
      new_ad_count: newAdCount,
      source_keys: sources.map((source) => source.key),
      degraded_source_keys: degraded.map((source) => source.key),
      degraded_sources: degraded.map((source) => ({
        key: source.key,
        name: sourceName(source.kind, source.platform),
        last_landed_at: source.last_landed_at,
      })),
    },
    next_brief_at: nextBriefAt(input.schedule, input.week.closesAt).toISOString(),
  };
}
