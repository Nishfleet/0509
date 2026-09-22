/**
 * The weekly brief's data contract, in one place.
 *
 * `digest.payload_json` is written by engine 6 (the standing rollover, P6.4) and
 * read here by engine 7. That makes this module the shape both sides must agree
 * on, so it is defined once rather than restated as an inline cast at the point
 * of use — a re-typed field at the read site is how the email and Home start
 * disagreeing, which is the exact failure docs/REBUILD-STANDING.md exists to
 * prevent (docs/engines/standing-home.md §7: "the brief and Home disagree").
 *
 * The rule this module exists to enforce: **the brief renders, it never
 * re-ranks.** D4's picks and Jev's one-line reasons arrive on the payload and
 * are shown verbatim; every other sentence on the page is a fixed template
 * string filled with counts (docs/REBUILD-DELIVERY.md rule 5, docs/engines/
 * delivery.md §4b).
 */

/**
 * One before-and-after mark chosen by D4 (`read_this_first`).
 *
 * `jev_reason` is Jev's returned one-line reason, shown verbatim and marked as
 * Jev's read. Nothing here may be rewritten, summarised or extended —
 * docs/REBUILD-JEV.md bars generating longer copy.
 */
interface BriefMark {
  signal_id: string;
  entity_id: string;
  /** Brand name for the label above the mark. */
  entity_name: string;
  title: string;
  /** Where the item was seen, as the source registry names it. */
  source: string;
  /** ISO-8601 instant of the observation, formatted in workspace.timezone. */
  observed_at: string;
  /** R2 object key for the screenshot thumbnail. Linked, never inlined. */
  thumbnail_r2_key: string | null;
  /** Link to the item itself. */
  url: string;
  /** Before-and-after pair for the one mark object (DESIGN.md §1.6). */
  before: string | null;
  after: string | null;
  jev_reason: string;
}

/** One line per ON brand, in the frozen rank order engine 6 wrote. */
interface BriefBrandLine {
  entity_id: string;
  name: string;
  /** Frozen rank for this week. Null only when the week is still in flight. */
  rank: number | null;
  /** Last week's rank minus this week's, already computed by engine 6. */
  movement: number | null;
  /** "new" when the brand was ON for the first time this week. */
  is_new: boolean;
  /** The brand's biggest move this week, or null for a quiet brand. */
  biggest_move: string | null;
  ad_delta: number;
  mention_delta: number;
  site_change_count: number;
}

/** Own-site status: "nothing broke" or the list of what did. */
interface BriefOwnSite {
  status: "ok" | "broken";
  incidents: {
    page_url: string;
    kind: string;
    observed_at: string;
    is_open: boolean;
  }[];
}

/** What was checked, for the footer's honesty line. */
interface BriefChecked {
  mention_count: number;
  site_change_count: number;
  new_ad_count: number;
  /** Source registry keys that answered this week, for the freshness line. */
  source_keys: string[];
  /** Registry keys that did not answer, so a quiet week is never a blind one. */
  degraded_source_keys: string[];
}

/**
 * The payload as it sits in `digest.payload_json`.
 *
 * Every field the brief shows arrives here already decided. The only fields the
 * brief computes itself are the ones engine 6 cannot know (the recipient's
 * unsubscribe token and the next brief date), and those are passed in
 * separately rather than written into the payload.
 */
export interface BriefPayload {
  workspace_id: string;
  timezone: string;
  period_start: string;
  period_end: string;
  /** The customer's own rank, null when fewer than two ON brands. */
  headline_rank: number | null;
  /** How many ON brands are ranked this week, self included. */
  headline_total: number;
  /** Positive is up. Null when movement is not applicable. */
  headline_movement: number | null;
  /**
   * True when this workspace was ON for the first time this week, so there is
   * no last week's rank to compare against and the headline says "new" rather
   * than claiming a movement of zero.
   */
  headline_is_new: boolean;
  /** D4's top reason, or the counts sentence on a quiet week. */
  why_line: string;
  /** True when D4 cleared nothing and the counts line is showing instead. */
  is_quiet_week: boolean;
  /** D4's picks, already ordered. Never re-sorted here. */
  read_this_first: BriefMark[];
  /** One line per ON brand, already ordered by frozen rank. */
  brands: BriefBrandLine[];
  own_site: BriefOwnSite;
  checked: BriefChecked;
  /** When the next brief is due, for the footer. */
  next_brief_at: string | null;
}

/**
 * The one extra thing the brief needs that is not engine 6's to write: the
 * recipient's own unsubscribe link. Engine 6 writes a digest that is identical
 * for every recipient of that workspace; P7.3's one-click unsubscribe token
 * lives on `send_target`, which is per recipient.
 */
export interface BriefContext {
  /** Absolute URL of the one-click unsubscribe endpoint, or null. */
  unsubscribe_url: string | null;
  /** Public base URL, used to turn an R2 key into a thumbnail link. */
  asset_base_url: string | null;
}

export interface RenderedBrief {
  subject: string;
  html: string;
  text: string;
}

/**
 * The per-brand query.
 *
 * OFF brands are absent, not zeroed (docs/REBUILD-DELIVERY.md rule 4): the join
 * on `entity` with `state = 'on'` is what makes that true at the source, so a
 * brand switched off mid-week has no row at all rather than a zeroed line.
 *
 * The brand rows arrive already ordered by frozen rank — this query does not
 * sort and must not, because the frozen order is engine 6's decision and
 * re-sorting here would let the email disagree with Home.
 */
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

/**
 * Parse `digest.payload_json` into the brief's contract.
 *
 * Deliberately tolerant of extra fields and deliberately strict about the ones
 * the render needs. A payload written by a newer engine 6 that has grown a
 * field this build does not know must still send its brief — dropping a send
 * because of an unrecognised key is the "silence reads as 'the product
 * stopped'" failure docs/REBUILD-DELIVERY.md forbids. A payload missing a field
 * the render cannot do without throws, so the send lane records `failed` with
 * the reason rather than emailing a half-built brief.
 */
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
  const checkedCounts: BriefChecked = {
    mention_count: numberOrNull(checked.mention_count) ?? 0,
    site_change_count: numberOrNull(checked.site_change_count) ?? 0,
    new_ad_count: numberOrNull(checked.new_ad_count) ?? 0,
    source_keys: stringList(checked.source_keys),
    degraded_source_keys: stringList(checked.degraded_source_keys),
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
