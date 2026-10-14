import type { BriefPayload } from "./brief-payload";

export function sinceStartedLine(checked: BriefPayload["checked"]): string | null {
  const running = checked.total_change_count ?? 0;
  if (running <= checked.site_change_count) return null;
  return `${String(running)} site ${running === 1 ? "change" : "changes"} caught since you started`;
}

export function rankTrendLine(payload: BriefPayload): string | null {
  const earlier = payload.headline_earlier;
  const rank = payload.headline_rank;
  if (earlier === null || earlier === undefined || rank === null) return null;
  if (payload.is_unjudged || payload.headline_total < 2) return null;
  const when = `${String(earlier.weeks)} weeks ago`;
  if (rank < earlier.rank) return `Up from #${String(earlier.rank)} ${when}`;
  if (rank > earlier.rank) return `Down from #${String(earlier.rank)} ${when}`;
  return `Holding at #${String(rank)} for ${String(earlier.weeks)} weeks`;
}
