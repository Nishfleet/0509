
interface BriefMark {
  signal_id: string;
  entity_id: string;
  entity_name: string;
  title: string;
  source: string;
  observed_at: string;
  thumbnail_r2_key: string | null;
  url: string;
  before: string | null;
  after: string | null;
  jev_reason: string;
}

interface BriefBrandLine {
  entity_id: string;
  name: string;
  rank: number | null;
  movement: number | null;
  is_new: boolean;
  biggest_move: string | null;
  ad_delta: number;
  mention_delta: number;
  site_change_count: number;
}

interface BriefOwnSite {
  status: "ok" | "broken";
  incidents: {
    page_url: string;
    kind: string;
    observed_at: string;
    is_open: boolean;
  }[];
}

interface BriefDegradedSource {
  key: string;
  last_landed_at: string | null;
}

interface BriefChecked {
  mention_count: number;
  site_change_count: number;
  new_ad_count: number;
  source_keys: string[];
  degraded_source_keys: string[];
  degraded_sources: BriefDegradedSource[];
}

export interface BriefPayload {
  workspace_id: string;
  timezone: string;
  period_start: string;
  period_end: string;
  headline_rank: number | null;
  headline_total: number;
  headline_movement: number | null;
  headline_is_new: boolean;
  why_line: string;
  is_quiet_week: boolean;
  read_this_first: BriefMark[];
  brands: BriefBrandLine[];
  own_site: BriefOwnSite;
  checked: BriefChecked;
  next_brief_at: string | null;
}

export interface BriefContext {
  unsubscribe_url: string | null;
  asset_base_url: string | null;
}

export interface RenderedBrief {
  subject: string;
  html: string;
  text: string;
}

export const BRAND_LINES_QUERY = `
  SELECT s.entity_id AS entity_id,
         e.name      AS name,
         s.rank      AS rank,
         s.movement  AS movement
    FROM standing s
    JOIN entity e ON e.id = s.entity_id AND e.workspace_id = s.workspace_id
   WHERE s.workspace_id = ?1
     AND s.week_start_at = ?2
     AND e.state = 'on'
     AND s.rank IS NOT NULL
   ORDER BY s.rank ASC, s.entity_id ASC
`.trim();

export function parseBriefPayload(payloadJson: string): BriefPayload {
  const parsed: unknown = JSON.parse(payloadJson);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("digest.payload_json is not an object");
  }
  const p = parsed as Record<string, unknown>;

  const requireString = (key: string): string => {
    const value = p[key];
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`digest.payload_json is missing a string ${key}`);
    }
    return value;
  };
  const optionalString = (key: string): string | null => {
    const value = p[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  };
  const numberOrNull = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

  const list = (key: string): unknown[] => {
    const value = p[key];
    return Array.isArray(value) ? value : [];
  };

  const brands: BriefBrandLine[] = list("brands").flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [];
    const b = raw as Record<string, unknown>;
    if (typeof b.entity_id !== "string") return [];
    return [
      {
        entity_id: b.entity_id,
        name: typeof b.name === "string" && b.name.length > 0 ? b.name : b.entity_id,
        rank: numberOrNull(b.rank),
        movement: numberOrNull(b.movement),
        is_new: b.is_new === true,
        biggest_move: typeof b.biggest_move === "string" ? b.biggest_move : null,
        ad_delta: numberOrNull(b.ad_delta) ?? 0,
        mention_delta: numberOrNull(b.mention_delta) ?? 0,
        site_change_count: numberOrNull(b.site_change_count) ?? 0,
      },
    ];
  });

  const readThisFirst: BriefMark[] = list("read_this_first").flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [];
    const m = raw as Record<string, unknown>;
    if (typeof m.signal_id !== "string" || typeof m.jev_reason !== "string") return [];
    return [
      {
        signal_id: m.signal_id,
        entity_id: typeof m.entity_id === "string" ? m.entity_id : "",
        entity_name: typeof m.entity_name === "string" ? m.entity_name : "",
        title: typeof m.title === "string" ? m.title : "",
        source: typeof m.source === "string" ? m.source : "",
        observed_at: typeof m.observed_at === "string" ? m.observed_at : "",
        thumbnail_r2_key: typeof m.thumbnail_r2_key === "string" ? m.thumbnail_r2_key : null,
        url: typeof m.url === "string" ? m.url : "",
        before: typeof m.before === "string" ? m.before : null,
        after: typeof m.after === "string" ? m.after : null,
        jev_reason: m.jev_reason,
      },
    ];
  });

  const ownRaw = p.own_site;
  const own = typeof ownRaw === "object" && ownRaw !== null ? (ownRaw as Record<string, unknown>) : {};
  const ownIncidents = Array.isArray(own.incidents) ? own.incidents : [];
  const ownSite: BriefOwnSite = {
    status: own.status === "broken" ? "broken" : "ok",
    incidents: ownIncidents.flatMap((raw) => {
      if (typeof raw !== "object" || raw === null) return [];
      const i = raw as Record<string, unknown>;
      return [
        {
          page_url: typeof i.page_url === "string" ? i.page_url : "",
          kind: typeof i.kind === "string" ? i.kind : "",
          observed_at: typeof i.observed_at === "string" ? i.observed_at : "",
          is_open: i.is_open === true,
        },
      ];
    }),
  };

  const checkedRaw = p.checked;
  const checked = typeof checkedRaw === "object" && checkedRaw !== null ? (checkedRaw as Record<string, unknown>) : {};
  const stringList = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  const degradedSourceRaw = (entry: unknown): BriefDegradedSource | null => {
    if (typeof entry !== "object" || entry === null) return null;
    const row = entry as Record<string, unknown>;
    if (typeof row.key !== "string" || row.key.length === 0) return null;
    return {
      key: row.key,
      last_landed_at:
        typeof row.last_landed_at === "string" && row.last_landed_at.length > 0
          ? row.last_landed_at
          : null,
    };
  };
  const namedDegraded = Array.isArray(checked.degraded_sources)
    ? checked.degraded_sources.flatMap((entry) => {
        const source = degradedSourceRaw(entry);
        return source === null ? [] : [source];
      })
    : [];
  const degradedSources: BriefDegradedSource[] = [
    ...namedDegraded,
    ...stringList(checked.degraded_source_keys)
      .filter((key) => !namedDegraded.some((source) => source.key === key))
      .map((key) => ({ key, last_landed_at: null })),
  ];
  const checkedCounts: BriefChecked = {
    mention_count: numberOrNull(checked.mention_count) ?? 0,
    site_change_count: numberOrNull(checked.site_change_count) ?? 0,
    new_ad_count: numberOrNull(checked.new_ad_count) ?? 0,
    source_keys: stringList(checked.source_keys),
    degraded_source_keys: stringList(checked.degraded_source_keys),
    degraded_sources: degradedSources,
  };

  return {
    workspace_id: requireString("workspace_id"),
    timezone: requireString("timezone"),
    period_start: requireString("period_start"),
    period_end: requireString("period_end"),
    headline_rank: numberOrNull(p.headline_rank),
    headline_total: numberOrNull(p.headline_total) ?? 0,
    headline_movement: numberOrNull(p.headline_movement),
    headline_is_new: p.headline_is_new === true,
    why_line: requireString("why_line"),
    is_quiet_week: p.is_quiet_week === true,
    read_this_first: readThisFirst,
    brands,
    own_site: ownSite,
    checked: checkedCounts,
    next_brief_at: optionalString("next_brief_at"),
  };
}
