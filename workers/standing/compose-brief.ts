import { z } from "zod";

import type { BriefPayload } from "../../app/lib/brief-payload";
import type { BriefSchedule, BriefWeek } from "../../app/lib/brief-schedule";
import { nextBriefAt } from "../../app/lib/brief-schedule";
import { UNJUDGED_WEEK_LINE, readThisFirstLine } from "../../app/lib/read-this-first";
import { effectiveKindSql } from "../../app/lib/source-kind";
import { sourceName } from "../../app/lib/source-name";
import { countPhrase } from "../delivery/brief-template";
import type { JudgedWeek } from "./read-this-first";
import { required } from "../../app/lib/required";

const RANKED_BRANDS = `SELECT s.entity_id AS entity_id,
       COALESCE(e.name, e.domain) AS name,
       e.role AS role,
       s.rank AS rank,
       s.movement AS movement
FROM standing s
JOIN entity e ON e.id = s.entity_id AND e.workspace_id = s.workspace_id AND e.state = 'on'
WHERE s.workspace_id = ?1 AND s.week_start_at = ?2
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
WHERE s.workspace_id = ?1 AND s.observed_at >= ?2 AND s.observed_at < ?3 AND s.is_tombstoned = 0 AND s.duplicate_of IS NULL
GROUP BY s.entity_id`;

const SOURCE_COVERAGE = `SELECT src.key AS key,
       ${effectiveKindSql("src")} AS kind,
       src.platform AS platform,
       MAX(CASE WHEN COALESCE(sn.canary_count, 1) > 0 THEN sn.fetched_at END) AS last_landed_at,
       MAX(CASE WHEN sn.fetched_at >= ?2 AND sn.fetched_at < ?3 AND COALESCE(sn.canary_count, 1) > 0 THEN 1 ELSE 0 END) AS answered
FROM watch w
JOIN entity e ON e.id = w.entity_id AND e.workspace_id = ?1 AND e.state = 'on'
JOIN source src ON src.id = w.source_id AND src.is_enabled = 1
LEFT JOIN snapshot sn ON sn.watch_id = w.id
WHERE w.is_active = 1
GROUP BY src.key, kind, src.platform
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

const PICKED_SIGNALS = `SELECT s.id AS signal_id, s.entity_id AS entity_id, COALESCE(NULLIF(e.name, ''), e.domain) AS entity_name,
       s.title AS title, s.summary AS summary, s.url AS url, s.observed_at AS observed_at,
       ${effectiveKindSql("src")} AS source_kind, src.platform AS source_platform,
       (SELECT v.reason FROM jev_verdict v WHERE v.signal_id = s.id AND v.question_id IN ('noteworthy_change', 'mention_matters') AND v.reason IS NOT NULL ORDER BY v.decided_at DESC LIMIT 1) AS verdict_reason
FROM signal s
JOIN entity e ON e.id = s.entity_id AND e.workspace_id = ?1
JOIN source src ON src.id = s.source_id
WHERE s.workspace_id = ?1 AND s.id IN (SELECT value FROM json_each(?2))`;

const rankedBrandRows = z.array(
  z.object({
    entity_id: z.string(),
    name: z.string(),
    role: z.enum(["self", "competitor"]),
    rank: z.number().int().nullable(),
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

const pickedSignalRows = z.array(
  z.object({
    signal_id: z.string(),
    entity_id: z.string(),
    entity_name: z.string(),
    title: z.string().nullable(),
    summary: z.string().nullable(),
    url: z.string().nullable(),
    observed_at: z.string(),
    source_kind: z.string(),
    source_platform: z.string(),
    verdict_reason: z.string().nullable(),
  }),
);

export interface ComposeInput {
  workspaceId: string;
  schedule: BriefSchedule;
  week: BriefWeek;
  readThisFirst: JudgedWeek;
}

function quietWeekLine(mentions: number, siteChanges: number, newAds: number): string {
  return `Quiet week: ${countPhrase(mentions, "mention", "mentions")}, ${countPhrase(siteChanges, "site change", "site changes")}, ${countPhrase(newAds, "new ad", "new ads")}.`;
}

export function pausedSentence(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const last = required(names.at(-1), "compose-brief.paused-names");
  if (names.length === 1) return `${last} paused, so every brand below it moved up.`;
  return `${names.slice(0, -1).join(", ")} and ${last} paused, so every brand below them moved up.`;
}

type RankedBrand = z.infer<typeof rankedBrandRows>[number];
type SignalCount = z.infer<typeof signalCountRows>[number];
type SourceCoverage = z.infer<typeof sourceCoverageRows>[number];
type OwnSiteIncident = z.infer<typeof incidentRows>[number];
type PickedSignal = z.infer<typeof pickedSignalRows>[number];

async function loadBriefRows(db: D1Database, input: ComposeInput) {
  const startsAt = input.week.startsAt.toISOString();
  const closesAt = input.week.closesAt.toISOString();
  const [ranked, frozen, counts, coverage, incidents, pausedRows, pickedRows] = await db.batch([
    db.prepare(RANKED_BRANDS).bind(input.workspaceId, startsAt),
    db.prepare(PREVIOUS_FROZEN_WEEKS).bind(input.workspaceId, startsAt),
    db.prepare(SIGNAL_COUNTS).bind(input.workspaceId, startsAt, closesAt),
    db.prepare(SOURCE_COVERAGE).bind(input.workspaceId, startsAt, closesAt),
    db.prepare(OWN_SITE_INCIDENTS).bind(input.workspaceId, startsAt, closesAt),
    db.prepare(PAUSED_COMPETITORS).bind(input.workspaceId, startsAt, closesAt),
    db.prepare(PICKED_SIGNALS).bind(input.workspaceId, JSON.stringify(input.readThisFirst.picks)),
  ]);
  return {
    brands: rankedBrandRows.parse(required(ranked, "compose-brief.ranked").results),
    hadPreviousWeek: frozenWeekRows
      .parse(required(frozen, "compose-brief.frozen").results)
      .some((row) => row.weeks > 0),
    countsByEntity: new Map(
      signalCountRows.parse(required(counts, "compose-brief.counts").results).map((row) => [row.entity_id, row]),
    ),
    sources: sourceCoverageRows.parse(required(coverage, "compose-brief.coverage").results),
    ownSite: incidentRows.parse(required(incidents, "compose-brief.incidents").results),
    pausedNames: pausedCompetitorRows
      .parse(required(pausedRows, "compose-brief.pausedRows").results)
      .map((row) => row.name),
    pickedById: new Map(
      pickedSignalRows
        .parse(required(pickedRows, "compose-brief.pickedRows").results)
        .map((row) => [row.signal_id, row]),
    ),
  };
}

function buildMarks(picks: readonly string[], pickedById: ReadonlyMap<string, PickedSignal>) {
  return picks.flatMap((signalId) => {
    const row = pickedById.get(signalId);
    if (row === undefined) return [];
    return [
      {
        signal_id: row.signal_id,
        entity_id: row.entity_id,
        entity_name: row.entity_name,
        title: row.title ?? "",
        source: sourceName(row.source_kind, row.source_platform),
        observed_at: row.observed_at,
        thumbnail_r2_key: null,
        url: row.url ?? "",
        before: null,
        after: null,
        jev_reason: row.verdict_reason ?? row.summary ?? row.title ?? "",
      },
    ];
  });
}

function buildLines(
  brands: readonly RankedBrand[],
  countsByEntity: ReadonlyMap<string, SignalCount>,
  hadPreviousWeek: boolean,
) {
  return brands.map((brand) => {
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
}

function buildOwnSite(ownSite: readonly OwnSiteIncident[], closesAt: string) {
  return {
    status: ownSite.length === 0 ? ("ok" as const) : ("broken" as const),
    incidents: ownSite.map((incident) => {
      const isOpen = incident.closed_at === null || incident.closed_at >= closesAt;
      return {
        page_url: incident.page_url,
        kind: incident.kind,
        observed_at: isOpen || incident.closed_at === null ? closesAt : incident.closed_at,
        is_open: isOpen,
      };
    }),
  };
}

interface CheckedTotals {
  mentions: number;
  siteChanges: number;
  newAds: number;
}

function buildChecked(sources: readonly SourceCoverage[], totals: CheckedTotals) {
  const degraded = sources.filter((source) => source.answered === 0);
  return {
    mention_count: totals.mentions,
    site_change_count: totals.siteChanges,
    new_ad_count: totals.newAds,
    source_keys: sources.map((source) => source.key),
    degraded_source_keys: degraded.map((source) => source.key),
    degraded_sources: degraded.map((source) => ({
      key: source.key,
      name: sourceName(source.kind, source.platform),
      last_landed_at: source.last_landed_at,
    })),
  };
}

function buildHeadLine(
  readThisFirst: JudgedWeek,
  marks: readonly { entity_name: string }[],
  totals: CheckedTotals,
): string {
  if (readThisFirst.unjudged) return UNJUDGED_WEEK_LINE;
  const lead = marks[0];
  if (lead === undefined) return quietWeekLine(totals.mentions, totals.siteChanges, totals.newAds);
  return readThisFirstLine(marks.length, readThisFirst.judged, lead.entity_name);
}

export async function composeBrief(db: D1Database, input: ComposeInput): Promise<BriefPayload> {
  const startsAt = input.week.startsAt.toISOString();
  const closesAt = input.week.closesAt.toISOString();
  const { readThisFirst } = input;
  const rows = await loadBriefRows(db, input);

  const marks = buildMarks(readThisFirst.picks, rows.pickedById);
  const lines = buildLines(rows.brands, rows.countsByEntity, rows.hadPreviousWeek);
  const totals: CheckedTotals = {
    mentions: lines.reduce((total, line) => total + line.mention_delta, 0),
    siteChanges: lines.reduce((total, line) => total + line.site_change_count, 0),
    newAds: lines.reduce((total, line) => total + line.ad_delta, 0),
  };
  const selfId = rows.brands.find((brand) => brand.role === "self")?.entity_id;
  const self = lines.find((line) => line.entity_id === selfId);

  const pausedLine = pausedSentence(rows.pausedNames);
  const headLine = buildHeadLine(readThisFirst, marks, totals);

  return {
    workspace_id: input.workspaceId,
    timezone: input.schedule.timezone,
    period_start: startsAt,
    period_end: closesAt,
    headline_rank: self?.rank ?? null,
    headline_total: lines.length,
    headline_movement: self?.movement ?? null,
    headline_is_new: self?.is_new ?? false,
    why_line: pausedLine === null ? headLine : `${headLine} ${pausedLine}`,
    is_quiet_week: marks.length === 0 && !readThisFirst.unjudged,
    is_unjudged: readThisFirst.unjudged,
    read_this_first: marks,
    brands: lines,
    own_site: buildOwnSite(rows.ownSite, closesAt),
    checked: buildChecked(rows.sources, totals),
    next_brief_at: nextBriefAt(input.schedule, input.week.closesAt).toISOString(),
  };
}
