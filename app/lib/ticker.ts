import { changeHeadline, parseSiteChangePayload } from "./site-change";

export interface TickerItem {
  id: string;
  text: string;
  ago: string;
}

export function agoLabel(observedAt: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - Date.parse(observedAt)) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)}m ago`;
  if (minutes < 1440) return `${String(Math.floor(minutes / 60))}h ago`;
  return `${String(Math.floor(minutes / 1440))}d ago`;
}

export function tickerItems(
  rows: readonly {
    id: string;
    entity_name: string | null;
    entity_domain: string;
    payload_json: string;
    observed_at: string;
  }[],
  now: Date,
): TickerItem[] {
  return rows
    .flatMap((row) => {
      const payload = parseSiteChangePayload(row.payload_json);
      if (payload === null) return [];
      return [
        {
          id: row.id,
          text: changeHeadline({
            name: row.entity_name ?? row.entity_domain,
            isSelf: false,
            role: payload.page.role,
          }),
          ago: agoLabel(row.observed_at, now),
        },
      ];
    })
    .slice(0, 12);
}
