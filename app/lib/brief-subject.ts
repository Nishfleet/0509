import type { BriefPayload } from "./brief-payload";

type Mark = BriefPayload["read_this_first"][number];

const SUBJECT_MAX = 78;
const DETAIL_MAX = 46;
const SIDE_MAX = 22;
const PREHEADER_MAX = 110;

function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

function detailOf(mark: Mark): string | null {
  if (mark.before !== null && mark.after !== null) {
    return `${clip(mark.before, SIDE_MAX)} → ${clip(mark.after, SIDE_MAX)}`;
  }
  const title = clip(mark.title, DETAIL_MAX);
  return title === "" || /^https?:/i.test(title) ? null : title;
}

function moveSubject(lead: Mark, total: number): string {
  const name = clip(lead.entity_name, 30);
  const detail = detailOf(lead);
  const more = total > 1 ? ` (+${(total - 1).toFixed(0)} more)` : "";
  if (name === "") return detail === null ? `${total.toFixed(0)} rival moves this week` : `${detail}${more}`;
  const head = detail === null ? `${name} made a move` : `${name}: ${detail}`;
  return clip(`${head}${more}`, SUBJECT_MAX);
}

export function isFirstRanking(payload: BriefPayload): boolean {
  return (
    payload.brands.length > 0 &&
    payload.headline_movement === null &&
    payload.brands.every((brand) => brand.movement === null && !brand.is_new)
  );
}

export function briefSubject(payload: BriefPayload, unjudgedLine: string): string {
  if (payload.is_unjudged) return unjudgedLine;
  const lead = payload.read_this_first[0];
  if (lead !== undefined) return moveSubject(lead, payload.read_this_first.length);
  const { headline_rank: rank, headline_total: total } = payload;
  if (rank === null || total < 2) return "Quiet week: nothing needed your attention";
  if (isFirstRanking(payload)) return `Your first ranking: you're #${rank.toFixed(0)} of ${total.toFixed(0)}`;
  return `Quiet week: you're #${rank.toFixed(0)} of ${total.toFixed(0)}`;
}

export function briefPreheader(payload: BriefPayload, whyLine: string): string {
  const reason = payload.read_this_first[0]?.jev_reason.trim() ?? "";
  return reason === "" || payload.is_unjudged ? whyLine : clip(reason, PREHEADER_MAX);
}
