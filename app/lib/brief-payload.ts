import { z } from "zod";

const text = z.string().min(1);
const optionalText = z.string().min(1).nullable().catch(null);
const numberOrNull = z.number().nullable().catch(null);
const count = z.number().catch(0);
const flag = z.boolean().catch(false);
const loose = z.string().catch("");

function keepValid<T extends z.ZodType>(item: T) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((rows) =>
      rows.flatMap((row) => {
        const parsed = item.safeParse(row);
        return parsed.success ? [parsed.data] : [];
      }),
    );
}

const markSchema = z.object({
  signal_id: z.string(),
  entity_id: loose,
  entity_name: loose,
  title: loose,
  source: loose,
  observed_at: loose,
  thumbnail_r2_key: z.string().nullable().catch(null),
  url: loose,
  before: z.string().nullable().catch(null),
  after: z.string().nullable().catch(null),
  jev_reason: z.string(),
});

const brandLineSchema = z
  .object({
    entity_id: z.string(),
    name: loose,
    rank: numberOrNull,
    movement: numberOrNull,
    is_new: flag,
    biggest_move: z.string().nullable().catch(null),
    ad_delta: count,
    mention_delta: count,
    site_change_count: count,
    new_roles: count,
  })
  .transform((line) => ({ ...line, name: line.name.length > 0 ? line.name : line.entity_id }));

const ownSiteSchema = z
  .object({
    status: z.enum(["ok", "broken"]).catch("ok"),
    incidents: keepValid(z.object({ page_url: loose, kind: loose, observed_at: loose, is_open: flag })),
  })
  .catch({ status: "ok", incidents: [] });

const degradedSourceSchema = z.object({
  key: text,
  name: optionalText,
  last_landed_at: optionalText,
});

const checkedSchema = z
  .object({
    mention_count: count,
    site_change_count: count,
    new_ad_count: count,
    total_change_count: z.number().int().nonnegative().optional().catch(undefined),
    source_keys: keepValid(z.string()),
    degraded_source_keys: keepValid(z.string()),
    degraded_sources: keepValid(degradedSourceSchema),
  })
  .catch({
    mention_count: 0,
    site_change_count: 0,
    new_ad_count: 0,
    source_keys: [],
    degraded_source_keys: [],
    degraded_sources: [],
  })
  .transform((checked) => ({
    ...checked,
    degraded_sources: [
      ...checked.degraded_sources,
      ...checked.degraded_source_keys
        .filter((key) => !checked.degraded_sources.some((source) => source.key === key))
        .map((key) => ({ key, name: null, last_landed_at: null })),
    ],
  }));

const newRivalSchema = z
  .object({ name: text, domain: text, reason: optionalText })
  .nullable()
  .optional()
  .catch(undefined);

const briefPayloadSchema = z.object({
  workspace_id: text,
  timezone: text,
  period_start: text,
  period_end: text,
  headline_rank: numberOrNull,
  headline_total: count,
  headline_movement: numberOrNull,
  headline_is_new: flag,
  headline_earlier: z
    .object({ rank: z.number().int().positive(), weeks: z.number().int().positive() })
    .nullable()
    .optional()
    .catch(undefined),
  why_line: text,
  is_quiet_week: flag,
  is_unjudged: flag,
  judged_count: z.number().optional().catch(undefined),
  read_this_first: keepValid(markSchema),
  brands: keepValid(brandLineSchema),
  own_site: ownSiteSchema,
  checked: checkedSchema,
  next_brief_at: optionalText,
  new_rival: newRivalSchema,
});

export type BriefPayload = z.output<typeof briefPayloadSchema>;

export function sinceStartedLine(checked: BriefPayload["checked"]): string | null {
  const running = checked.total_change_count ?? 0;
  if (running <= checked.site_change_count) return null;
  return `${String(running)} site ${running === 1 ? "change" : "changes"} caught since you started`;
}

export function rankTrendLine(payload: BriefPayload): string | null {
  const earlier = payload.headline_earlier;
  const rank = payload.headline_rank;
  if (earlier === null || earlier === undefined || rank === null) return null;
  const when = `${String(earlier.weeks)} weeks ago`;
  if (rank < earlier.rank) return `Up from #${String(earlier.rank)} ${when}`;
  if (rank > earlier.rank) return `Down from #${String(earlier.rank)} ${when}`;
  return `Holding at #${String(rank)} since ${when}`;
}

export const COMPETITORS_LINK = "https://0509.io/app/competitors";

export function newRivalLines(payload: BriefPayload): { title: string; reason: string | null } | null {
  const rival = payload.new_rival;
  if (rival === null || rival === undefined) return null;
  return { title: `${rival.name} (${rival.domain}) may be a rival you are missing.`, reason: rival.reason };
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
  const parsed = briefPayloadSchema.safeParse(JSON.parse(payloadJson));
  if (!parsed.success) {
    throw new Error(`brief payload: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export function readBriefPayload(payloadJson: string): BriefPayload | null {
  try {
    return parseBriefPayload(payloadJson);
  } catch (error) {
    console.error(JSON.stringify({ event: "brief.payload_unreadable", error: String(error) }));
    return null;
  }
}
