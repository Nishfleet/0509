import { env } from "cloudflare:workers";

import {
  briefDisagrees,
  formatMovement,
  formatScore,
  suppressQuietWeek,
  type HomePanel,
  type HomeRead,
  type RankedBrand,
  type SourceHealth,
} from "../standing-present";
import { currentWeekStart, nextRolloverInstant, shiftWeek } from "../standing-score";

interface WorkspaceRow {
  id: string;
  timezone: string;
  brief_weekday: number;
  brief_hour: number;
  next_brief_at: string | null;
}

interface EntityRow {
  id: string;
  name: string | null;
  state: string;
  state_reason: string | null;
}

interface StandingRow {
  entity_id: string;
  week_start_at: string;
  score: number;
  rank: number | null;
  movement: number | null;
}

interface DigestRow {
  payload_json: string;
}

interface FreshnessRow {
  name: string;
  canary: number | null;
  last_fetched_at: string | null;
}

export async function loadHome(userId: string): Promise<HomePanel> {
  const workspace = await env.DB.prepare(
    `SELECT id, timezone, brief_weekday, brief_hour, next_brief_at
     FROM workspace WHERE owner_user_id = ? ORDER BY created_at LIMIT 1`,
  )
    .bind(userId)
    .first<WorkspaceRow>();
  if (!workspace) {
    return blank("gathering", "Setting up your workspace.", null);
  }
  const [entities, standing, digest, freshness] = await env.DB.batch([
    env.DB.prepare("SELECT id, name, state, state_reason FROM entity WHERE workspace_id = ?").bind(workspace.id),
    env.DB.prepare(
      `SELECT entity_id, week_start_at, score, rank, movement FROM standing
       WHERE workspace_id = ? ORDER BY week_start_at`,
    ).bind(workspace.id),
    env.DB.prepare(
      `SELECT payload_json FROM digest WHERE workspace_id = ? AND kind = 'weekly'
       ORDER BY period_start DESC LIMIT 1`,
    ).bind(workspace.id),
    env.DB.prepare(
      `SELECT src.platform AS name, json_extract(src.config_json, '$.canary') AS canary,
              MAX(sn.fetched_at) AS last_fetched_at
       FROM source AS src
       LEFT JOIN watch AS w ON w.source_id = src.id
       LEFT JOIN entity AS e ON e.id = w.entity_id AND e.workspace_id = ?
       LEFT JOIN snapshot AS sn ON sn.watch_id = w.id
       WHERE src.is_enabled = 1
       GROUP BY src.id`,
    ).bind(workspace.id),
  ]);
  const brands = (entities as D1Result<EntityRow>).results;
  const rows = (standing as D1Result<StandingRow>).results;
  const latestDigest = (digest as D1Result<DigestRow>).results[0];
  const sources = (freshness as D1Result<FreshnessRow>).results.map((row) => ({
    name: row.name,
    canary: typeof row.canary === "number" ? row.canary : null,
    lastFetchedAt: row.last_fetched_at,
  }));
  const on = brands.filter((brand) => brand.state === "on");
  const arrival = arrivalLabel(workspace);
  if (on.length < 2) {
    return {
      ...blank("empty", "add a competitor to see where you stand", arrival),
      freshness: freshnessLines(sources, workspace.timezone),
    };
  }
  if (rows.length === 0) {
    return {
      ...blank("gathering", "Gathering mentions, site changes, and ads.", arrival),
      freshness: freshnessLines(sources, workspace.timezone),
    };
  }
  return rankedHome(workspace, on, rows, latestDigest?.payload_json ?? null, sources);
}

function rankedHome(
  workspace: WorkspaceRow,
  on: EntityRow[],
  rows: StandingRow[],
  payloadRaw: string | null,
  sources: SourceHealth[],
): HomePanel {
  const names = new Map(on.map((brand) => [brand.id, brand.name ?? brand.id]));
  const weeks = expectedWeeks(workspace);
  const latest = weeks[weeks.length - 1] ?? "";
  const latestRows = rows.filter((row) => row.week_start_at === latest && names.has(row.entity_id));
  const ordered = [...latestRows].sort((a, b) => {
    if (a.rank !== null && b.rank !== null && a.rank !== b.rank) return a.rank - b.rank;
    return b.score - a.score;
  });
  const payload = readPayload(payloadRaw);
  const degraded = suppressQuietWeek(sources);
  const whyIsQuiet = payload?.isQuiet === true;
  const why = degraded && whyIsQuiet ? null : (payload?.whyLine ?? null);
  const standingRanks = ordered.flatMap((row) =>
    row.rank === null ? [] : [{ entityId: row.entity_id, rank: row.rank }],
  );
  return {
    phase: "ranked",
    message: null,
    arrival: arrivalLabel(workspace),
    brands: ordered.map((row) => ({
      entityId: row.entity_id,
      name: names.get(row.entity_id) ?? row.entity_id,
      rankLabel: row.rank === null ? "—" : `#${String(row.rank)} of ${String(ordered.length)}`,
      movement: row.rank === null ? "—" : formatMovement(row.movement),
      scoreLabel: formatScore(row.score),
    })),
    weeks: weeks.map((week) => localWhen(week, workspace.timezone)),
    series: on.map((brand) => ({
      entityId: brand.id,
      name: names.get(brand.id) ?? brand.id,
      scores: weeks.map((week) => {
        const found = rows.find((row) => row.entity_id === brand.id && row.week_start_at === week);
        return found ? found.score : null;
      }),
    })),
    why,
    whyIsJev: !degraded && payload?.whySource === "jev",
    updatedSinceBrief: payload ? briefDisagrees(payload.ranks, standingRanks) : false,
    readFirst: (payload?.readFirst ?? []).slice(0, 3),
    freshness: freshnessLines(sources, workspace.timezone),
    paused: (payload?.paused ?? []).map((row) => row.state_reason ?? `${row.name ?? "A brand"} paused`),
  };
}

function expectedWeeks(workspace: WorkspaceRow): string[] {
  let cursor = currentWeekStart(new Date(), workspace.timezone, workspace.brief_weekday, workspace.brief_hour);
  const weeks: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    weeks.push(cursor);
    cursor = shiftWeek(cursor, workspace.timezone, -7);
  }
  return weeks.reverse();
}

function arrivalLabel(workspace: WorkspaceRow): string {
  const iso =
    workspace.next_brief_at ??
    nextRolloverInstant(new Date(), workspace.timezone, workspace.brief_weekday, workspace.brief_hour);
  return localWhen(iso, workspace.timezone);
}

function freshnessLines(sources: SourceHealth[], timeZone: string): { name: string; line: string }[] {
  return sources.map((source) => {
    const when = source.lastFetchedAt ? localWhen(source.lastFetchedAt, timeZone) : "never";
    const line =
      source.canary === 0 ? `${source.name}: not answering since ${when}` : `${source.name}: last landed ${when}`;
    return { name: source.name, line };
  });
}

function localWhen(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone }).format(new Date(iso));
}

function blank(phase: HomePanel["phase"], message: string, arrival: string | null): HomePanel {
  return {
    phase,
    message,
    arrival,
    brands: [],
    weeks: [],
    series: [],
    why: null,
    whyIsJev: false,
    updatedSinceBrief: false,
    readFirst: [],
    freshness: [],
    paused: [],
  };
}

interface Payload {
  ranks: RankedBrand[];
  whyLine: string | null;
  whySource: string | null;
  isQuiet: boolean;
  readFirst: HomeRead[];
  paused: { name: string | null; state_reason: string | null }[];
}

function readPayload(raw: string | null): Payload | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const ranks = Array.isArray(record.brands)
      ? record.brands.flatMap((row) => {
          if (!row || typeof row !== "object") return [];
          const item = row as { entity_id?: unknown; rank?: unknown };
          if (typeof item.entity_id !== "string" || typeof item.rank !== "number") return [];
          return [{ entityId: item.entity_id, rank: item.rank }];
        })
      : [];
    const readFirst = Array.isArray(record.read_this_first)
      ? record.read_this_first.flatMap((row) => {
          if (!row || typeof row !== "object") return [];
          const item = row as {
            signal_id?: unknown;
            title?: unknown;
            evidence_url?: unknown;
            jev_reason?: unknown;
          };
          if (typeof item.signal_id !== "string") return [];
          return [
            {
              signalId: item.signal_id,
              title: typeof item.title === "string" && item.title.length > 0 ? item.title : item.signal_id,
              evidenceUrl: typeof item.evidence_url === "string" ? item.evidence_url : null,
              reason: typeof item.jev_reason === "string" && item.jev_reason.length > 0 ? item.jev_reason : null,
            },
          ];
        })
      : [];
    const paused = Array.isArray(record.paused)
      ? record.paused.flatMap((row) => {
          if (!row || typeof row !== "object") return [];
          const item = row as { name?: unknown; state_reason?: unknown };
          return [
            {
              name: typeof item.name === "string" ? item.name : null,
              state_reason: typeof item.state_reason === "string" ? item.state_reason : null,
            },
          ];
        })
      : [];
    return {
      ranks,
      whyLine: typeof record.why_line === "string" ? record.why_line : null,
      whySource: typeof record.why_source === "string" ? record.why_source : null,
      isQuiet: record.is_quiet_week === true,
      readFirst,
      paused,
    };
  } catch {
    return null;
  }
}
