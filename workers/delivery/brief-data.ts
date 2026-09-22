interface BriefMark {
  signal_id: string;
  entity_id: string;
  source: string;
  observed_at: string;
  thumbnail_url: string | null;
  link: string;
  title: string;
}

interface BriefBrand {
  entity_id: string;
  name: string;
  biggest_move: string;
  ad_delta: number;
  mention_delta: number;
  site_change_count: number;
}

interface OwnSiteItem {
  label: string;
  still_broken: boolean;
}

export interface BriefPayload {
  headline: { rank: number; of: number; movement: number; why: string };
  read_this_first: BriefMark[];
  brands: BriefBrand[];
  own_site: { items: OwnSiteItem[] };
  checked: { source: string; count: number }[];
  next_brief_at: string | null;
  quiet: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function finite(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseMark(value: unknown): BriefMark | null {
  if (!isRecord(value)) return null;
  const signalId = text(value, "signal_id");
  const entityId = text(value, "entity_id");
  const source = text(value, "source");
  const observedAt = text(value, "observed_at");
  const link = text(value, "link");
  const title = text(value, "title");
  if (!signalId || !entityId || !source || !observedAt || !link || !title) return null;
  const thumbnail = text(value, "thumbnail_url");
  return {
    signal_id: signalId,
    entity_id: entityId,
    source,
    observed_at: observedAt,
    thumbnail_url: thumbnail,
    link,
    title,
  };
}

function parseBrand(value: unknown): BriefBrand | null {
  if (!isRecord(value)) return null;
  const entityId = text(value, "entity_id");
  const name = text(value, "name");
  const biggest = text(value, "biggest_move");
  const adDelta = finite(value, "ad_delta");
  const mentionDelta = finite(value, "mention_delta");
  const siteChanges = finite(value, "site_change_count");
  if (!entityId || !name || !biggest || adDelta === null || mentionDelta === null || siteChanges === null) {
    return null;
  }
  return {
    entity_id: entityId,
    name,
    biggest_move: biggest,
    ad_delta: adDelta,
    mention_delta: mentionDelta,
    site_change_count: siteChanges,
  };
}

function parseOwnSite(value: unknown): OwnSiteItem[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return [];
  const items: OwnSiteItem[] = [];
  for (const item of value.items) {
    if (!isRecord(item)) continue;
    const label = text(item, "label");
    if (!label || typeof item.still_broken !== "boolean") continue;
    items.push({ label, still_broken: item.still_broken });
  }
  return items;
}

export function parseBriefPayload(raw: string): BriefPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("digest payload is not json", { cause: error });
    throw error;
  }
  if (!isRecord(parsed) || !isRecord(parsed.headline)) {
    throw new Error("digest payload is missing a headline");
  }
  const rank = finite(parsed.headline, "rank");
  const of = finite(parsed.headline, "of");
  const movement = finite(parsed.headline, "movement");
  if (rank === null || of === null || movement === null) {
    throw new Error("digest payload headline is missing rank, of, or movement");
  }
  const why = text(parsed.headline, "why") ?? "";
  const marks = Array.isArray(parsed.read_this_first)
    ? parsed.read_this_first.map(parseMark).filter((mark): mark is BriefMark => mark !== null)
    : [];
  const brands = Array.isArray(parsed.brands)
    ? parsed.brands.map(parseBrand).filter((brand): brand is BriefBrand => brand !== null)
    : [];
  const checked = Array.isArray(parsed.checked)
    ? parsed.checked.flatMap((item) => {
        if (!isRecord(item)) return [];
        const source = text(item, "source");
        const count = finite(item, "count");
        if (!source || count === null) return [];
        return [{ source, count }];
      })
    : [];
  return {
    headline: { rank, of, movement, why },
    read_this_first: marks,
    brands,
    own_site: { items: parseOwnSite(parsed.own_site) },
    checked,
    next_brief_at: text(parsed, "next_brief_at"),
    quiet: parsed.quiet === true,
  };
}

export function applyDeliveryRules(
  payload: BriefPayload,
  entities: readonly { id: string; state: string }[],
  deliveredSignalIds: ReadonlySet<string>,
): BriefPayload {
  const off = new Set(entities.filter((entity) => entity.state !== "on").map((entity) => entity.id));
  const marks = payload.read_this_first
    .filter((mark) => !off.has(mark.entity_id) && !deliveredSignalIds.has(mark.signal_id))
    .slice(0, 3);
  const brands = payload.brands.filter((brand) => !off.has(brand.entity_id));
  return {
    ...payload,
    read_this_first: marks,
    brands,
  };
}
