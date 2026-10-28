import type { BriefPayload } from "./brief-payload";

type Mark = BriefPayload["read_this_first"][number];

const SUBJECT_MAX = 78;
const DETAIL_MAX = 46;
const SIDE_MAX = 22;
const PREHEADER_MAX = 110;

const SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  const graphemes = Array.from(SEGMENTER.segment(flat), (part) => part.segment);
  return graphemes.length <= max
    ? flat
    : `${graphemes
        .slice(0, max - 1)
        .join("")
        .trimEnd()}…`;
}

function isUrl(value: string): boolean {
  return /^https?:/i.test(value);
}

function detailOf(mark: Mark): string | null {
  const before = mark.before === null ? "" : clip(mark.before, SIDE_MAX);
  const after = mark.after === null ? "" : clip(mark.after, SIDE_MAX);
  if (before !== "" && after !== "" && !isUrl(before) && !isUrl(after)) return `${before} → ${after}`;
  const title = clip(mark.title, DETAIL_MAX);
  return title === "" || isUrl(title) ? null : title;
}

function moveSubject(lead: Mark, total: number): string {
  const name = clip(lead.entity_name, 30);
  const detail = detailOf(lead);
  const more = total > 1 ? ` (+${(total - 1).toFixed(0)} more)` : "";
  if (name === "") {
    const count = `${total.toFixed(0)} ${total === 1 ? "competitor moves" : "competitors move"} this week`;
    return clip(detail === null ? count : `${detail}${more}`, SUBJECT_MAX);
  }
  const head = detail === null ? `${name} made a move` : `${name}: ${detail}`;
  return clip(`${head}${more}`, SUBJECT_MAX);
}

export function isFirstRanking(payload: BriefPayload): boolean {
  return (
    payload.brands.length > 0 &&
    payload.headline_movement === null &&
    (payload.headline_earlier ?? null) === null &&
    payload.brands.every((brand) => brand.movement === null && !brand.is_new)
  );
}

const GENERIC_SUBJECT = "Your weekly brief";

export function briefSubject(payload: BriefPayload): string {
  if (payload.is_unjudged) return GENERIC_SUBJECT;
  const lead = payload.read_this_first[0];
  if (lead !== undefined) return moveSubject(lead, payload.read_this_first.length);
  if (!payload.is_quiet_week) return GENERIC_SUBJECT;
  const { headline_rank: rank, headline_total: total } = payload;
  if (rank === null || total < 2) return "Quiet week: nothing needed your attention";
  if (isFirstRanking(payload)) return `Your first ranking: you're #${rank.toFixed(0)} of ${total.toFixed(0)}`;
  return `Quiet week: you're #${rank.toFixed(0)} of ${total.toFixed(0)}`;
}

export function briefPreheader(payload: BriefPayload, whyLine: string): string {
  const reason = payload.read_this_first[0]?.jev_reason.trim() ?? "";
  return reason === "" || payload.is_unjudged ? whyLine : clip(reason, PREHEADER_MAX);
}
