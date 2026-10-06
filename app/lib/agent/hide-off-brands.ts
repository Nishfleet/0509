import type { BriefPayload } from "../brief-payload";
import { quietWeekLine } from "../quiet-week";
import { UNJUDGED_WEEK_LINE, readThisFirstLine } from "../read-this-first";

type BrandLine = BriefPayload["brands"][number];
type Marks = BriefPayload["read_this_first"];

function signalCounts(brands: readonly BrandLine[]) {
  return {
    mention_count: brands.reduce((total, line) => total + line.mention_delta, 0),
    site_change_count: brands.reduce((total, line) => total + line.site_change_count, 0),
    new_ad_count: brands.reduce((total, line) => total + line.ad_delta, 0),
  };
}

function wordChar(char: string): boolean {
  if (char.length !== 1) return false;
  const code = char.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function lineNamesBrand(why: string, name: string): boolean {
  if (name.length === 0) return false;
  let from = 0;
  while (from <= why.length - name.length) {
    const at = why.indexOf(name, from);
    if (at === -1) return false;
    const left = why[at - 1] ?? "";
    const right = why[at + name.length] ?? "";
    if (!wordChar(left) && !wordChar(right)) return true;
    from = at + 1;
  }
  return false;
}

function whyLine(input: {
  payload: BriefPayload;
  marks: Marks;
  hiddenNames: readonly string[];
  remaining: readonly BrandLine[];
}): string {
  const { payload, marks, hiddenNames, remaining } = input;
  if (!hiddenNames.some((name) => lineNamesBrand(payload.why_line, name))) return payload.why_line;
  if (payload.is_unjudged) return UNJUDGED_WEEK_LINE;
  const lead = marks[0];
  if (lead !== undefined) {
    return readThisFirstLine(marks.length, Math.max(payload.judged_count ?? 0, marks.length), lead.entity_name);
  }
  const counts = signalCounts(remaining);
  return quietWeekLine(counts.mention_count, counts.site_change_count, counts.new_ad_count);
}

export function hideOffBrands(payload: BriefPayload, hidden: Set<string>): BriefPayload {
  const brands = payload.brands.filter((line) => !hidden.has(line.entity_id));
  if (brands.length === payload.brands.length) return payload;
  const read_this_first = payload.read_this_first.filter((mark) => !hidden.has(mark.entity_id));
  const removed = payload.brands.filter((line) => hidden.has(line.entity_id));
  const rank = payload.headline_rank;
  const droppedAbove = rank === null ? 0 : removed.filter((line) => line.rank !== null && line.rank < rank).length;
  const counts = signalCounts(brands);
  return {
    ...payload,
    brands,
    read_this_first,
    headline_rank: rank === null ? null : rank - droppedAbove,
    headline_total: brands.length,
    why_line: whyLine({
      payload,
      marks: read_this_first,
      hiddenNames: removed.map((line) => line.name).filter((name) => name.length > 0),
      remaining: brands,
    }),
    is_quiet_week: read_this_first.length === 0 && !payload.is_unjudged,
    checked: { ...payload.checked, ...counts },
  };
}
